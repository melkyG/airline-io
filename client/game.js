const socket = io();

const joinButtonEl = document.getElementById('joinButton');
const botFillButtonEl = document.getElementById('botFillButton');
const usernameInputEl = document.getElementById('usernameInput');
const gameTimerEl = document.getElementById('gameTimer');
const devAddScoreButtonEl = document.getElementById('devAddScoreButton');
const gameScreenEl = document.getElementById('gameScreen');
const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});
const INTEGER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0
});
let gameCountdownIntervalId = null;
let selectedAirportId = null;
let selectedAircraftCatalogId = null;
let isAircraftPurchasePending = false;
let isAircraftQuotePending = false;
let pendingAircraftQuoteCatalogId = null;
let isAircraftSellPending = false;
let isAircraftSellQuotePending = false;
let pendingAircraftSellQuoteCatalogId = null;
let aircraftMaxPurchasable = 0;
let aircraftPurchaseQuantity = 0;
let aircraftSellQuantity = 0;
let aircraftOwnedQuantity = 0;
let aircraftMaxSellable = 0;
let aircraftUnitSellPrice = 0;
let lastSelectedAircraftEconomicsFingerprint = null;
let shopAirportSearchQuery = '';
let isAirportSearchResultsOpen = false;
let shopAircraftSearchQuery = '';
let isAircraftSearchResultsOpen = false;
let shouldIgnoreNextOverlayClick = false;

const SHOP_MODAL_TAB = Object.freeze({
  AIRCRAFT: 'aircraft',
  AIRPORTS: 'airports'
});

const SHOP_MODAL_OPENED_FROM = Object.freeze({
  HUD: 'hud',
  AIRPORT_MARKER: 'airport-marker'
});

const AIRCRAFT_SELECTION_PLACEHOLDER_MESSAGE = 'Select an aircraft from the list to view purchase actions.';
const MAX_GAME_EVENT_HISTORY = 100;

const ShopModalState = {
  isOpen: false,
  activeTab: SHOP_MODAL_TAB.AIRPORTS,
  lastActiveTab: SHOP_MODAL_TAB.AIRPORTS,
  hasOpenedFromHud: false,
  selectedAircraftCatalogId: null,
  selectedAirportId: null,
  openedFrom: null
};

function setShopActiveTab(activeTab) {
  if (activeTab !== SHOP_MODAL_TAB.AIRPORTS && activeTab !== SHOP_MODAL_TAB.AIRCRAFT) {
    return;
  }

  ShopModalState.activeTab = activeTab;
  ShopModalState.lastActiveTab = activeTab;
}

function openShopModal({ openedFrom = SHOP_MODAL_OPENED_FROM.HUD } = {}) {
  ShopModalState.isOpen = true;
  ShopModalState.openedFrom = openedFrom;
  refreshShopModal(gameState.getState());
}

function closeShopModal() {
  ShopModalState.isOpen = false;
  ShopModalState.openedFrom = null;
  isAirportSearchResultsOpen = false;
  isAircraftSearchResultsOpen = false;
  refreshShopModal(gameState.getState());
}

function setShopModalOpenedFrom(openedFrom) {
  ShopModalState.openedFrom = openedFrom;
}

function setShopModalSelectedAirportId(airportId) {
  ShopModalState.selectedAirportId = airportId ? String(airportId) : null;
}

function setShopModalSelectedAircraftCatalogId(aircraftCatalogId) {
  ShopModalState.selectedAircraftCatalogId = aircraftCatalogId ? String(aircraftCatalogId) : null;
}

function openShopFromHud() {
  if (!ShopModalState.hasOpenedFromHud) {
    ShopModalState.hasOpenedFromHud = true;
    ShopModalState.activeTab = SHOP_MODAL_TAB.AIRPORTS;
    ShopModalState.lastActiveTab = SHOP_MODAL_TAB.AIRPORTS;
  } else {
    ShopModalState.activeTab = ShopModalState.lastActiveTab;
  }

  openShopModal({ openedFrom: SHOP_MODAL_OPENED_FROM.HUD });
}

function getEmptyLobbyState() {
  return {
    lobbyId: null,
    status: 'waiting',
    playerCount: 0,
    maxPlayers: 5,
    players: [],
    botFillInProgress: false,
    countdownSeconds: null
  };
}

function getEmptyGameState() {
  return {
    id: null,
    status: null,
    createdAt: null,
    startedAt: null,
    endsAt: null,
    durationMs: null,
    scoreToWin: null,
    players: [],
    airports: [],
    ownedAircraft: [],
    aircraftCatalog: []
  };
}

function formatRemainingTime(endsAt) {
  if (!Number.isFinite(endsAt)) {
    return '00:00';
  }

  const remainingMs = Math.max(0, endsAt - Date.now());
  const remainingTotalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(remainingTotalSeconds / 60);
  const seconds = remainingTotalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateGameTimerDisplay() {
  if (!gameTimerEl) {
    return false;
  }

  const state = gameState.getState();
  if (state.ui.screen !== 'game' || !state.game || !Number.isFinite(state.game.endsAt)) {
    gameTimerEl.textContent = '00:00';
    return false;
  }

  if (state.game.status !== 'active') {
    return false;
  }

  gameTimerEl.textContent = formatRemainingTime(state.game.endsAt);
  return state.game.endsAt - Date.now() > 0;
}

function stopGameCountdown() {
  if (gameCountdownIntervalId) {
    clearInterval(gameCountdownIntervalId);
    gameCountdownIntervalId = null;
  }
}

function startGameCountdown() {
  stopGameCountdown();

  const shouldContinue = updateGameTimerDisplay();
  if (!shouldContinue) {
    return;
  }

  gameCountdownIntervalId = setInterval(() => {
    const keepRunning = updateGameTimerDisplay();
    if (!keepRunning) {
      stopGameCountdown();
    }
  }, 1000);
}

function normalizeIncomingGameEvent(eventPayload) {
  if (!eventPayload || typeof eventPayload !== 'object' || Array.isArray(eventPayload)) {
    return null;
  }

  const type = typeof eventPayload.type === 'string' ? eventPayload.type.trim() : '';
  if (!type) {
    return null;
  }

  const occurredAt = Number.isFinite(eventPayload.occurredAt) ? eventPayload.occurredAt : Date.now();
  const normalizedData =
    eventPayload.data && typeof eventPayload.data === 'object' && !Array.isArray(eventPayload.data)
      ? { ...eventPayload.data }
      : eventPayload.data;

  return {
    type,
    occurredAt,
    gameId: eventPayload.gameId == null ? null : String(eventPayload.gameId),
    actorPlayerId: eventPayload.actorPlayerId == null ? null : String(eventPayload.actorPlayerId),
    data: normalizedData
  };
}

function clearGameEventHistory() {
  gameState.update(() => ({
    session: {
      gameEvents: []
    }
  }));
}

function appendGameEventToHistory(eventPayload) {
  const normalizedEvent = normalizeIncomingGameEvent(eventPayload);
  if (!normalizedEvent) {
    return false;
  }

  gameState.update((state) => {
    const existingEvents =
      state && state.session && Array.isArray(state.session.gameEvents) ? state.session.gameEvents : [];
    const nextEvents = [...existingEvents, normalizedEvent];
    if (nextEvents.length > MAX_GAME_EVENT_HISTORY) {
      nextEvents.splice(0, nextEvents.length - MAX_GAME_EVENT_HISTORY);
    }

    return {
      session: {
        gameEvents: nextEvents
      }
    };
  });

  return true;
}

const gameState = window.createGameState({
  connection: {
    status: 'connecting'
  },
  session: {
    playerId: null,
    joined: false,
    joinPending: false,
    botFillPending: false,
    currentLobbyId: null,
    currentGameId: null,
    gameEvents: []
  },
  lobby: getEmptyLobbyState(),
  ui: {
    errorMessage: null,
    screen: 'lobby'
  },
  game: getEmptyGameState(),
  waitingAnimation: {
    step: 0
  }
});

const renderer = window.createRenderer(document);
gameState.subscribe((state) => {
  renderer.render(state);
  refreshShopModal(state);
});
renderer.render(gameState.getState());

const shopModalOverlayEl = document.createElement('div');
shopModalOverlayEl.className = 'shop-modal-overlay hidden';
shopModalOverlayEl.setAttribute('aria-hidden', 'true');

const shopModalDialogEl = document.createElement('div');
shopModalDialogEl.className = 'shop-modal';
shopModalDialogEl.setAttribute('role', 'dialog');
shopModalDialogEl.setAttribute('aria-modal', 'true');

const shopModalCloseButtonEl = document.createElement('button');
shopModalCloseButtonEl.type = 'button';
shopModalCloseButtonEl.className = 'shop-modal-close';
shopModalCloseButtonEl.setAttribute('aria-label', 'Close shop modal');
shopModalCloseButtonEl.textContent = 'x';

const shopModalTitleEl = document.createElement('h3');
shopModalTitleEl.className = 'shop-modal-title';
shopModalTitleEl.textContent = 'Shop';

const shopModalTabsEl = document.createElement('div');
shopModalTabsEl.className = 'shop-modal-tabs';

const shopAirportsTabButtonEl = document.createElement('button');
shopAirportsTabButtonEl.type = 'button';
shopAirportsTabButtonEl.className = 'shop-modal-tab';
shopAirportsTabButtonEl.setAttribute('data-tab', SHOP_MODAL_TAB.AIRPORTS);
shopAirportsTabButtonEl.textContent = 'Airports';

const shopAircraftTabButtonEl = document.createElement('button');
shopAircraftTabButtonEl.type = 'button';
shopAircraftTabButtonEl.className = 'shop-modal-tab';
shopAircraftTabButtonEl.setAttribute('data-tab', SHOP_MODAL_TAB.AIRCRAFT);
shopAircraftTabButtonEl.textContent = 'Aircraft';

shopModalTabsEl.appendChild(shopAirportsTabButtonEl);
shopModalTabsEl.appendChild(shopAircraftTabButtonEl);

const shopModalContentEl = document.createElement('div');
shopModalContentEl.className = 'shop-modal-content';

const shopAirportsPanelEl = document.createElement('div');
shopAirportsPanelEl.className = 'shop-modal-panel';
shopAirportsPanelEl.setAttribute('data-panel', SHOP_MODAL_TAB.AIRPORTS);

const shopAirportSearchContainerEl = document.createElement('div');
shopAirportSearchContainerEl.className = 'shop-airport-search-container';

const shopAirportDetailsEl = document.createElement('div');
shopAirportDetailsEl.className = 'shop-airport-details';

const shopAirportSearchLabelEl = document.createElement('label');
shopAirportSearchLabelEl.className = 'shop-airport-search-label';
shopAirportSearchLabelEl.setAttribute('for', 'shopAirportSearchInput');
shopAirportSearchLabelEl.textContent = 'Search Airports';

const shopAirportSearchInputEl = document.createElement('input');
shopAirportSearchInputEl.id = 'shopAirportSearchInput';
shopAirportSearchInputEl.type = 'text';
shopAirportSearchInputEl.className = 'shop-airport-search-input';
shopAirportSearchInputEl.placeholder = 'Search by airport, IATA, ICAO, city, or country';
shopAirportSearchInputEl.setAttribute('autocomplete', 'off');

const shopAirportResultsTitleEl = document.createElement('p');
shopAirportResultsTitleEl.className = 'shop-airport-results-title';
shopAirportResultsTitleEl.textContent = 'Matching Airports';
shopAirportResultsTitleEl.classList.add('hidden');

const shopAirportResultsListEl = document.createElement('div');
shopAirportResultsListEl.className = 'shop-airport-results-list';
shopAirportResultsListEl.classList.add('hidden');

const shopAirportTitleEl = document.createElement('h3');
shopAirportTitleEl.className = 'airport-interaction-title';
shopAirportTitleEl.textContent = 'Select an airport';

const shopAirportOwnerRowEl = document.createElement('p');
shopAirportOwnerRowEl.className = 'airport-interaction-row';
shopAirportOwnerRowEl.innerHTML = '<span class="airport-interaction-label">Owner:</span> <span class="airport-interaction-value" data-shop-airport-owner>Unknown</span>';
const shopAirportOwnerValueEl = shopAirportOwnerRowEl.querySelector('[data-shop-airport-owner]');

const shopAirportPriceRowEl = document.createElement('p');
shopAirportPriceRowEl.className = 'airport-interaction-row';
shopAirportPriceRowEl.innerHTML = '<span class="airport-interaction-label" data-shop-airport-price-label>Price:</span> <span class="airport-interaction-value" data-shop-airport-price>-</span>';
const shopAirportPriceLabelEl = shopAirportPriceRowEl.querySelector('[data-shop-airport-price-label]');
const shopAirportPriceValueEl = shopAirportPriceRowEl.querySelector('[data-shop-airport-price]');

const shopAirportMessageEl = document.createElement('p');
shopAirportMessageEl.className = 'airport-interaction-row';
shopAirportMessageEl.textContent = 'Select an airport from the list to view purchase actions.';

const shopAirportActionsEl = document.createElement('div');
shopAirportActionsEl.className = 'airport-interaction-actions';

shopAirportSearchContainerEl.appendChild(shopAirportSearchLabelEl);
shopAirportSearchContainerEl.appendChild(shopAirportSearchInputEl);
shopAirportSearchContainerEl.appendChild(shopAirportResultsTitleEl);
shopAirportSearchContainerEl.appendChild(shopAirportResultsListEl);
shopAirportsPanelEl.appendChild(shopAirportSearchContainerEl);
shopAirportDetailsEl.appendChild(shopAirportTitleEl);
shopAirportDetailsEl.appendChild(shopAirportOwnerRowEl);
shopAirportDetailsEl.appendChild(shopAirportPriceRowEl);
shopAirportDetailsEl.appendChild(shopAirportMessageEl);
shopAirportDetailsEl.appendChild(shopAirportActionsEl);
shopAirportsPanelEl.appendChild(shopAirportDetailsEl);

const shopAircraftPanelEl = document.createElement('div');
shopAircraftPanelEl.className = 'shop-modal-panel';
shopAircraftPanelEl.setAttribute('data-panel', SHOP_MODAL_TAB.AIRCRAFT);

const shopAircraftSearchContainerEl = document.createElement('div');
shopAircraftSearchContainerEl.className = 'shop-airport-search-container';

const shopAircraftDetailsEl = document.createElement('div');
shopAircraftDetailsEl.className = 'shop-airport-details';

const shopAircraftSearchLabelEl = document.createElement('label');
shopAircraftSearchLabelEl.className = 'shop-airport-search-label';
shopAircraftSearchLabelEl.setAttribute('for', 'shopAircraftSearchInput');
shopAircraftSearchLabelEl.textContent = 'Search Aircraft';

const shopAircraftSearchInputEl = document.createElement('input');
shopAircraftSearchInputEl.id = 'shopAircraftSearchInput';
shopAircraftSearchInputEl.type = 'text';
shopAircraftSearchInputEl.className = 'shop-airport-search-input';
shopAircraftSearchInputEl.placeholder = 'Search by manufacturer, model, or aircraft ID';
shopAircraftSearchInputEl.setAttribute('autocomplete', 'off');

const shopAircraftResultsTitleEl = document.createElement('p');
shopAircraftResultsTitleEl.className = 'shop-airport-results-title';
shopAircraftResultsTitleEl.textContent = 'Matching Aircraft';
shopAircraftResultsTitleEl.classList.add('hidden');

const shopAircraftResultsListEl = document.createElement('div');
shopAircraftResultsListEl.className = 'shop-airport-results-list';
shopAircraftResultsListEl.classList.add('hidden');

const shopAircraftTitleEl = document.createElement('h3');
shopAircraftTitleEl.className = 'airport-interaction-title';
shopAircraftTitleEl.textContent = 'Select an aircraft';

const shopAircraftPriceRowEl = document.createElement('p');
shopAircraftPriceRowEl.className = 'airport-interaction-row';
shopAircraftPriceRowEl.innerHTML = '<span class="airport-interaction-label">Price:</span> <span class="airport-interaction-value" data-shop-aircraft-price>-</span>';
const shopAircraftPriceValueEl = shopAircraftPriceRowEl.querySelector('[data-shop-aircraft-price]');

const shopAircraftRangeRowEl = document.createElement('p');
shopAircraftRangeRowEl.className = 'airport-interaction-row';
shopAircraftRangeRowEl.innerHTML = '<span class="airport-interaction-label">Range:</span> <span class="airport-interaction-value" data-shop-aircraft-range>-</span>';
const shopAircraftRangeValueEl = shopAircraftRangeRowEl.querySelector('[data-shop-aircraft-range]');

const shopAircraftTradeDividerEl = document.createElement('div');
shopAircraftTradeDividerEl.className = 'aircraft-trade-divider';

const shopAircraftMessageEl = document.createElement('p');
shopAircraftMessageEl.className = 'airport-interaction-row';
shopAircraftMessageEl.textContent = AIRCRAFT_SELECTION_PLACEHOLDER_MESSAGE;

const shopAircraftTradeLayoutEl = document.createElement('div');
shopAircraftTradeLayoutEl.className = 'aircraft-trade-layout';

const shopAircraftBuySectionEl = document.createElement('section');
shopAircraftBuySectionEl.className = 'aircraft-trade-section';

const shopAircraftBuyTotalRowEl = document.createElement('p');
shopAircraftBuyTotalRowEl.className = 'airport-interaction-row aircraft-trade-total-row';
shopAircraftBuyTotalRowEl.innerHTML = '<span class="airport-interaction-label">Buy Total:</span> <span class="airport-interaction-value aircraft-trade-total-value" data-shop-aircraft-buy-total>-</span>';
const shopAircraftBuyTotalValueEl = shopAircraftBuyTotalRowEl.querySelector('[data-shop-aircraft-buy-total]');

const shopAircraftBuyControlsEl = document.createElement('div');
shopAircraftBuyControlsEl.className = 'aircraft-trade-controls';

const shopAircraftBuyQuantityColumnEl = document.createElement('div');
shopAircraftBuyQuantityColumnEl.className = 'aircraft-trade-quantity-column';

const shopAircraftQuantityInputEl = document.createElement('input');
shopAircraftQuantityInputEl.type = 'number';
shopAircraftQuantityInputEl.step = '1';
shopAircraftQuantityInputEl.min = '0';
shopAircraftQuantityInputEl.className = 'aircraft-quantity-input aircraft-trade-quantity-input';
shopAircraftQuantityInputEl.setAttribute('aria-label', 'Aircraft purchase quantity');

const shopAircraftMaxLabelEl = document.createElement('button');
shopAircraftMaxLabelEl.type = 'button';
shopAircraftMaxLabelEl.className = 'aircraft-quantity-max-label aircraft-trade-footnote-label';
shopAircraftMaxLabelEl.textContent = 'Max 0';
shopAircraftMaxLabelEl.addEventListener('click', () => {
  if (isAircraftPurchasePending || isAircraftQuotePending) {
    return;
  }

  const normalizedMax = Number.isInteger(aircraftMaxPurchasable) && aircraftMaxPurchasable > 0
    ? aircraftMaxPurchasable
    : 1;
  aircraftPurchaseQuantity = normalizeAircraftPurchaseQuantity(normalizedMax);
  refreshShopAircraftInteractionPanel(gameState.getState());
});

function handleAircraftQuantityInputChanged() {
  const normalizedQuantity = normalizeAircraftPurchaseQuantity(shopAircraftQuantityInputEl.value);
  aircraftPurchaseQuantity = normalizedQuantity;
  refreshShopAircraftInteractionPanel(gameState.getState());
}

shopAircraftQuantityInputEl.addEventListener('input', handleAircraftQuantityInputChanged);
shopAircraftQuantityInputEl.addEventListener('change', handleAircraftQuantityInputChanged);

const shopAircraftBuyButtonEl = document.createElement('button');
shopAircraftBuyButtonEl.type = 'button';
shopAircraftBuyButtonEl.className = 'airport-interaction-action-button shop-aircraft-buy-button shop-aircraft-trade-button';
shopAircraftBuyButtonEl.textContent = 'Buy';
shopAircraftBuyButtonEl.addEventListener('click', () => {
  if (isAircraftPurchasePending || isAircraftQuotePending) {
    return;
  }

  const selectedAircraft = getSelectedAircraftCatalogEntry(gameState.getState());
  if (!selectedAircraft) {
    return;
  }

  const normalizedQuantity = normalizeAircraftPurchaseQuantity(aircraftPurchaseQuantity);
  aircraftPurchaseQuantity = normalizedQuantity;

  const canAffordQuantity = normalizedQuantity >= 1 && normalizedQuantity <= aircraftMaxPurchasable;

  if (!canAffordQuantity) {
    setAircraftSelectionMessage('Insufficient capital for this aircraft.', 'error');
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  isAircraftPurchasePending = true;
  setAircraftSelectionMessage('Submitting purchase request...', 'info');
  refreshShopAircraftInteractionPanel(gameState.getState());
  socket.emit('aircraft:purchase:request', {
    aircraftCatalogId: selectedAircraft.aircraftCatalogId,
    quantity: normalizedQuantity
  });
});

shopAircraftBuyQuantityColumnEl.appendChild(shopAircraftQuantityInputEl);
shopAircraftBuyQuantityColumnEl.appendChild(shopAircraftMaxLabelEl);
shopAircraftBuyControlsEl.appendChild(shopAircraftBuyButtonEl);
shopAircraftBuyControlsEl.appendChild(shopAircraftBuyQuantityColumnEl);

shopAircraftBuySectionEl.appendChild(shopAircraftBuyTotalRowEl);
shopAircraftBuySectionEl.appendChild(shopAircraftBuyControlsEl);

const shopAircraftSellSectionEl = document.createElement('section');
shopAircraftSellSectionEl.className = 'aircraft-trade-section';

const shopAircraftSellTotalRowEl = document.createElement('p');
shopAircraftSellTotalRowEl.className = 'airport-interaction-row aircraft-trade-total-row';
shopAircraftSellTotalRowEl.innerHTML = '<span class="airport-interaction-label">Sell Total:</span> <span class="airport-interaction-value aircraft-trade-total-value" data-shop-aircraft-sell-total>-</span>';
const shopAircraftSellTotalValueEl = shopAircraftSellTotalRowEl.querySelector('[data-shop-aircraft-sell-total]');

const shopAircraftSellControlsEl = document.createElement('div');
shopAircraftSellControlsEl.className = 'aircraft-trade-controls';

const shopAircraftSellQuantityColumnEl = document.createElement('div');
shopAircraftSellQuantityColumnEl.className = 'aircraft-trade-quantity-column';

const shopAircraftSellQuantityInputEl = document.createElement('input');
shopAircraftSellQuantityInputEl.type = 'number';
shopAircraftSellQuantityInputEl.step = '1';
shopAircraftSellQuantityInputEl.min = '0';
shopAircraftSellQuantityInputEl.className = 'aircraft-quantity-input aircraft-trade-quantity-input';
shopAircraftSellQuantityInputEl.setAttribute('aria-label', 'Aircraft sell quantity');

function handleAircraftSellQuantityInputChanged() {
  const rawValue = Number(shopAircraftSellQuantityInputEl.value);
  const parsedValue = Number.isFinite(rawValue) && Number.isInteger(rawValue) ? rawValue : NaN;
  aircraftSellQuantity = normalizeAircraftSellQuantity(parsedValue, aircraftMaxSellable);
  refreshShopAircraftInteractionPanel(gameState.getState());
}

shopAircraftSellQuantityInputEl.addEventListener('input', handleAircraftSellQuantityInputChanged);
shopAircraftSellQuantityInputEl.addEventListener('change', handleAircraftSellQuantityInputChanged);

const shopAircraftSellButtonEl = document.createElement('button');
shopAircraftSellButtonEl.type = 'button';
shopAircraftSellButtonEl.className = 'airport-interaction-action-button shop-aircraft-sell-button shop-aircraft-trade-button';
shopAircraftSellButtonEl.textContent = 'Sell';
shopAircraftSellButtonEl.addEventListener('click', () => {
  if (isAircraftSellPending || isAircraftSellQuotePending) {
    return;
  }

  const selectedAircraft = getSelectedAircraftCatalogEntry(gameState.getState());
  if (!selectedAircraft) {
    return;
  }

  const normalizedSellQuantity = normalizeAircraftSellQuantity(aircraftSellQuantity, aircraftMaxSellable);
  aircraftSellQuantity = normalizedSellQuantity;

  if (normalizedSellQuantity < 1) {
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  const emitted = emitAircraftSellRequest(selectedAircraft.aircraftCatalogId, normalizedSellQuantity);
  if (!emitted) {
    return;
  }

  refreshShopAircraftInteractionPanel(gameState.getState());
});

const shopAircraftOwnedLabelEl = document.createElement('button');
shopAircraftOwnedLabelEl.type = 'button';
shopAircraftOwnedLabelEl.className = 'aircraft-quantity-max-label aircraft-trade-footnote-label';
shopAircraftOwnedLabelEl.textContent = 'Owned 0';
shopAircraftOwnedLabelEl.addEventListener('click', () => {
  if (isAircraftSellPending || isAircraftSellQuotePending) {
    return;
  }

  const normalizedOwnedMax = Number.isInteger(aircraftMaxSellable) && aircraftMaxSellable > 0
    ? aircraftMaxSellable
    : 0;
  aircraftSellQuantity = normalizeAircraftSellQuantity(normalizedOwnedMax, aircraftMaxSellable);
  refreshShopAircraftInteractionPanel(gameState.getState());
});

shopAircraftSellQuantityColumnEl.appendChild(shopAircraftSellQuantityInputEl);
shopAircraftSellQuantityColumnEl.appendChild(shopAircraftOwnedLabelEl);
shopAircraftSellControlsEl.appendChild(shopAircraftSellButtonEl);
shopAircraftSellControlsEl.appendChild(shopAircraftSellQuantityColumnEl);

shopAircraftSellSectionEl.appendChild(shopAircraftSellTotalRowEl);
shopAircraftSellSectionEl.appendChild(shopAircraftSellControlsEl);

shopAircraftTradeLayoutEl.appendChild(shopAircraftBuySectionEl);
shopAircraftTradeLayoutEl.appendChild(shopAircraftSellSectionEl);

shopAircraftSearchContainerEl.appendChild(shopAircraftSearchLabelEl);
shopAircraftSearchContainerEl.appendChild(shopAircraftSearchInputEl);
shopAircraftSearchContainerEl.appendChild(shopAircraftResultsTitleEl);
shopAircraftSearchContainerEl.appendChild(shopAircraftResultsListEl);
shopAircraftPanelEl.appendChild(shopAircraftSearchContainerEl);
shopAircraftDetailsEl.appendChild(shopAircraftTitleEl);
shopAircraftDetailsEl.appendChild(shopAircraftPriceRowEl);
shopAircraftDetailsEl.appendChild(shopAircraftRangeRowEl);
shopAircraftDetailsEl.appendChild(shopAircraftTradeDividerEl);
shopAircraftDetailsEl.appendChild(shopAircraftTradeLayoutEl);
shopAircraftDetailsEl.appendChild(shopAircraftMessageEl);
shopAircraftPanelEl.appendChild(shopAircraftDetailsEl);

shopModalContentEl.appendChild(shopAirportsPanelEl);
shopModalContentEl.appendChild(shopAircraftPanelEl);

shopModalDialogEl.appendChild(shopModalCloseButtonEl);
shopModalDialogEl.appendChild(shopModalTitleEl);
shopModalDialogEl.appendChild(shopModalTabsEl);
shopModalDialogEl.appendChild(shopModalContentEl);
shopModalOverlayEl.appendChild(shopModalDialogEl);

if (gameScreenEl) {
  gameScreenEl.appendChild(shopModalOverlayEl);
}

function formatCurrencyValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return CURRENCY_FORMATTER.format(0);
  }

  return CURRENCY_FORMATTER.format(numericValue);
}

function getAuthoritativeAirportById(state, airportId) {
  const airports = Array.isArray(state && state.game && state.game.airports) ? state.game.airports : [];
  return airports.find((airport) => {
    if (!airport) {
      return false;
    }

    return String(airport.id || airport.iata) === String(airportId);
  }) || null;
}

function getAuthoritativeAirports(state) {
  const airports = Array.isArray(state && state.game && state.game.airports) ? state.game.airports : [];
  return airports.filter((airport) => airport && typeof airport === 'object');
}

function getAuthoritativePlayerById(state, playerId) {
  const players = Array.isArray(state && state.game && state.game.players) ? state.game.players : [];
  return players.find((player) => player && String(player.id) === String(playerId)) || null;
}

function getAircraftCatalogEntries(state) {
  const aircraftCatalog = Array.isArray(state && state.game && state.game.aircraftCatalog) ? state.game.aircraftCatalog : [];
  return aircraftCatalog.filter((aircraft) => aircraft && typeof aircraft === 'object');
}

function setSelectedAirportId(nextAirportId) {
  selectedAirportId = nextAirportId ? String(nextAirportId) : null;
  setShopModalSelectedAirportId(selectedAirportId);
}

function setSelectedAircraftCatalogId(nextAircraftCatalogId) {
  const normalizedNextAircraftCatalogId = nextAircraftCatalogId ? String(nextAircraftCatalogId) : null;
  const didSelectionChange = String(selectedAircraftCatalogId || '') !== String(normalizedNextAircraftCatalogId || '');

  selectedAircraftCatalogId = normalizedNextAircraftCatalogId;

  if (didSelectionChange) {
    // Let the next authoritative purchase quote initialize the default quantity.
    aircraftPurchaseQuantity = null;
  }

  setShopModalSelectedAircraftCatalogId(selectedAircraftCatalogId);
}

function normalizeAircraftPurchaseQuantity(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    const parsedFromString = Number(trimmedValue);
    if (!Number.isFinite(parsedFromString) || !Number.isInteger(parsedFromString)) {
      return null;
    }

    value = parsedFromString;
  }

  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }

  if (value < 1) {
    return 0;
  }

  return value;
}

function normalizeAircraftSellQuantity(value, maxSellable) {
  const normalizedMax = Number.isInteger(maxSellable) && maxSellable > 0 ? maxSellable : 0;
  if (normalizedMax === 0) {
    return 0;
  }

  if (!Number.isInteger(value)) {
    return 1;
  }

  if (value < 1) {
    return 1;
  }

  if (value > normalizedMax) {
    return normalizedMax;
  }

  return value;
}

function applyAuthoritativeAircraftMaxPurchasable(maxPurchasable, { initialize = false } = {}) {
  const normalizedMax = Number.isInteger(maxPurchasable) && maxPurchasable >= 0 ? maxPurchasable : 0;
  aircraftMaxPurchasable = normalizedMax;

  if (initialize) {
    aircraftPurchaseQuantity = null;
    return;
  }

  const normalizedQuantity = normalizeAircraftPurchaseQuantity(aircraftPurchaseQuantity);
  if (normalizedQuantity == null) {
    aircraftPurchaseQuantity = normalizedMax >= 1 ? 1 : 0;
    return;
  }

  aircraftPurchaseQuantity = normalizedQuantity;
}

function applyAuthoritativeAircraftSellQuote(ownedQuantity, maxSellable, unitSellPrice, { initialize = false } = {}) {
  const normalizedOwnedQuantity = Number.isInteger(ownedQuantity) && ownedQuantity >= 0 ? ownedQuantity : 0;
  const normalizedMaxSellable = Number.isInteger(maxSellable) && maxSellable >= 0 ? maxSellable : 0;
  const normalizedUnitSellPrice = Number.isFinite(unitSellPrice) && unitSellPrice >= 0 ? unitSellPrice : 0;

  aircraftOwnedQuantity = normalizedOwnedQuantity;
  aircraftMaxSellable = normalizedMaxSellable;
  aircraftUnitSellPrice = normalizedUnitSellPrice;

  if (initialize) {
    aircraftSellQuantity = normalizedMaxSellable >= 1 ? 1 : 0;
    return;
  }

  aircraftSellQuantity = normalizeAircraftSellQuantity(aircraftSellQuantity, normalizedMaxSellable);
}

function getSelectedAircraftOwnedQuantityFromAuthoritativeState(state, localPlayerId, aircraftCatalogId) {
  const ownedAircraft = Array.isArray(state && state.game && state.game.ownedAircraft)
    ? state.game.ownedAircraft
    : [];
  if (!localPlayerId || !aircraftCatalogId) {
    return 0;
  }

  return ownedAircraft.reduce((count, ownedAircraftInstance) => {
    if (!ownedAircraftInstance || ownedAircraftInstance.ownerPlayerId == null) {
      return count;
    }

    const instanceAircraftCatalogId = String(ownedAircraftInstance.aircraftCatalogId || '');
    const instanceOwnerPlayerId = String(ownedAircraftInstance.ownerPlayerId || '');
    if (
      instanceAircraftCatalogId !== String(aircraftCatalogId) ||
      instanceOwnerPlayerId !== String(localPlayerId)
    ) {
      return count;
    }

    return count + 1;
  }, 0);
}

function getSelectedAircraftEconomicsFingerprint(state) {
  const normalizedState = state || gameState.getState();
  const isInActiveGame =
    normalizedState &&
    normalizedState.ui &&
    normalizedState.ui.screen === 'game' &&
    normalizedState.session &&
    normalizedState.session.currentGameId &&
    normalizedState.game &&
    normalizedState.game.status === 'active';
  if (!isInActiveGame) {
    return null;
  }

  const selectedAircraft = getSelectedAircraftCatalogEntry(normalizedState);
  if (!selectedAircraft || !selectedAircraft.aircraftCatalogId) {
    return null;
  }

  const localPlayerId = normalizedState && normalizedState.session ? normalizedState.session.playerId : null;
  const localPlayer = getAuthoritativePlayerById(normalizedState, localPlayerId);
  const capital = Number.isFinite(localPlayer && localPlayer.capital) ? localPlayer.capital : null;
  const selectedAircraftCatalogId = String(selectedAircraft.aircraftCatalogId);
  const selectedOwnedQuantity = getSelectedAircraftOwnedQuantityFromAuthoritativeState(
    normalizedState,
    localPlayerId,
    selectedAircraftCatalogId
  );

  return `${selectedAircraftCatalogId}|${capital == null ? 'na' : capital}|${selectedOwnedQuantity}`;
}

function refreshSelectedAircraftEconomicsFromServer({ state = gameState.getState(), force = false } = {}) {
  const fingerprint = getSelectedAircraftEconomicsFingerprint(state);
  if (!fingerprint) {
    lastSelectedAircraftEconomicsFingerprint = null;
    return false;
  }

  if (!force && fingerprint === lastSelectedAircraftEconomicsFingerprint) {
    return false;
  }

  // Avoid overlapping quote or mutation flows; success handlers will call this again when safe.
  if (
    isAircraftPurchasePending ||
    isAircraftQuotePending ||
    isAircraftSellPending ||
    isAircraftSellQuotePending
  ) {
    return false;
  }

  const selectedAircraft = getSelectedAircraftCatalogEntry(state);
  if (!selectedAircraft || !selectedAircraft.aircraftCatalogId) {
    lastSelectedAircraftEconomicsFingerprint = null;
    return false;
  }

  lastSelectedAircraftEconomicsFingerprint = fingerprint;
  requestAircraftPurchaseQuote(selectedAircraft.aircraftCatalogId);
  requestAircraftSellQuote(selectedAircraft.aircraftCatalogId);
  return true;
}

function requestAircraftPurchaseQuote(aircraftCatalogId) {
  const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();
  if (!normalizedAircraftCatalogId) {
    isAircraftQuotePending = false;
    pendingAircraftQuoteCatalogId = null;
    applyAuthoritativeAircraftMaxPurchasable(0, { initialize: true });
    return;
  }

  const state = gameState.getState();
  const isInGameScreen = state && state.ui && state.ui.screen === 'game';
  if (!isInGameScreen) {
    isAircraftQuotePending = false;
    pendingAircraftQuoteCatalogId = null;
    applyAuthoritativeAircraftMaxPurchasable(0, { initialize: true });
    return;
  }

  isAircraftQuotePending = true;
  pendingAircraftQuoteCatalogId = normalizedAircraftCatalogId;
  setAircraftSelectionMessage('Loading purchase availability...', 'info');
  refreshShopAircraftInteractionPanel(state);

  socket.emit('aircraft:purchase:request', {
    aircraftCatalogId: normalizedAircraftCatalogId,
    quoteOnly: true
  });
}

function requestAircraftSellQuote(aircraftCatalogId) {
  const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();
  if (!normalizedAircraftCatalogId) {
    isAircraftSellQuotePending = false;
    pendingAircraftSellQuoteCatalogId = null;
    applyAuthoritativeAircraftSellQuote(0, 0, 0, { initialize: true });
    return;
  }

  const state = gameState.getState();
  const isInGameScreen = state && state.ui && state.ui.screen === 'game';
  if (!isInGameScreen) {
    isAircraftSellQuotePending = false;
    pendingAircraftSellQuoteCatalogId = null;
    applyAuthoritativeAircraftSellQuote(0, 0, 0, { initialize: true });
    return;
  }

  if (isAircraftSellPending || isAircraftSellQuotePending) {
    return;
  }

  isAircraftSellQuotePending = true;
  pendingAircraftSellQuoteCatalogId = normalizedAircraftCatalogId;

  socket.emit('aircraft:sell:request', {
    aircraftCatalogId: normalizedAircraftCatalogId,
    quoteOnly: true
  });
}

function emitAircraftSellRequest(aircraftCatalogId, quantity) {
  const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();
  if (!normalizedAircraftCatalogId || isAircraftSellPending || isAircraftSellQuotePending) {
    return false;
  }

  const normalizedSellQuantity = normalizeAircraftSellQuantity(quantity, aircraftMaxSellable);
  if (!Number.isInteger(normalizedSellQuantity) || normalizedSellQuantity < 1) {
    return false;
  }

  isAircraftSellPending = true;
  socket.emit('aircraft:sell:request', {
    aircraftCatalogId: normalizedAircraftCatalogId,
    quantity: normalizedSellQuantity
  });
  return true;
}

function refreshShopModal(state = gameState.getState()) {
  const isAirportsTabActive = ShopModalState.activeTab === SHOP_MODAL_TAB.AIRPORTS;
  const isAircraftTabActive = ShopModalState.activeTab === SHOP_MODAL_TAB.AIRCRAFT;

  if (!isAirportsTabActive && isAirportSearchResultsOpen) {
    setAirportSearchResultsOpen(false);
  }

  if (!isAircraftTabActive && isAircraftSearchResultsOpen) {
    setAircraftSearchResultsOpen(false);
  }

  shopAirportsTabButtonEl.classList.toggle('shop-modal-tab--active', isAirportsTabActive);
  shopAircraftTabButtonEl.classList.toggle('shop-modal-tab--active', isAircraftTabActive);
  shopAirportsTabButtonEl.setAttribute('aria-pressed', isAirportsTabActive ? 'true' : 'false');
  shopAircraftTabButtonEl.setAttribute('aria-pressed', isAircraftTabActive ? 'true' : 'false');

  shopAirportsPanelEl.classList.toggle('hidden', !isAirportsTabActive);
  shopAircraftPanelEl.classList.toggle('hidden', !isAircraftTabActive);
  refreshShopAirportInteractionPanel(state);
  refreshShopAircraftInteractionPanel(state);

  if (ShopModalState.isOpen) {
    shopModalOverlayEl.classList.remove('hidden');
    shopModalOverlayEl.setAttribute('aria-hidden', 'false');
    return;
  }

  shopModalOverlayEl.classList.add('hidden');
  shopModalOverlayEl.setAttribute('aria-hidden', 'true');
}

function emitAirportPurchaseUnownedRequest(airportId) {
  socket.emit('airport:purchase:request', { airportId });
}

function emitAirportPurchaseListedRequest(airportId) {
  socket.emit('airport:purchase-listed:request', { airportId });
}

function emitAirportCancelListingRequest(airportId) {
  socket.emit('airport:listing:cancel:request', { airportId });
}

function emitAirportSellToGameRequest(airportId) {
  socket.emit('airport:sell-to-game:request', { airportId });
}

function emitAirportListRequestWithPrompt(airportId) {
  const rawInput = window.prompt('Enter asking price', '');
  if (rawInput == null) {
    return;
  }

  const askingPrice = Number(String(rawInput).replace(/[,$\s]/g, ''));
  if (!Number.isFinite(askingPrice) || askingPrice <= 0) {
    return;
  }

  socket.emit('airport:list:request', { airportId, askingPrice });
}

function createAirportActionButton(label, onClick, { variant = 'default' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  const classNames = ['airport-interaction-action-button'];
  if (variant === 'buy' || variant === 'sell' || variant === 'list') {
    classNames.push('shop-aircraft-trade-button');
  }

  if (variant === 'buy') {
    classNames.push('shop-aircraft-buy-button');
  } else if (variant === 'sell') {
    classNames.push('shop-aircraft-sell-button');
  } else if (variant === 'list') {
    classNames.push('shop-aircraft-list-button');
  }

  button.className = classNames.join(' ');
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function isAirportOwnedByLocalPlayer(state, airport) {
  const localPlayerId = state && state.session ? state.session.playerId : null;
  const ownerPlayerId = airport && airport.ownerPlayerId;
  return ownerPlayerId != null && localPlayerId != null && String(ownerPlayerId) === String(localPlayerId);
}

function setAirportInteractionFallbackContent({ titleEl, ownerValueEl, priceValueEl, actionsEl, messageEl }) {
  titleEl.textContent = 'Select an airport';
  ownerValueEl.textContent = 'Unknown';
  priceValueEl.textContent = '-';
  actionsEl.innerHTML = '';
  if (messageEl) {
    messageEl.textContent = 'Select an airport from the list to view purchase actions.';
  }
}

function setAirportSearchResultsOpen(isOpen) {
  isAirportSearchResultsOpen = Boolean(isOpen);
  shopAirportResultsTitleEl.classList.toggle('hidden', !isAirportSearchResultsOpen);
  shopAirportResultsListEl.classList.toggle('hidden', !isAirportSearchResultsOpen);
  shopAirportSearchInputEl.setAttribute('aria-expanded', isAirportSearchResultsOpen ? 'true' : 'false');
}

function closeAirportSearchResults({ clearQuery = false, blurInput = false } = {}) {
  if (clearQuery) {
    shopAirportSearchQuery = '';
  }

  if (blurInput) {
    shopAirportSearchInputEl.blur();
  }

  setAirportSearchResultsOpen(false);
}

function setAircraftSearchResultsOpen(isOpen) {
  isAircraftSearchResultsOpen = Boolean(isOpen);
  shopAircraftResultsTitleEl.classList.toggle('hidden', !isAircraftSearchResultsOpen);
  shopAircraftResultsListEl.classList.toggle('hidden', !isAircraftSearchResultsOpen);
  shopAircraftSearchInputEl.setAttribute('aria-expanded', isAircraftSearchResultsOpen ? 'true' : 'false');
}

function closeAircraftSearchResults({ clearQuery = false, blurInput = false } = {}) {
  if (clearQuery) {
    shopAircraftSearchQuery = '';
  }

  if (blurInput) {
    shopAircraftSearchInputEl.blur();
  }

  setAircraftSearchResultsOpen(false);
}

function getAirportDisplayName(airport) {
  const airportName = airport && airport.name ? airport.name : 'Unknown Airport';
  const airportCode = airport && (airport.iata || airport.id) ? (airport.iata || airport.id) : '---';
  return `${airportName} (${airportCode})`;
}

function compareAirportsAlphabetically(leftAirport, rightAirport) {
  const leftName = String((leftAirport && leftAirport.name) || '').toLocaleLowerCase();
  const rightName = String((rightAirport && rightAirport.name) || '').toLocaleLowerCase();
  if (leftName !== rightName) {
    return leftName.localeCompare(rightName);
  }

  const leftCode = String((leftAirport && (leftAirport.iata || leftAirport.id)) || '').toLocaleLowerCase();
  const rightCode = String((rightAirport && (rightAirport.iata || rightAirport.id)) || '').toLocaleLowerCase();
  return leftCode.localeCompare(rightCode);
}

function getAirportSearchDocument(airport) {
  return [
    airport && airport.name,
    airport && airport.iata,
    airport && airport.icao,
    airport && airport.city,
    airport && airport.country
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function compareAircraftAlphabetically(leftAircraft, rightAircraft) {
  const leftName = `${leftAircraft && leftAircraft.manufacturer ? leftAircraft.manufacturer : ''} ${leftAircraft && leftAircraft.model ? leftAircraft.model : ''}`.trim().toLocaleLowerCase();
  const rightName = `${rightAircraft && rightAircraft.manufacturer ? rightAircraft.manufacturer : ''} ${rightAircraft && rightAircraft.model ? rightAircraft.model : ''}`.trim().toLocaleLowerCase();
  if (leftName !== rightName) {
    return leftName.localeCompare(rightName);
  }

  const leftId = String((leftAircraft && leftAircraft.aircraftCatalogId) || '').toLocaleLowerCase();
  const rightId = String((rightAircraft && rightAircraft.aircraftCatalogId) || '').toLocaleLowerCase();
  return leftId.localeCompare(rightId);
}

function getAircraftSearchDocument(aircraft) {
  return [
    aircraft && aircraft.manufacturer,
    aircraft && aircraft.model,
    aircraft && aircraft.aircraftCatalogId
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function getFilteredSortedAircraft(state, rawSearchValue) {
  const normalizedSearch = String(rawSearchValue || '').trim().toLocaleLowerCase();
  const aircraftCatalog = getAircraftCatalogEntries(state).slice().sort(compareAircraftAlphabetically);
  if (!normalizedSearch) {
    return aircraftCatalog;
  }

  return aircraftCatalog.filter((aircraft) => getAircraftSearchDocument(aircraft).includes(normalizedSearch));
}

function getAircraftDisplayName(aircraft) {
  const manufacturer = aircraft && aircraft.manufacturer ? aircraft.manufacturer : 'Unknown';
  const model = aircraft && aircraft.model ? aircraft.model : 'Aircraft';
  return `${manufacturer} ${model}`;
}

function getSelectedAircraftCatalogEntry(state) {
  const aircraftCatalog = getAircraftCatalogEntries(state);
  if (aircraftCatalog.length === 0) {
    return null;
  }

  if (!selectedAircraftCatalogId) {
    return null;
  }

  const selectedAircraft = aircraftCatalog.find(
    (aircraft) => String(aircraft.aircraftCatalogId) === String(selectedAircraftCatalogId)
  );

  if (selectedAircraft) {
    return selectedAircraft;
  }

  setSelectedAircraftCatalogId(null);
  return null;
}

function getFilteredSortedAirports(state, rawSearchValue) {
  const normalizedSearch = String(rawSearchValue || '').trim().toLocaleLowerCase();
  const airports = getAuthoritativeAirports(state).slice().sort(compareAirportsAlphabetically);
  if (!normalizedSearch) {
    return airports;
  }

  return airports.filter((airport) => getAirportSearchDocument(airport).includes(normalizedSearch));
}

function createShopAirportOptionButton(airport) {
  const button = document.createElement('button');
  button.type = 'button';
  const airportId = String(airport.id || airport.iata);
  const isSelected = selectedAirportId != null && String(selectedAirportId) === airportId;
  button.className = `shop-airport-option${isSelected ? ' shop-airport-option--selected' : ''}`;
  button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  button.innerHTML =
    `<span class="shop-airport-option-name">${getAirportDisplayName(airport)}</span>` +
    `<span class="shop-airport-option-meta">${airport.city || 'Unknown City'}, ${airport.country || 'Unknown Country'}</span>`;
  button.addEventListener('click', () => {
    setSelectedAirportId(airportId);
    setShopActiveTab(SHOP_MODAL_TAB.AIRPORTS);
    closeAirportSearchResults({ clearQuery: true, blurInput: true });
    refreshShopAirportInteractionPanel(gameState.getState());
  });
  return button;
}

function createShopAircraftOptionButton(aircraft) {
  const button = document.createElement('button');
  button.type = 'button';
  const aircraftCatalogId = String(aircraft.aircraftCatalogId);
  const isSelected = selectedAircraftCatalogId != null && String(selectedAircraftCatalogId) === aircraftCatalogId;
  button.className = `shop-airport-option${isSelected ? ' shop-airport-option--selected' : ''}`;
  button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  button.innerHTML = `<span class="shop-airport-option-name">${getAircraftDisplayName(aircraft)}</span>`;
  button.addEventListener('click', () => {
    const previousSelection = selectedAircraftCatalogId;
    setSelectedAircraftCatalogId(aircraftCatalogId);
    setShopActiveTab(SHOP_MODAL_TAB.AIRCRAFT);
    closeAircraftSearchResults({ clearQuery: true, blurInput: true });
    if (String(previousSelection || '') !== String(aircraftCatalogId || '')) {
      requestAircraftPurchaseQuote(aircraftCatalogId);
      requestAircraftSellQuote(aircraftCatalogId);
    }
    refreshShopAircraftInteractionPanel(gameState.getState());
  });
  return button;
}

function renderShopAirportSelectorList(state) {
  if (shopAirportSearchInputEl.value !== shopAirportSearchQuery) {
    shopAirportSearchInputEl.value = shopAirportSearchQuery;
  }

  const filteredAirports = getFilteredSortedAirports(state, shopAirportSearchQuery);
  shopAirportResultsTitleEl.textContent = `Matching Airports (${filteredAirports.length})`;
  shopAirportResultsListEl.innerHTML = '';

  if (filteredAirports.length === 0) {
    const emptyEl = document.createElement('p');
    emptyEl.className = 'shop-airport-results-empty';
    emptyEl.textContent = 'No airports match your search.';
    shopAirportResultsListEl.appendChild(emptyEl);
    return;
  }

  filteredAirports.forEach((airport) => {
    shopAirportResultsListEl.appendChild(createShopAirportOptionButton(airport));
  });
}

function renderShopAircraftSelectorList(state) {
  if (shopAircraftSearchInputEl.value !== shopAircraftSearchQuery) {
    shopAircraftSearchInputEl.value = shopAircraftSearchQuery;
  }

  const filteredAircraft = getFilteredSortedAircraft(state, shopAircraftSearchQuery);
  shopAircraftResultsTitleEl.textContent = `Matching Aircraft (${filteredAircraft.length})`;
  shopAircraftResultsListEl.innerHTML = '';

  if (filteredAircraft.length === 0) {
    const emptyEl = document.createElement('p');
    emptyEl.className = 'shop-airport-results-empty';
    emptyEl.textContent = 'No aircraft match your search.';
    shopAircraftResultsListEl.appendChild(emptyEl);
    return;
  }

  filteredAircraft.forEach((aircraft) => {
    shopAircraftResultsListEl.appendChild(createShopAircraftOptionButton(aircraft));
  });
}

function renderAirportInteractionActions(state, airport, actionsEl) {
  actionsEl.innerHTML = '';

  const ownerPlayerId = airport.ownerPlayerId;
  const hasOwner = ownerPlayerId != null;
  const isOwnedByLocalPlayer = isAirportOwnedByLocalPlayer(state, airport);
  const hasListing = !!(airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice));
  const airportId = String(airport.id || airport.iata);

  if (!hasOwner) {
    actionsEl.appendChild(
      createAirportActionButton('Buy', () => emitAirportPurchaseUnownedRequest(airportId), { variant: 'buy' })
    );
    return;
  }

  if (isOwnedByLocalPlayer) {
    if (hasListing) {
      actionsEl.appendChild(
        createAirportActionButton('Unlist', () => emitAirportCancelListingRequest(airportId), { variant: 'list' })
      );
    } else {
      actionsEl.appendChild(
        createAirportActionButton('List', () => emitAirportListRequestWithPrompt(airportId), { variant: 'list' })
      );
    }

    actionsEl.appendChild(
      createAirportActionButton('Sell', () => emitAirportSellToGameRequest(airportId), { variant: 'sell' })
    );
    return;
  }

  if (hasListing) {
    actionsEl.appendChild(
      createAirportActionButton('Buy', () => emitAirportPurchaseListedRequest(airportId), { variant: 'buy' })
    );
  }
}

function renderAirportInteractionPrice(state, airport, priceLabelEl, priceValueEl) {
  priceValueEl.innerHTML = '';

  const isOwnedByLocalPlayer = isAirportOwnedByLocalPlayer(state, airport);
  const hasListingPrice =
    airport && airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice);

  if (isOwnedByLocalPlayer && hasListingPrice) {
    if (priceLabelEl) {
      priceLabelEl.textContent = 'Listed Price:';
    }

    priceValueEl.textContent = formatCurrencyValue(airport.saleListing.askingPrice);
    return;
  }

  if (isOwnedByLocalPlayer) {
    if (priceLabelEl) {
      priceLabelEl.textContent = 'Sell Price:';
    }

    const sellToGamePrice = Number.isFinite(airport && airport.sellToGamePrice)
      ? airport.sellToGamePrice
      : null;
    priceValueEl.textContent = sellToGamePrice == null ? '-' : formatCurrencyValue(sellToGamePrice);
    return;
  }

  if (priceLabelEl) {
    priceLabelEl.textContent = 'Price:';
  }

  const basePrice = formatCurrencyValue(airport.basePrice);
  if (!hasListingPrice) {
    priceValueEl.textContent = basePrice;
    return;
  }

  const basePriceEl = document.createElement('span');
  basePriceEl.className = 'airport-interaction-price-base';
  basePriceEl.textContent = basePrice;

  const listedPriceEl = document.createElement('span');
  listedPriceEl.className = 'airport-interaction-price-listed';
  listedPriceEl.textContent = formatCurrencyValue(airport.saleListing.askingPrice);

  priceValueEl.appendChild(basePriceEl);
  priceValueEl.appendChild(document.createTextNode(' '));
  priceValueEl.appendChild(listedPriceEl);
}

function resolveAirportOwnerText(state, airport) {
  const ownerPlayerId = airport.ownerPlayerId;
  if (ownerPlayerId == null) {
    return 'Unowned';
  }

  const localPlayerId = state && state.session ? state.session.playerId : null;
  if (localPlayerId != null && String(ownerPlayerId) === String(localPlayerId)) {
    return 'You';
  }

  const ownerPlayer = getAuthoritativePlayerById(state, ownerPlayerId);
  if (!ownerPlayer || !ownerPlayer.username) {
    return 'Unknown';
  }

  return ownerPlayer.isBot ? `[Bot] ${ownerPlayer.username}` : ownerPlayer.username;
}

function renderAirportInteractionContent({ titleEl, ownerValueEl, priceLabelEl, priceValueEl, actionsEl, messageEl }, state, airport) {
  const airportCode = airport.iata || airport.id || selectedAirportId;
  const airportName = airport.name || 'Unknown Airport';
  titleEl.textContent = `${airportName} (${airportCode})`;
  ownerValueEl.textContent = resolveAirportOwnerText(state, airport);
  renderAirportInteractionPrice(state, airport, priceLabelEl, priceValueEl);
  renderAirportInteractionActions(state, airport, actionsEl);
  if (messageEl) {
    messageEl.textContent = '';
  }
}

function setAircraftInteractionFallbackContent() {
  shopAircraftTitleEl.textContent = 'Select an aircraft';
  shopAircraftPriceValueEl.textContent = '-';
  shopAircraftRangeValueEl.textContent = '-';
  shopAircraftBuyTotalValueEl.textContent = '-';
  shopAircraftSellTotalValueEl.textContent = '-';
  shopAircraftBuyTotalValueEl.classList.remove('aircraft-order-total-unaffordable');
  shopAircraftQuantityInputEl.value = '0';
  shopAircraftQuantityInputEl.disabled = true;
  shopAircraftSellQuantityInputEl.value = '0';
  shopAircraftSellQuantityInputEl.disabled = true;
  shopAircraftMaxLabelEl.textContent = 'Max 0';
  shopAircraftMaxLabelEl.disabled = true;
  shopAircraftOwnedLabelEl.textContent = 'Owned 0';
  shopAircraftOwnedLabelEl.disabled = true;
  shopAircraftBuyButtonEl.disabled = true;
  shopAircraftBuyButtonEl.textContent = 'Buy';
  shopAircraftSellButtonEl.disabled = true;
  shopAircraftSellButtonEl.textContent = 'Sell';
  if (!shopAircraftMessageEl.textContent) {
    shopAircraftMessageEl.textContent = AIRCRAFT_SELECTION_PLACEHOLDER_MESSAGE;
  }
}

function setAircraftSelectionMessage(message, tone = 'info') {
  shopAircraftMessageEl.textContent = message || '';
  shopAircraftMessageEl.setAttribute('data-tone', tone);
}

function refreshShopAircraftInteractionPanel(state) {
  setAircraftSearchResultsOpen(isAircraftSearchResultsOpen);
  renderShopAircraftSelectorList(state);

  const isInGameScreen = state && state.ui && state.ui.screen === 'game';
  if (!isInGameScreen) {
    setAircraftInteractionFallbackContent();
    shopAircraftDetailsEl.classList.add('hidden');
    return;
  }

  const aircraftCatalog = getAircraftCatalogEntries(state);
  if (aircraftCatalog.length === 0) {
    setSelectedAircraftCatalogId(null);
    setAircraftInteractionFallbackContent();
    shopAircraftDetailsEl.classList.add('hidden');
    return;
  }

  const selectedAircraft = getSelectedAircraftCatalogEntry(state);
  if (!selectedAircraft) {
    isAircraftQuotePending = false;
    pendingAircraftQuoteCatalogId = null;
    isAircraftSellQuotePending = false;
    pendingAircraftSellQuoteCatalogId = null;
    applyAuthoritativeAircraftMaxPurchasable(0, { initialize: true });
    applyAuthoritativeAircraftSellQuote(0, 0, 0, { initialize: true });
    setAircraftInteractionFallbackContent();
    shopAircraftDetailsEl.classList.add('hidden');
    return;
  }

  shopAircraftDetailsEl.classList.remove('hidden');

  shopAircraftTitleEl.textContent = getAircraftDisplayName(selectedAircraft);
  shopAircraftPriceValueEl.textContent = formatCurrencyValue(selectedAircraft.purchasePrice);
  const rangeKm = Number.isFinite(selectedAircraft.rangeKm) ? selectedAircraft.rangeKm : 0;
  shopAircraftRangeValueEl.textContent = `${INTEGER_FORMATTER.format(rangeKm)} km`;
  const normalizedQuantity = normalizeAircraftPurchaseQuantity(aircraftPurchaseQuantity);
  aircraftPurchaseQuantity = normalizedQuantity;
  const enteredQuantity = Number.isInteger(normalizedQuantity) ? normalizedQuantity : 0;
  const unitPrice = Number.isFinite(selectedAircraft.purchasePrice) ? selectedAircraft.purchasePrice : 0;
  const buyTotal = unitPrice * enteredQuantity;
  shopAircraftBuyTotalValueEl.textContent = formatCurrencyValue(buyTotal);
  const canAffordQuantity = enteredQuantity >= 1 && enteredQuantity <= aircraftMaxPurchasable;
  const exceedsMaxPurchasable = enteredQuantity > aircraftMaxPurchasable;
  const isBuyDisabled = isAircraftPurchasePending || isAircraftQuotePending || !canAffordQuantity;
  shopAircraftBuyTotalValueEl.classList.toggle('aircraft-order-total-unaffordable', exceedsMaxPurchasable);

  shopAircraftQuantityInputEl.value = normalizedQuantity == null ? '' : String(normalizedQuantity);
  shopAircraftQuantityInputEl.disabled = isAircraftPurchasePending || isAircraftQuotePending;
  shopAircraftMaxLabelEl.textContent = `Max ${INTEGER_FORMATTER.format(aircraftMaxPurchasable)}`;
  shopAircraftMaxLabelEl.disabled = isAircraftPurchasePending || isAircraftQuotePending || aircraftMaxPurchasable < 1;

  shopAircraftBuyButtonEl.disabled = isBuyDisabled;
  shopAircraftBuyButtonEl.textContent = isAircraftPurchasePending ? 'Buying...' : 'Buy';

  const normalizedSellQuantity = normalizeAircraftSellQuantity(aircraftSellQuantity, aircraftMaxSellable);
  aircraftSellQuantity = normalizedSellQuantity;
  const sellTotal = aircraftUnitSellPrice * normalizedSellQuantity;
  const canSellQuantity = normalizedSellQuantity >= 1 && normalizedSellQuantity <= aircraftMaxSellable;

  shopAircraftSellTotalValueEl.textContent = formatCurrencyValue(sellTotal);
  shopAircraftSellQuantityInputEl.value = String(normalizedSellQuantity);
  shopAircraftSellQuantityInputEl.disabled =
    isAircraftSellPending || isAircraftSellQuotePending || aircraftMaxSellable === 0;
  shopAircraftSellButtonEl.disabled =
    isAircraftSellPending || isAircraftSellQuotePending || !canSellQuantity;
  shopAircraftSellButtonEl.textContent = isAircraftSellPending ? 'Selling...' : 'Sell';
  shopAircraftOwnedLabelEl.textContent = `Owned ${INTEGER_FORMATTER.format(aircraftOwnedQuantity)}`;
  shopAircraftOwnedLabelEl.disabled =
    isAircraftSellPending || isAircraftSellQuotePending || aircraftMaxSellable < 1;

  if (shopAircraftMessageEl.textContent === AIRCRAFT_SELECTION_PLACEHOLDER_MESSAGE) {
    setAircraftSelectionMessage('', 'info');
  }
}

function refreshShopAirportInteractionPanel(state) {
  setAirportSearchResultsOpen(isAirportSearchResultsOpen);
  renderShopAirportSelectorList(state);

  const isInGameScreen = state && state.ui && state.ui.screen === 'game';
  if (!isInGameScreen) {
    shopAirportDetailsEl.classList.add('hidden');
    return;
  }

  if (selectedAirportId) {
    const hasSelectedAirport = !!getAuthoritativeAirportById(state, selectedAirportId);
    if (!hasSelectedAirport) {
      setSelectedAirportId(null);
    }
  }

  if (!selectedAirportId) {
    shopAirportDetailsEl.classList.add('hidden');
    return;
  }

  const airport = getAuthoritativeAirportById(state, selectedAirportId);
  if (!airport) {
    shopAirportDetailsEl.classList.add('hidden');
    return;
  }

  shopAirportDetailsEl.classList.remove('hidden');

  renderAirportInteractionContent({
    titleEl: shopAirportTitleEl,
    ownerValueEl: shopAirportOwnerValueEl,
    priceLabelEl: shopAirportPriceLabelEl,
    priceValueEl: shopAirportPriceValueEl,
    actionsEl: shopAirportActionsEl,
    messageEl: shopAirportMessageEl
  }, state, airport);
}

function openShopFromAirportMarker(airportId) {
  if (!airportId) {
    return;
  }

  setSelectedAirportId(String(airportId));
  setShopActiveTab(SHOP_MODAL_TAB.AIRPORTS);
  setShopModalOpenedFrom(SHOP_MODAL_OPENED_FROM.AIRPORT_MARKER);
  closeAirportSearchResults({ clearQuery: true });
  openShopModal({ openedFrom: SHOP_MODAL_OPENED_FROM.AIRPORT_MARKER });
}

renderer.setAirportSelectHandler(openShopFromAirportMarker);
renderer.setAircraftSelectHandler(openShopFromHud);

shopAirportsTabButtonEl.addEventListener('click', () => {
  setShopActiveTab(SHOP_MODAL_TAB.AIRPORTS);
  refreshShopModal(gameState.getState());
});

shopAircraftTabButtonEl.addEventListener('click', () => {
  setShopActiveTab(SHOP_MODAL_TAB.AIRCRAFT);
  refreshShopModal(gameState.getState());
});

shopModalCloseButtonEl.addEventListener('click', () => {
  closeShopModal();
});

shopModalOverlayEl.addEventListener('click', (event) => {
  if (shouldIgnoreNextOverlayClick) {
    shouldIgnoreNextOverlayClick = false;
    return;
  }

  if (event.target !== shopModalOverlayEl) {
    return;
  }

  closeShopModal();
});

shopAirportSearchInputEl.addEventListener('input', () => {
  shopAirportSearchQuery = shopAirportSearchInputEl.value;
  setAirportSearchResultsOpen(true);
  refreshShopAirportInteractionPanel(gameState.getState());
});

shopAirportSearchInputEl.addEventListener('focus', () => {
  setAirportSearchResultsOpen(true);
  refreshShopAirportInteractionPanel(gameState.getState());
});

shopAirportSearchInputEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  closeAirportSearchResults({ clearQuery: true, blurInput: true });
  refreshShopAirportInteractionPanel(gameState.getState());
});

shopAircraftSearchInputEl.addEventListener('input', () => {
  shopAircraftSearchQuery = shopAircraftSearchInputEl.value;
  setAircraftSearchResultsOpen(true);
  refreshShopAircraftInteractionPanel(gameState.getState());
});

shopAircraftSearchInputEl.addEventListener('focus', () => {
  setAircraftSearchResultsOpen(true);
  refreshShopAircraftInteractionPanel(gameState.getState());
});

shopAircraftSearchInputEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  closeAircraftSearchResults({ clearQuery: true, blurInput: true });
  refreshShopAircraftInteractionPanel(gameState.getState());
});

document.addEventListener('mousedown', (event) => {
  if (!isAirportSearchResultsOpen && !isAircraftSearchResultsOpen) {
    return;
  }

  const isInsideAirportSearch = shopAirportSearchContainerEl.contains(event.target);
  const isInsideAircraftSearch = shopAircraftSearchContainerEl.contains(event.target);

  if (isInsideAirportSearch || isInsideAircraftSearch) {
    return;
  }

  if (shopModalDialogEl.contains(event.target)) {
    shouldIgnoreNextOverlayClick = true;
  }

  if (isAirportSearchResultsOpen) {
    closeAirportSearchResults();
  }

  if (isAircraftSearchResultsOpen) {
    closeAircraftSearchResults();
  }

  refreshShopAirportInteractionPanel(gameState.getState());
  refreshShopAircraftInteractionPanel(gameState.getState());
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  if (document.activeElement === shopAirportSearchInputEl) {
    event.preventDefault();
    closeAirportSearchResults({ clearQuery: true, blurInput: true });
    refreshShopAirportInteractionPanel(gameState.getState());
    return;
  }

  if (document.activeElement === shopAircraftSearchInputEl) {
    event.preventDefault();
    closeAircraftSearchResults({ clearQuery: true, blurInput: true });
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  if (!shopModalOverlayEl.classList.contains('hidden')) {
    closeShopModal();
  }
});

function sanitizeUsername(rawValue) {
  const trimmed = (rawValue || '').trim();
  const cleaned = trimmed.replace(/[^A-Za-z0-9 _-]/g, '');
  return cleaned.slice(0, 25);
}

function getUsernameForJoin() {
  const sanitized = sanitizeUsername(usernameInputEl.value);
  usernameInputEl.value = sanitized;
  return sanitized;
}

function normalizeLobbySnapshot(payload) {
  const source = payload || {};
  return {
    lobbyId: source.lobbyId || null,
    status: source.status === 'countdown' ? 'countdown' : 'waiting',
    playerCount: Number.isFinite(source.playerCount) ? source.playerCount : 0,
    maxPlayers: Number.isFinite(source.maxPlayers) ? source.maxPlayers : 5,
    players: Array.isArray(source.players)
      ? source.players.map((player) => ({
          ...player,
          isBot: Boolean(player && player.isBot)
        }))
      : [],
    botFillInProgress: Boolean(source.botFillInProgress),
    countdownSeconds: Number.isFinite(source.countdown) ? source.countdown : null
  };
}

function applyLobbySnapshot(payload) {
  const lobbySnapshot = normalizeLobbySnapshot(payload);
  gameState.update(() => ({
    lobby: lobbySnapshot
  }));
}

setInterval(() => {
  gameState.update((state) => {
    const shouldAnimateLobbyDots = state.lobby.status === 'waiting' || state.lobby.status === 'countdown';
    if (!shouldAnimateLobbyDots) {
      return null;
    }

    return {
      waitingAnimation: {
        step: (state.waitingAnimation.step + 1) % 4
      }
    };
  });
}, 850);

joinButtonEl.addEventListener('click', () => {
  const state = gameState.getState();
  const isConnected = state.connection.status === 'connected';

  if (!isConnected || state.session.joinPending) {
    return;
  }

  if (!state.session.joined) {
    gameState.update(() => ({
      session: { joinPending: true },
      ui: { errorMessage: null }
    }));

    const username = getUsernameForJoin();
    socket.emit('lobby:join', { username });
    return;
  }

  gameState.update(() => ({
    session: { joinPending: true },
    ui: { errorMessage: null }
  }));

  socket.emit('lobby:leave');
});

if (botFillButtonEl) {
  botFillButtonEl.addEventListener('click', () => {
    const state = gameState.getState();
    const isConnected = state.connection.status === 'connected';

    if (!isConnected || !state.session.joined || state.session.joinPending || state.session.botFillPending) {
      return;
    }

    gameState.update(() => ({
      session: { botFillPending: true },
      ui: { errorMessage: null }
    }));

    socket.emit('lobby:bot-fill');
  });
}

usernameInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    joinButtonEl.click();
  }
});

if (devAddScoreButtonEl) {
  devAddScoreButtonEl.addEventListener('click', () => {
    const state = gameState.getState();
    const isConnected = state.connection.status === 'connected';
    const inGame = state.ui.screen === 'game' && !!state.session.currentGameId;

    if (!isConnected || !inGame) {
      return;
    }

    socket.emit('dev:score:add');
  });
}

socket.on('connect', () => {
  gameState.update(() => ({
    connection: { status: 'connected' }
  }));

  console.log('Connected to the server.');
});

socket.on('disconnect', () => {
  stopGameCountdown();
  isAircraftPurchasePending = false;
  isAircraftQuotePending = false;
  pendingAircraftQuoteCatalogId = null;
  isAircraftSellPending = false;
  isAircraftSellQuotePending = false;
  pendingAircraftSellQuoteCatalogId = null;
  applyAuthoritativeAircraftMaxPurchasable(0, { initialize: true });
  applyAuthoritativeAircraftSellQuote(0, 0, 0, { initialize: true });
  gameState.update(() => ({
    connection: { status: 'disconnected' },
    session: {
      playerId: null,
      joined: false,
      joinPending: false,
      botFillPending: false,
      currentLobbyId: null,
      currentGameId: null,
      gameEvents: []
    },
    lobby: getEmptyLobbyState(),
    ui: {
      errorMessage: 'Connection lost. Reconnecting...',
      screen: 'lobby'
    },
    game: getEmptyGameState()
  }));
});

socket.on('connection:ready', ({ playerId }) => {
  gameState.update(() => ({
    session: { playerId }
  }));

  console.log(`Player ID ready: ${playerId}`);
});

socket.on('lobby:preview', (payload) => {
  const state = gameState.getState();
  if (state.session.joined || state.session.currentGameId) {
    return;
  }

  applyLobbySnapshot(payload);
});

socket.on('lobby:joined', ({ lobbyId, playerId, username }) => {
  if (typeof username === 'string') {
    usernameInputEl.value = username;
  }

  gameState.update(() => ({
    session: {
      playerId,
      joined: true,
      joinPending: false,
      botFillPending: false,
      currentLobbyId: lobbyId
    }
  }));

  console.log(`Joined lobby ${lobbyId} as ${playerId}.`);
});

socket.on('lobby:left', ({ lobbyId, playerId }) => {
  stopGameCountdown();
  gameState.update(() => ({
    session: {
      joined: false,
      joinPending: false,
      botFillPending: false,
      currentLobbyId: null
    },
    lobby: getEmptyLobbyState()
  }));

  console.log(`Left lobby ${lobbyId} as ${playerId}.`);
});

socket.on('game:left', ({ gameId, playerId }) => {
  stopGameCountdown();
  closeShopModal();
  isAircraftPurchasePending = false;
  isAircraftQuotePending = false;
  pendingAircraftQuoteCatalogId = null;
  isAircraftSellPending = false;
  isAircraftSellQuotePending = false;
  pendingAircraftSellQuoteCatalogId = null;
  applyAuthoritativeAircraftMaxPurchasable(0, { initialize: true });
  applyAuthoritativeAircraftSellQuote(0, 0, 0, { initialize: true });
  gameState.update(() => ({
    session: {
      joinPending: false,
      botFillPending: false,
      currentGameId: null,
      joined: false,
      currentLobbyId: null,
      gameEvents: []
    },
    lobby: getEmptyLobbyState(),
    ui: {
      screen: 'lobby'
    },
    game: getEmptyGameState()
  }));

  console.log(`Left game ${gameId} as ${playerId}.`);
});

socket.on('lobby:update', (payload) => {
  if (payload && payload.lobbyId) {
    gameState.update(() => ({
      session: { botFillPending: false }
    }));
    applyLobbySnapshot(payload);
  }
});

socket.on('lobby:countdown', ({ secondsRemaining }) => {
  gameState.update(() => ({
    lobby: {
      status: 'countdown',
      countdownSeconds: secondsRemaining
    }
  }));
});

socket.on('lobby:countdown-cancelled', ({ lobbyId, message }) => {
  gameState.update(() => ({
    lobby: {
      status: 'waiting',
      countdownSeconds: null
    }
  }));

  console.warn(`${message} (${lobbyId})`);
});

socket.on('lobby:error', ({ message }) => {
  gameState.update(() => ({
    session: { joinPending: false, botFillPending: false },
    ui: { errorMessage: message || '' }
  }));

  if (message) {
    console.error(message);
  }
});

socket.on('lobby:bot-fill:result', (result = {}) => {
  gameState.update(() => ({
    session: { botFillPending: false }
  }));

  if (!result.success && result.message) {
    gameState.update(() => ({
      ui: { errorMessage: result.message }
    }));
  }
});

function applyAuthoritativeGamePayload(payload) {
  const authoritativeGame = payload && payload.game ? payload.game : getEmptyGameState();

  gameState.update(() => ({
    session: {
      currentGameId: authoritativeGame.id,
      joinPending: false,
      botFillPending: false
    },
    ui: { screen: 'game' },
    game: authoritativeGame
  }));

  startGameCountdown();

  return authoritativeGame;
}

socket.on('game:started', (payload) => {
  clearGameEventHistory();
  applyAuthoritativeGamePayload(payload);
  refreshSelectedAircraftEconomicsFromServer({ state: gameState.getState() });

  console.log('Game started.');
});

socket.on('game:state', (payload) => {
  applyAuthoritativeGamePayload(payload);
  refreshSelectedAircraftEconomicsFromServer({ state: gameState.getState() });
});

socket.on('game:event', (eventPayload) => {
  appendGameEventToHistory(eventPayload);
});

socket.on('aircraft:purchase:result', (result = {}) => {
  const resultAircraftCatalogId = String(result.aircraftCatalogId || '');
  const expectedQuoteCatalogId = String(pendingAircraftQuoteCatalogId || '');

  if (
    isAircraftQuotePending &&
    !isAircraftPurchasePending &&
    resultAircraftCatalogId &&
    expectedQuoteCatalogId &&
    resultAircraftCatalogId !== expectedQuoteCatalogId
  ) {
    return;
  }

  const isQuoteResponse =
    isAircraftQuotePending &&
    !isAircraftPurchasePending &&
    (
      (resultAircraftCatalogId && expectedQuoteCatalogId && resultAircraftCatalogId === expectedQuoteCatalogId) ||
      (!result.success && !resultAircraftCatalogId)
    );

  if (isQuoteResponse) {
    if (resultAircraftCatalogId && expectedQuoteCatalogId && resultAircraftCatalogId !== expectedQuoteCatalogId) {
      return;
    }

    isAircraftQuotePending = false;
    pendingAircraftQuoteCatalogId = null;

    const selectedAircraft = getSelectedAircraftCatalogEntry(gameState.getState());
    if (!selectedAircraft || String(selectedAircraft.aircraftCatalogId) !== resultAircraftCatalogId) {
      refreshShopAircraftInteractionPanel(gameState.getState());
      return;
    }

    if (!result.success) {
      applyAuthoritativeAircraftMaxPurchasable(0, { initialize: false });
      setAircraftSelectionMessage(result.message || 'Unable to load purchase availability.', 'error');
      refreshShopAircraftInteractionPanel(gameState.getState());
      return;
    }

    applyAuthoritativeAircraftMaxPurchasable(result.maxPurchasable, { initialize: false });
    setAircraftSelectionMessage('', 'info');
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  isAircraftPurchasePending = false;
  isAircraftQuotePending = false;
  pendingAircraftQuoteCatalogId = null;

  if (result && Number.isInteger(result.maxPurchasable) && result.maxPurchasable >= 0) {
    applyAuthoritativeAircraftMaxPurchasable(result.maxPurchasable, { initialize: false });
  }

  if (!result.success) {
    const message = result.message || 'Aircraft purchase failed.';
    setAircraftSelectionMessage(message, 'error');
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  refreshSelectedAircraftEconomicsFromServer({ force: true });
  setShopActiveTab(SHOP_MODAL_TAB.AIRCRAFT);
  setAircraftSelectionMessage('', 'info');
  refreshShopModal(gameState.getState());
});

socket.on('aircraft:sell:result', (result = {}) => {
  const resultAircraftCatalogId = String(result.aircraftCatalogId || '');
  const expectedQuoteCatalogId = String(pendingAircraftSellQuoteCatalogId || '');

  if (
    isAircraftSellQuotePending &&
    !isAircraftSellPending &&
    resultAircraftCatalogId &&
    expectedQuoteCatalogId &&
    resultAircraftCatalogId !== expectedQuoteCatalogId
  ) {
    return;
  }

  const isQuoteResponse =
    isAircraftSellQuotePending &&
    !isAircraftSellPending &&
    (
      (resultAircraftCatalogId && expectedQuoteCatalogId && resultAircraftCatalogId === expectedQuoteCatalogId) ||
      (!result.success && !resultAircraftCatalogId)
    );

  if (isQuoteResponse) {
    isAircraftSellQuotePending = false;
    pendingAircraftSellQuoteCatalogId = null;

    const selectedAircraft = getSelectedAircraftCatalogEntry(gameState.getState());
    if (!selectedAircraft || String(selectedAircraft.aircraftCatalogId) !== resultAircraftCatalogId) {
      refreshShopAircraftInteractionPanel(gameState.getState());
      return;
    }

    if (!result.success) {
      applyAuthoritativeAircraftSellQuote(0, 0, 0, { initialize: false });
      refreshShopAircraftInteractionPanel(gameState.getState());
      return;
    }

    applyAuthoritativeAircraftSellQuote(result.ownedQuantity, result.maxSellable, result.unitSellPrice, {
      initialize: true
    });
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  if (!isAircraftSellPending) {
    return;
  }

  isAircraftSellPending = false;

  if (!result.success) {
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  applyAuthoritativeAircraftSellQuote(result.ownedQuantity, result.maxSellable, result.unitSellPrice, {
    initialize: false
  });
  refreshSelectedAircraftEconomicsFromServer({ force: true });
  refreshShopAircraftInteractionPanel(gameState.getState());
});

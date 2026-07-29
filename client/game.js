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
    currentGameId: null
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
shopAirportPriceRowEl.innerHTML = '<span class="airport-interaction-label">Price:</span> <span class="airport-interaction-value" data-shop-airport-price>-</span>';
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

const shopAircraftMessageEl = document.createElement('p');
shopAircraftMessageEl.className = 'airport-interaction-row';
shopAircraftMessageEl.textContent = AIRCRAFT_SELECTION_PLACEHOLDER_MESSAGE;

const shopAircraftActionsEl = document.createElement('div');
shopAircraftActionsEl.className = 'airport-interaction-actions';

const shopAircraftBuyButtonEl = document.createElement('button');
shopAircraftBuyButtonEl.type = 'button';
shopAircraftBuyButtonEl.className = 'airport-interaction-action-button';
shopAircraftBuyButtonEl.textContent = 'Buy';
shopAircraftBuyButtonEl.addEventListener('click', () => {
  if (isAircraftPurchasePending) {
    return;
  }

  const selectedAircraft = getSelectedAircraftCatalogEntry(gameState.getState());
  if (!selectedAircraft) {
    return;
  }

  isAircraftPurchasePending = true;
  setAircraftSelectionMessage('Submitting purchase request...', 'info');
  refreshShopAircraftInteractionPanel(gameState.getState());
  socket.emit('aircraft:purchase:request', {
    aircraftCatalogId: selectedAircraft.aircraftCatalogId
  });
});

shopAircraftActionsEl.appendChild(shopAircraftBuyButtonEl);

shopAircraftSearchContainerEl.appendChild(shopAircraftSearchLabelEl);
shopAircraftSearchContainerEl.appendChild(shopAircraftSearchInputEl);
shopAircraftSearchContainerEl.appendChild(shopAircraftResultsTitleEl);
shopAircraftSearchContainerEl.appendChild(shopAircraftResultsListEl);
shopAircraftPanelEl.appendChild(shopAircraftSearchContainerEl);
shopAircraftDetailsEl.appendChild(shopAircraftTitleEl);
shopAircraftDetailsEl.appendChild(shopAircraftPriceRowEl);
shopAircraftDetailsEl.appendChild(shopAircraftRangeRowEl);
shopAircraftDetailsEl.appendChild(shopAircraftMessageEl);
shopAircraftDetailsEl.appendChild(shopAircraftActionsEl);
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
  selectedAircraftCatalogId = nextAircraftCatalogId ? String(nextAircraftCatalogId) : null;
  setShopModalSelectedAircraftCatalogId(selectedAircraftCatalogId);
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

function createAirportActionButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'airport-interaction-action-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
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
    setSelectedAircraftCatalogId(aircraftCatalogId);
    setShopActiveTab(SHOP_MODAL_TAB.AIRCRAFT);
    closeAircraftSearchResults({ clearQuery: true, blurInput: true });
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

  const localPlayerId = state && state.session ? state.session.playerId : null;
  const ownerPlayerId = airport.ownerPlayerId;
  const hasOwner = ownerPlayerId != null;
  const isOwnedByLocalPlayer = hasOwner && localPlayerId != null && String(ownerPlayerId) === String(localPlayerId);
  const hasListing = !!(airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice));
  const airportId = String(airport.id || airport.iata);

  if (!hasOwner) {
    actionsEl.appendChild(
      createAirportActionButton('Purchase', () => emitAirportPurchaseUnownedRequest(airportId))
    );
    return;
  }

  if (isOwnedByLocalPlayer) {
    if (hasListing) {
      actionsEl.appendChild(
        createAirportActionButton('Cancel Listing', () => emitAirportCancelListingRequest(airportId))
      );
    } else {
      actionsEl.appendChild(
        createAirportActionButton('List', () => emitAirportListRequestWithPrompt(airportId))
      );
    }

    actionsEl.appendChild(
      createAirportActionButton('Sell to Game', () => emitAirportSellToGameRequest(airportId))
    );
    return;
  }

  if (hasListing) {
    actionsEl.appendChild(
      createAirportActionButton('Purchase', () => emitAirportPurchaseListedRequest(airportId))
    );
  }
}

function renderAirportInteractionPrice(airport, priceValueEl) {
  priceValueEl.innerHTML = '';
  const basePrice = formatCurrencyValue(airport.basePrice);
  const hasListingPrice =
    airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice);

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

function renderAirportInteractionContent({ titleEl, ownerValueEl, priceValueEl, actionsEl, messageEl }, state, airport) {
  const airportCode = airport.iata || airport.id || selectedAirportId;
  const airportName = airport.name || 'Unknown Airport';
  titleEl.textContent = `${airportName} (${airportCode})`;
  ownerValueEl.textContent = resolveAirportOwnerText(state, airport);
  renderAirportInteractionPrice(airport, priceValueEl);
  renderAirportInteractionActions(state, airport, actionsEl);
  if (messageEl) {
    messageEl.textContent = '';
  }
}

function setAircraftInteractionFallbackContent() {
  shopAircraftTitleEl.textContent = 'Select an aircraft';
  shopAircraftPriceValueEl.textContent = '-';
  shopAircraftRangeValueEl.textContent = '-';
  shopAircraftBuyButtonEl.disabled = true;
  shopAircraftBuyButtonEl.textContent = 'Buy';
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
    shopAircraftDetailsEl.classList.add('hidden');
    return;
  }

  const aircraftCatalog = getAircraftCatalogEntries(state);
  if (aircraftCatalog.length === 0) {
    setSelectedAircraftCatalogId(null);
    shopAircraftDetailsEl.classList.add('hidden');
    return;
  }

  const selectedAircraft = getSelectedAircraftCatalogEntry(state);
  if (!selectedAircraft) {
    shopAircraftDetailsEl.classList.add('hidden');
    return;
  }

  shopAircraftDetailsEl.classList.remove('hidden');

  shopAircraftTitleEl.textContent = getAircraftDisplayName(selectedAircraft);
  shopAircraftPriceValueEl.textContent = formatCurrencyValue(selectedAircraft.purchasePrice);
  const rangeKm = Number.isFinite(selectedAircraft.rangeKm) ? selectedAircraft.rangeKm : 0;
  shopAircraftRangeValueEl.textContent = `${INTEGER_FORMATTER.format(rangeKm)} km`;
  shopAircraftBuyButtonEl.disabled = isAircraftPurchasePending;
  shopAircraftBuyButtonEl.textContent = isAircraftPurchasePending ? 'Buying...' : 'Buy';
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
  gameState.update(() => ({
    connection: { status: 'disconnected' },
    session: {
      playerId: null,
      joined: false,
      joinPending: false,
      botFillPending: false,
      currentLobbyId: null,
      currentGameId: null
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
  gameState.update(() => ({
    session: {
      joinPending: false,
      botFillPending: false,
      currentGameId: null,
      joined: false,
      currentLobbyId: null
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
  applyAuthoritativeGamePayload(payload);

  console.log('Game started.');
});

socket.on('game:state', (payload) => {
  applyAuthoritativeGamePayload(payload);
});

socket.on('aircraft:purchase:result', (result = {}) => {
  isAircraftPurchasePending = false;

  if (!result.success) {
    const message = result.message || 'Aircraft purchase failed.';
    setAircraftSelectionMessage(message, 'error');
    refreshShopAircraftInteractionPanel(gameState.getState());
    return;
  }

  setShopActiveTab(SHOP_MODAL_TAB.AIRCRAFT);
  setAircraftSelectionMessage(result.message || 'Aircraft purchased.', 'success');
  refreshShopModal(gameState.getState());
});

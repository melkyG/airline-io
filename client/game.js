const socket = io();

const joinButtonEl = document.getElementById('joinButton');
const botFillButtonEl = document.getElementById('botFillButton');
const usernameInputEl = document.getElementById('usernameInput');
const gameTimerEl = document.getElementById('gameTimer');
const devAddScoreButtonEl = document.getElementById('devAddScoreButton');
const gameScreenEl = document.getElementById('gameScreen');
const capitalHudEl = document.getElementById('capitalHud');
const lobbyColorPickerEl = document.getElementById('lobbyColorPicker');
const lobbyColorPickerRowEl = document.getElementById('lobbyColorPickerRow');
const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});
const INTEGER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0
});
const SIMULATION_CLOCK_TICK_MS = 750;
const SIMULATION_HOUR_MS = 60 * 60 * 1000;
const SIMULATION_HOURS_PER_DAY = 24;
const SIMULATION_DAYS_PER_MONTH = 30;
const SIMULATION_MONTHS_PER_YEAR = 12;
const SIMULATION_DAYS_PER_YEAR = SIMULATION_DAYS_PER_MONTH * SIMULATION_MONTHS_PER_YEAR;
let gameCountdownIntervalId = null;
let simulationClockIntervalId = null;
let simulationClockSnapshot = {
  simulationStartedAtRealMs: null,
  simulationStartedAtGameMs: null,
  simulationSpeedMultiplier: null,
  simulationEndedAtGameMs: null,
  simulationNowGameMs: null,
  worldCalendarStartYear: null
};
let lastRenderedSimulationDateText = '';
let lastRenderedSimulationTimeText = '';
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
let isAircraftPurchaseQuantityEditing = false;
let aircraftPurchaseQuantityRawInput = '';
let isAircraftSellQuantityEditing = false;
let aircraftSellQuantityRawInput = '';
let aircraftOwnedQuantity = 0;
let aircraftMaxSellable = 0;
let aircraftUnitSellPrice = 0;
let lastSelectedAircraftEconomicsFingerprint = null;
let shopAirportSearchQuery = '';
let isAirportSearchResultsOpen = false;
let shopAircraftSearchQuery = '';
let isAircraftSearchResultsOpen = false;
let selectedRouteOriginAirportId = null;
let selectedRouteDestinationAirportId = null;
let routeOriginSearchQuery = '';
let routeDestinationSearchQuery = '';
let isRouteOriginDropdownOpen = false;
let isRouteDestinationDropdownOpen = false;
let isRoutesModalDomReady = false;
let isRouteCreatePending = false;
let routeCreateErrorMessage = '';
let pendingRouteRemoveRouteId = null;
let routeRemoveErrorMessage = '';
let selectedRouteAircraftManagementRouteId = null;
let pendingRouteAircraftAssignAircraftInstanceId = null;
let pendingRouteAircraftUnassignAircraftInstanceId = null;
let routeAircraftManagementErrorMessage = '';
let routeAircraftManagementFeedbackKind = 'error';
let routeAircraftModelEditLockRefreshTimeoutId = null;
let lastScheduledModelEditLockRefreshExpiry = null;
let routeAircraftLearnedModelEditLocks = new Map();
let routeAircraftAssignQuantityByCatalogId = new Map();
let routeAircraftUnassignQuantityByCatalogId = new Map();
let routeAircraftAssignQuantityInputByCatalogId = new Map();
let routeAircraftUnassignQuantityInputByCatalogId = new Map();
let routeAircraftAssignMaxByCatalogId = new Map();
let routeAircraftUnassignMaxByCatalogId = new Map();
let routeAvailableAircraftGroupByCatalogId = new Map();
let routeAssignedAircraftGroupByCatalogId = new Map();
let routeAvailableAircraftRowByCatalogId = new Map();
let routeAssignedAircraftRowByCatalogId = new Map();
let lastRenderedRouteAircraftManagementRouteId = null;
let routeAircraftBulkOperation = null;

const SHOP_MODAL_TAB = Object.freeze({
  AIRCRAFT: 'aircraft',
  AIRPORTS: 'airports'
});

const SHOP_MODAL_OPENED_FROM = Object.freeze({
  HUD: 'hud',
  AIRPORT_MARKER: 'airport-marker'
});

const ROUTES_MODAL_OPENED_FROM = Object.freeze({
  HUD: 'hud',
  SHOP_AIRPORT_PANEL: 'shop-airport-panel',
  SHOP_AIRCRAFT_PANEL: 'shop-aircraft-panel'
});

const ROUTE_CHILD_MODAL_RETURN_CONTEXT = Object.freeze({
  ROUTES: 'routes',
  SHOP: 'shop'
});

const AIRCRAFT_SELECTION_PLACEHOLDER_MESSAGE = 'Select an aircraft from the list to view purchase actions.';
const MAX_GAME_EVENT_HISTORY = 100;

const ShopModalState = {
  isOpen: false,
  activeTab: SHOP_MODAL_TAB.AIRPORTS,
  lastActiveTab: SHOP_MODAL_TAB.AIRPORTS,
  hasOpenedFromHud: false
};

const FinancesModalState = {
  isOpen: false,
  showCash: true,
  showNetWorth: false,
  selectedTimeframe: 'All'
};

const FINANCE_TIMEFRAMES = [
  'All',
  '3Y',
  '1Y',
  '6M',
  '3M',
  '1M',
  '2W',
  '1W'
];

const FINANCE_TIMEFRAME_WINDOWS_MS = {
  '1W': 7 * SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS,
  '2W': 14 * SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS,
  '1M': SIMULATION_DAYS_PER_MONTH * SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS,
  '3M': 3 * SIMULATION_DAYS_PER_MONTH * SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS,
  '6M': 6 * SIMULATION_DAYS_PER_MONTH * SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS,
  '1Y': SIMULATION_DAYS_PER_YEAR * SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS,
  '3Y': 3 * SIMULATION_DAYS_PER_YEAR * SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS
};

const RoutesModalState = {
  isOpen: false,
  isCreateRouteOpen: false,
  isAircraftManagementOpen: false,
  openedFrom: null,
  isStandaloneChildModal: false,
  childModalReturnContext: ROUTE_CHILD_MODAL_RETURN_CONTEXT.ROUTES,
  entryAirportId: null,
  airportFilterId: null
};

// Pointer interaction tracking for deferred authoritative refreshes
let activePointerId = null;
let isPointerInteractionActive = false;
let pendingAuthoritativeState = null;
let pointerEmergencyTimeoutId = null;
let deferredFlushTimeoutId = null;
const POINTER_EMERGENCY_TIMEOUT_MS = 30000;

// Debug flags (set to true to enable specific debug logging)
const DEBUG_ROUTE_AIRCRAFT_FOCUS = false;

// Route list row tracking for DOM reconciliation
const routeListRowByRouteId = new Map();

function startPointerInteraction(pointerId) {
  if (isPointerInteractionActive) {
    return;
  }
  
  isPointerInteractionActive = true;
  activePointerId = pointerId;
  pendingAuthoritativeState = null;
  
  if (pointerEmergencyTimeoutId) {
    clearTimeout(pointerEmergencyTimeoutId);
  }
  
  if (deferredFlushTimeoutId) {
    clearTimeout(deferredFlushTimeoutId);
    deferredFlushTimeoutId = null;
  }
  
  pointerEmergencyTimeoutId = setTimeout(() => {
    forceFlushPendingAuthoritativeRefresh();
  }, POINTER_EMERGENCY_TIMEOUT_MS);
}

function endPointerInteraction(pointerId) {
  if (!isPointerInteractionActive || activePointerId !== pointerId) {
    return;
  }
  
  if (pointerEmergencyTimeoutId) {
    clearTimeout(pointerEmergencyTimeoutId);
    pointerEmergencyTimeoutId = null;
  }
  
  isPointerInteractionActive = false;
  activePointerId = null;
  
  if (deferredFlushTimeoutId) {
    clearTimeout(deferredFlushTimeoutId);
  }
  
  deferredFlushTimeoutId = setTimeout(() => {
    deferredFlushTimeoutId = null;
    if (pendingAuthoritativeState) {
      const stateToRefresh = pendingAuthoritativeState;
      pendingAuthoritativeState = null;
      refreshShopModal(stateToRefresh);
      refreshRoutesModal(stateToRefresh);
      refreshFinancesModal(stateToRefresh);
    }
  }, 0);
}

function flushPendingAuthoritativeRefresh() {
  if (!isPointerInteractionActive) {
    return;
  }
  
  isPointerInteractionActive = false;
  activePointerId = null;
  
  if (pointerEmergencyTimeoutId) {
    clearTimeout(pointerEmergencyTimeoutId);
    pointerEmergencyTimeoutId = null;
  }
  
  if (deferredFlushTimeoutId) {
    clearTimeout(deferredFlushTimeoutId);
    deferredFlushTimeoutId = null;
  }
  
  if (pendingAuthoritativeState) {
    const stateToRefresh = pendingAuthoritativeState;
    pendingAuthoritativeState = null;
    refreshShopModal(stateToRefresh);
    refreshRoutesModal(stateToRefresh);
    refreshFinancesModal(stateToRefresh);
  }
}

function forceFlushPendingAuthoritativeRefresh() {
  isPointerInteractionActive = false;
  activePointerId = null;
  
  if (pointerEmergencyTimeoutId) {
    clearTimeout(pointerEmergencyTimeoutId);
    pointerEmergencyTimeoutId = null;
  }
  
  if (deferredFlushTimeoutId) {
    clearTimeout(deferredFlushTimeoutId);
    deferredFlushTimeoutId = null;
  }
  
  if (pendingAuthoritativeState) {
    const stateToRefresh = pendingAuthoritativeState;
    pendingAuthoritativeState = null;
    refreshShopModal(stateToRefresh);
    refreshRoutesModal(stateToRefresh);
    refreshFinancesModal(stateToRefresh);
  }
}

function handleWindowBlurOrVisibilityChange() {
  if (isPointerInteractionActive) {
    forceFlushPendingAuthoritativeRefresh();
  }
}

function setShopActiveTab(activeTab) {
  if (activeTab !== SHOP_MODAL_TAB.AIRPORTS && activeTab !== SHOP_MODAL_TAB.AIRCRAFT) {
    return;
  }

  ShopModalState.activeTab = activeTab;
  ShopModalState.lastActiveTab = activeTab;
}

function openShopModal({ openedFrom = SHOP_MODAL_OPENED_FROM.HUD } = {}) {
  ShopModalState.isOpen = true;
  refreshShopModal(gameState.getState());
}

function openRoutesModal({ openedFrom = ROUTES_MODAL_OPENED_FROM.HUD, entryAirportId = null, airportFilterId = null } = {}) {
  RoutesModalState.isOpen = true;
  RoutesModalState.isCreateRouteOpen = false;
  RoutesModalState.isAircraftManagementOpen = false;
  RoutesModalState.isStandaloneChildModal = false;
  RoutesModalState.childModalReturnContext = ROUTE_CHILD_MODAL_RETURN_CONTEXT.ROUTES;
  RoutesModalState.entryAirportId = entryAirportId ? String(entryAirportId).trim() || null : null;
  RoutesModalState.airportFilterId = airportFilterId ? String(airportFilterId).trim() || null : null;
  selectedRouteAircraftManagementRouteId = null;
  routeAircraftAssignQuantityByCatalogId = new Map();
  routeAircraftUnassignQuantityByCatalogId = new Map();
  routeAircraftAssignQuantityInputByCatalogId = new Map();
  routeAircraftUnassignQuantityInputByCatalogId = new Map();
  routeAircraftAssignMaxByCatalogId = new Map();
  routeAircraftUnassignMaxByCatalogId = new Map();
  resetRouteAircraftManagementRowCaches();
  routeAircraftBulkOperation = null;
  routeAircraftManagementFeedbackKind = 'error';
  RoutesModalState.openedFrom = openedFrom;
  refreshRoutesModal(gameState.getState());
}

function closeRouteAirportDropdowns() {
  if (!isRouteOriginDropdownOpen && !isRouteDestinationDropdownOpen) {
    return false;
  }

  isRouteOriginDropdownOpen = false;
  isRouteDestinationDropdownOpen = false;
  refreshRoutesModal(gameState.getState());
  return true;
}

function openCreateRouteModal() {
  if (!RoutesModalState.isOpen) {
    return;
  }

  RoutesModalState.isStandaloneChildModal = false;
  RoutesModalState.childModalReturnContext = ROUTE_CHILD_MODAL_RETURN_CONTEXT.ROUTES;
  RoutesModalState.isAircraftManagementOpen = false;
  selectedRouteAircraftManagementRouteId = null;
  RoutesModalState.isCreateRouteOpen = true;

  if (RoutesModalState.entryAirportId) {
    applyCreateRouteAirportPrefill(RoutesModalState.entryAirportId);
  }

  refreshRoutesModal(gameState.getState());
}

function applyCreateRouteAirportPrefill(airportId) {
  const normalizedAirportId = String(airportId || '').trim();
  if (!normalizedAirportId) {
    return;
  }

  selectedRouteOriginAirportId = normalizedAirportId;
  selectedRouteDestinationAirportId = null;
  routeOriginSearchQuery = '';
  routeDestinationSearchQuery = '';
  isRouteOriginDropdownOpen = false;
  isRouteDestinationDropdownOpen = false;
  routeCreateErrorMessage = '';
}

function openCreateRouteModalForAirport(airportId, { openedFrom = ROUTES_MODAL_OPENED_FROM.SHOP_AIRPORT_PANEL } = {}) {
  const normalizedAirportId = String(airportId || '').trim();
  if (!normalizedAirportId) {
    return;
  }

  RoutesModalState.isOpen = true;
  RoutesModalState.openedFrom = openedFrom;
  RoutesModalState.isStandaloneChildModal = true;
  RoutesModalState.childModalReturnContext = ROUTE_CHILD_MODAL_RETURN_CONTEXT.SHOP;
  RoutesModalState.entryAirportId = normalizedAirportId;
  RoutesModalState.isAircraftManagementOpen = false;
  selectedRouteAircraftManagementRouteId = null;
  RoutesModalState.isCreateRouteOpen = true;
  applyCreateRouteAirportPrefill(normalizedAirportId);
  refreshRoutesModal(gameState.getState());
}

function openRouteAircraftManagementModal(routeId) {
  if (!RoutesModalState.isOpen) {
    return;
  }

  const normalizedRouteId = String(routeId || '').trim();
  if (!normalizedRouteId) {
    return;
  }

  selectedRouteAircraftManagementRouteId = normalizedRouteId;
  RoutesModalState.isStandaloneChildModal = false;
  RoutesModalState.childModalReturnContext = ROUTE_CHILD_MODAL_RETURN_CONTEXT.ROUTES;
  RoutesModalState.isCreateRouteOpen = false;
  RoutesModalState.isAircraftManagementOpen = true;
  routeAircraftAssignQuantityByCatalogId = new Map();
  routeAircraftUnassignQuantityByCatalogId = new Map();
  routeAircraftAssignQuantityInputByCatalogId = new Map();
  routeAircraftUnassignQuantityInputByCatalogId = new Map();
  routeAircraftAssignMaxByCatalogId = new Map();
  routeAircraftUnassignMaxByCatalogId = new Map();
  resetRouteAircraftManagementRowCaches();
  routeAircraftBulkOperation = null;
  routeAircraftManagementFeedbackKind = 'error';
  routeAircraftManagementErrorMessage = '';
  refreshRoutesModal(gameState.getState());
}

function openRouteAircraftManagementModalForRoute(routeId, { openedFrom = ROUTES_MODAL_OPENED_FROM.SHOP_AIRPORT_PANEL } = {}) {
  const normalizedRouteId = String(routeId || '').trim();
  if (!normalizedRouteId) {
    return;
  }

  RoutesModalState.isOpen = true;
  RoutesModalState.openedFrom = openedFrom;
  RoutesModalState.isStandaloneChildModal = true;
  RoutesModalState.childModalReturnContext = ROUTE_CHILD_MODAL_RETURN_CONTEXT.SHOP;
  selectedRouteAircraftManagementRouteId = normalizedRouteId;
  RoutesModalState.isCreateRouteOpen = false;
  RoutesModalState.isAircraftManagementOpen = true;
  routeAircraftAssignQuantityByCatalogId = new Map();
  routeAircraftUnassignQuantityByCatalogId = new Map();
  routeAircraftAssignQuantityInputByCatalogId = new Map();
  routeAircraftUnassignQuantityInputByCatalogId = new Map();
  routeAircraftAssignMaxByCatalogId = new Map();
  routeAircraftUnassignMaxByCatalogId = new Map();
  resetRouteAircraftManagementRowCaches();
  routeAircraftBulkOperation = null;
  routeAircraftManagementFeedbackKind = 'error';
  routeAircraftManagementErrorMessage = '';
  refreshRoutesModal(gameState.getState());
}

function openFinancesModal() {
  FinancesModalState.isOpen = true;
  if (financesModalSessionPosition) {
    applyFinancesModalPosition(financesModalSessionPosition.left, financesModalSessionPosition.top);
  }
  requestFinanceHistory();
  refreshFinancesModal(gameState.getState());
}

function closeFinancesModal() {
  FinancesModalState.isOpen = false;
  refreshFinancesModal(gameState.getState());
}

function toggleFinancesModal() {
  if (FinancesModalState.isOpen) {
    closeFinancesModal();
    return;
  }

  openFinancesModal();
}

function closeShopModal() {
  ShopModalState.isOpen = false;
  isAirportSearchResultsOpen = false;
  isAircraftSearchResultsOpen = false;
  refreshShopModal(gameState.getState());
}

function closeRoutesModal() {
  RoutesModalState.isOpen = false;
  RoutesModalState.isCreateRouteOpen = false;
  RoutesModalState.isAircraftManagementOpen = false;
  RoutesModalState.isStandaloneChildModal = false;
  RoutesModalState.childModalReturnContext = ROUTE_CHILD_MODAL_RETURN_CONTEXT.ROUTES;
  RoutesModalState.entryAirportId = null;
  RoutesModalState.airportFilterId = null;
  selectedRouteAircraftManagementRouteId = null;
  pendingRouteAircraftAssignAircraftInstanceId = null;
  pendingRouteAircraftUnassignAircraftInstanceId = null;
  routeAircraftManagementErrorMessage = '';
  routeAircraftAssignQuantityByCatalogId = new Map();
  routeAircraftUnassignQuantityByCatalogId = new Map();
  routeAircraftAssignQuantityInputByCatalogId = new Map();
  routeAircraftUnassignQuantityInputByCatalogId = new Map();
  routeAircraftAssignMaxByCatalogId = new Map();
  routeAircraftUnassignMaxByCatalogId = new Map();
  resetRouteAircraftManagementRowCaches();
  routeAircraftBulkOperation = null;
  RoutesModalState.openedFrom = null;
  refreshRoutesModal(gameState.getState());
}

function closeCreateRouteModal() {
  const shouldCloseRoutesModal = RoutesModalState.childModalReturnContext === ROUTE_CHILD_MODAL_RETURN_CONTEXT.SHOP;
  RoutesModalState.isCreateRouteOpen = false;
  if (shouldCloseRoutesModal) {
    closeRoutesModal();
    return;
  }
  
  refreshRoutesModal(gameState.getState());
}

function closeRouteAircraftManagementModal() {
  const shouldCloseRoutesModal = RoutesModalState.childModalReturnContext === ROUTE_CHILD_MODAL_RETURN_CONTEXT.SHOP;
  RoutesModalState.isAircraftManagementOpen = false;
  pendingRouteAircraftAssignAircraftInstanceId = null;
  pendingRouteAircraftUnassignAircraftInstanceId = null;
  routeAircraftManagementErrorMessage = '';
  routeAircraftManagementFeedbackKind = 'error';
  routeAircraftAssignQuantityByCatalogId = new Map();
  routeAircraftUnassignQuantityByCatalogId = new Map();
  routeAircraftAssignQuantityInputByCatalogId = new Map();
  routeAircraftUnassignQuantityInputByCatalogId = new Map();
  routeAircraftAssignMaxByCatalogId = new Map();
  routeAircraftUnassignMaxByCatalogId = new Map();
  routeAircraftBulkOperation = null;
  resetRouteAircraftManagementRowCaches();
  if (shouldCloseRoutesModal) {
    closeRoutesModal();
    return;
  }

  refreshRoutesModal(gameState.getState());
}

function resetRouteAircraftManagementRowCaches() {
  routeAvailableAircraftGroupByCatalogId = new Map();
  routeAssignedAircraftGroupByCatalogId = new Map();
  routeAvailableAircraftRowByCatalogId = new Map();
  routeAssignedAircraftRowByCatalogId = new Map();
  lastRenderedRouteAircraftManagementRouteId = null;
}

function rememberRouteAircraftModelEditLock(result) {
  if (!result || result.code !== 'MODEL_EDIT_LOCKED') {
    return;
  }

  const routeId = String(result.routeId || '').trim();
  const catalogId = String(result.aircraftCatalogId || '').trim();
  const lockedUntilRealMs = Number(result.lockedUntilRealMs);
  if (!routeId || !catalogId || !Number.isFinite(lockedUntilRealMs) || lockedUntilRealMs <= Date.now()) {
    return;
  }

  const locksByCatalogId = routeAircraftLearnedModelEditLocks.get(routeId) || new Map();
  const existingLockUntil = Number(locksByCatalogId.get(catalogId));
  locksByCatalogId.set(
    catalogId,
    Number.isFinite(existingLockUntil) ? Math.max(existingLockUntil, lockedUntilRealMs) : lockedUntilRealMs
  );
  routeAircraftLearnedModelEditLocks.set(routeId, locksByCatalogId);
}

function getRouteAircraftModelEditLocks(route) {
  const modelEditLockedUntilRealMs = {
    ...(route && route.modelEditLockedUntilRealMs && typeof route.modelEditLockedUntilRealMs === 'object'
      ? route.modelEditLockedUntilRealMs
      : {})
  };
  const routeId = String(route && route.routeId || '').trim();
  const locksByCatalogId = routeAircraftLearnedModelEditLocks.get(routeId);
  if (!routeId || !locksByCatalogId) {
    return modelEditLockedUntilRealMs;
  }

  const now = Date.now();
  for (const [catalogId, lockedUntilRealMs] of locksByCatalogId) {
    if (!Number.isFinite(lockedUntilRealMs) || lockedUntilRealMs <= now) {
      locksByCatalogId.delete(catalogId);
      continue;
    }

    const snapshotLockUntil = Number(modelEditLockedUntilRealMs[catalogId]);
    modelEditLockedUntilRealMs[catalogId] = Number.isFinite(snapshotLockUntil)
      ? Math.max(snapshotLockUntil, lockedUntilRealMs)
      : lockedUntilRealMs;
  }

  if (locksByCatalogId.size === 0) {
    routeAircraftLearnedModelEditLocks.delete(routeId);
  }

  return modelEditLockedUntilRealMs;
}

function scheduleRouteAircraftModelEditLockRefresh(modelEditLockedUntilRealMs) {
  const lockEntries = modelEditLockedUntilRealMs && typeof modelEditLockedUntilRealMs === 'object'
    ? Object.entries(modelEditLockedUntilRealMs)
    : [];
  const now = Date.now();
  let earliestExpiry = null;

  for (const [, expiryRawValue] of lockEntries) {
    const expiryMs = Number(expiryRawValue);
    if (Number.isFinite(expiryMs) && now < expiryMs) {
      if (earliestExpiry === null || expiryMs < earliestExpiry) {
        earliestExpiry = expiryMs;
      }
    }
  }

  if (earliestExpiry === null) {
    if (routeAircraftModelEditLockRefreshTimeoutId !== null) {
      clearTimeout(routeAircraftModelEditLockRefreshTimeoutId);
      routeAircraftModelEditLockRefreshTimeoutId = null;
    }
    lastScheduledModelEditLockRefreshExpiry = null;
    return;
  }

  if (
    lastScheduledModelEditLockRefreshExpiry === earliestExpiry &&
    routeAircraftModelEditLockRefreshTimeoutId !== null
  ) {
    return;
  }

  if (routeAircraftModelEditLockRefreshTimeoutId !== null) {
    clearTimeout(routeAircraftModelEditLockRefreshTimeoutId);
    routeAircraftModelEditLockRefreshTimeoutId = null;
  }

  lastScheduledModelEditLockRefreshExpiry = earliestExpiry;
  const delayMs = Math.max(0, earliestExpiry - now);
  routeAircraftModelEditLockRefreshTimeoutId = setTimeout(() => {
    routeAircraftModelEditLockRefreshTimeoutId = null;
    lastScheduledModelEditLockRefreshExpiry = null;
    refreshRoutesModal(gameState.getState());
  }, delayMs + 10);
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
    maxPlayers: 10,
    players: [],
    palette: [],
    availableColorIds: [],
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
    routes: [],
    aircraftCatalog: [],
    simulationStartedAtRealMs: null,
    simulationStartedAtGameMs: null,
    simulationSpeedMultiplier: null,
    simulationEndedAtGameMs: null,
    simulationClock: {
      simulationStartedAtRealMs: null,
      simulationStartedAtGameMs: null,
      simulationSpeedMultiplier: null,
      simulationEndedAtGameMs: null,
      simulationNowGameMs: null,
      worldCalendarStartYear: null
    }
  };
}

function getEmptySimulationClockSnapshot() {
  return {
    simulationStartedAtRealMs: null,
    simulationStartedAtGameMs: null,
    simulationSpeedMultiplier: null,
    simulationEndedAtGameMs: null,
    simulationNowGameMs: null,
    worldCalendarStartYear: null
  };
}

function normalizeSimulationClockSnapshot(source) {
  const snapshotSource = source && typeof source === 'object' ? source : {};
  const normalizedSpeed =
    Number.isFinite(snapshotSource.simulationSpeedMultiplier) && snapshotSource.simulationSpeedMultiplier > 0
      ? snapshotSource.simulationSpeedMultiplier
      : null;

  return {
    simulationStartedAtRealMs: Number.isFinite(snapshotSource.simulationStartedAtRealMs)
      ? snapshotSource.simulationStartedAtRealMs
      : null,
    simulationStartedAtGameMs: Number.isFinite(snapshotSource.simulationStartedAtGameMs)
      ? snapshotSource.simulationStartedAtGameMs
      : null,
    simulationSpeedMultiplier: normalizedSpeed,
    simulationEndedAtGameMs: Number.isFinite(snapshotSource.simulationEndedAtGameMs)
      ? snapshotSource.simulationEndedAtGameMs
      : null,
    simulationNowGameMs: Number.isFinite(snapshotSource.simulationNowGameMs)
      ? snapshotSource.simulationNowGameMs
      : null,
    worldCalendarStartYear: Number.isFinite(snapshotSource.worldCalendarStartYear)
      ? snapshotSource.worldCalendarStartYear
      : null
  };
}

function deriveSimulationNowGameMs(snapshot, realNowMs = Date.now()) {
  const normalizedSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : getEmptySimulationClockSnapshot();

  if (Number.isFinite(normalizedSnapshot.simulationEndedAtGameMs)) {
    return normalizedSnapshot.simulationEndedAtGameMs;
  }

  if (
    Number.isFinite(normalizedSnapshot.simulationStartedAtRealMs) &&
    Number.isFinite(normalizedSnapshot.simulationStartedAtGameMs) &&
    Number.isFinite(normalizedSnapshot.simulationSpeedMultiplier) &&
    normalizedSnapshot.simulationSpeedMultiplier > 0
  ) {
    const elapsedRealMs = Math.max(0, realNowMs - normalizedSnapshot.simulationStartedAtRealMs);
    return normalizedSnapshot.simulationStartedAtGameMs + (elapsedRealMs * normalizedSnapshot.simulationSpeedMultiplier);
  }

  if (Number.isFinite(normalizedSnapshot.simulationNowGameMs)) {
    return normalizedSnapshot.simulationNowGameMs;
  }

  return null;
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
    worldElapsedSimulationMs: Number.isFinite(eventPayload.worldElapsedSimulationMs)
      ? eventPayload.worldElapsedSimulationMs
      : null,
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
    lobbyColorRequestPending: false,
    preferredLobbyColorId: null,
    currentLobbyId: null,
    currentGameId: null,
    gameEvents: [],
    financeHistorySamples: []
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
  refreshLobbyColorPicker(state);
  refreshRoutesHudButton(state);
  
  if (isPointerInteractionActive) {
    pendingAuthoritativeState = state;
  } else {
    refreshShopModal(state);
    refreshRoutesModal(state);
    refreshFinancesModal(state);
  }
});
renderer.render(gameState.getState());

const hudBottomRightStackEl = document.createElement('div');
hudBottomRightStackEl.className = 'hud-bottom-right-stack hidden';

const simulationClockHudEl = document.createElement('div');
simulationClockHudEl.className = 'simulation-clock-hud hidden';

const simulationClockDateEl = document.createElement('p');
simulationClockDateEl.className = 'simulation-clock-date';
simulationClockDateEl.textContent = '--';

const simulationClockCountryEl = document.createElement('span');
simulationClockCountryEl.className = 'simulation-clock-country';
simulationClockCountryEl.textContent = '';

const simulationClockDateRowEl = document.createElement('div');
simulationClockDateRowEl.className = 'simulation-clock-date-row';
simulationClockDateRowEl.appendChild(simulationClockDateEl);
simulationClockDateRowEl.appendChild(simulationClockCountryEl);

const simulationClockTimeEl = document.createElement('p');
simulationClockTimeEl.className = 'simulation-clock-time';
simulationClockTimeEl.textContent = '--:--';

simulationClockHudEl.appendChild(simulationClockDateRowEl);
simulationClockHudEl.appendChild(simulationClockTimeEl);

const hudIconColumnEl = document.createElement('div');
hudIconColumnEl.className = 'hud-icon-column';

const shopHudButtonEl = document.createElement('button');
shopHudButtonEl.type = 'button';
shopHudButtonEl.className = 'hud-icon-button shop-hud-button';
shopHudButtonEl.setAttribute('aria-label', 'Open Shop');

const routesHudButtonEl = document.createElement('button');
routesHudButtonEl.type = 'button';
routesHudButtonEl.className = 'hud-icon-button route-hud-button';
routesHudButtonEl.setAttribute('aria-label', 'Open routes modal');

const financesHudButtonEl = document.createElement('button');
financesHudButtonEl.type = 'button';
financesHudButtonEl.className = 'hud-icon-button finances-hud-button';
financesHudButtonEl.setAttribute('aria-label', 'Open finances modal');

const svgNamespace = 'http://www.w3.org/2000/svg';
const shopHudButtonIconEl = document.createElementNS(svgNamespace, 'svg');
shopHudButtonIconEl.classList.add('hud-icon-button-icon', 'shop-hud-button-icon');
shopHudButtonIconEl.setAttribute('viewBox', '0 0 24 24');
shopHudButtonIconEl.setAttribute('fill', 'none');
shopHudButtonIconEl.setAttribute('aria-hidden', 'true');
shopHudButtonIconEl.setAttribute('focusable', 'false');

const shopRoofEl = document.createElementNS(svgNamespace, 'path');
shopRoofEl.setAttribute('d', 'M4.5 9 L12 5 L19.5 9');
shopRoofEl.setAttribute('stroke', 'currentColor');
shopRoofEl.setAttribute('stroke-width', '2');
shopRoofEl.setAttribute('stroke-linecap', 'round');
shopRoofEl.setAttribute('stroke-linejoin', 'round');

const shopBodyEl = document.createElementNS(svgNamespace, 'rect');
shopBodyEl.setAttribute('x', '5.5');
shopBodyEl.setAttribute('y', '9.5');
shopBodyEl.setAttribute('width', '13');
shopBodyEl.setAttribute('height', '9');
shopBodyEl.setAttribute('rx', '1.4');
shopBodyEl.setAttribute('stroke', 'currentColor');
shopBodyEl.setAttribute('stroke-width', '2');

const shopDoorEl = document.createElementNS(svgNamespace, 'rect');
shopDoorEl.setAttribute('x', '10.1');
shopDoorEl.setAttribute('y', '13');
shopDoorEl.setAttribute('width', '3.8');
shopDoorEl.setAttribute('height', '5.5');
shopDoorEl.setAttribute('rx', '0.8');
shopDoorEl.setAttribute('stroke', 'currentColor');
shopDoorEl.setAttribute('stroke-width', '1.6');

const shopAwningEl = document.createElementNS(svgNamespace, 'line');
shopAwningEl.setAttribute('x1', '5.4');
shopAwningEl.setAttribute('y1', '12');
shopAwningEl.setAttribute('x2', '18.6');
shopAwningEl.setAttribute('y2', '12');
shopAwningEl.setAttribute('stroke', 'currentColor');
shopAwningEl.setAttribute('stroke-width', '1.6');

shopHudButtonIconEl.appendChild(shopRoofEl);
shopHudButtonIconEl.appendChild(shopBodyEl);
shopHudButtonIconEl.appendChild(shopDoorEl);
shopHudButtonIconEl.appendChild(shopAwningEl);

const routesHudButtonIconEl = document.createElementNS(svgNamespace, 'svg');
routesHudButtonIconEl.classList.add('hud-icon-button-icon');
routesHudButtonIconEl.setAttribute('viewBox', '0 0 24 24');
routesHudButtonIconEl.setAttribute('fill', 'none');
routesHudButtonIconEl.setAttribute('aria-hidden', 'true');
routesHudButtonIconEl.setAttribute('focusable', 'false');

const routePathEl = document.createElementNS(svgNamespace, 'path');
routePathEl.setAttribute('d', 'M6 18 C10 18 9 12 12 12 C15 12 14 6 18 6');
routePathEl.setAttribute('stroke', 'currentColor');
routePathEl.setAttribute('stroke-width', '2');
routePathEl.setAttribute('stroke-linecap', 'round');
routePathEl.setAttribute('stroke-linejoin', 'round');

const topPinOuterEl = document.createElementNS(svgNamespace, 'circle');
topPinOuterEl.setAttribute('cx', '18');
topPinOuterEl.setAttribute('cy', '6');
topPinOuterEl.setAttribute('r', '3');
topPinOuterEl.setAttribute('fill', 'currentColor');

const topPinInnerEl = document.createElementNS(svgNamespace, 'circle');
topPinInnerEl.setAttribute('cx', '18');
topPinInnerEl.setAttribute('cy', '6');
topPinInnerEl.setAttribute('r', '1.2');
topPinInnerEl.setAttribute('fill', 'rgba(15, 23, 42, 0.92)');

const bottomPinOuterEl = document.createElementNS(svgNamespace, 'circle');
bottomPinOuterEl.setAttribute('cx', '6');
bottomPinOuterEl.setAttribute('cy', '18');
bottomPinOuterEl.setAttribute('r', '3');
bottomPinOuterEl.setAttribute('fill', 'currentColor');

const bottomPinInnerEl = document.createElementNS(svgNamespace, 'circle');
bottomPinInnerEl.setAttribute('cx', '6');
bottomPinInnerEl.setAttribute('cy', '18');
bottomPinInnerEl.setAttribute('r', '1.2');
bottomPinInnerEl.setAttribute('fill', 'rgba(15, 23, 42, 0.92)');

routesHudButtonIconEl.appendChild(routePathEl);
routesHudButtonIconEl.appendChild(topPinOuterEl);
routesHudButtonIconEl.appendChild(topPinInnerEl);
routesHudButtonIconEl.appendChild(bottomPinOuterEl);
routesHudButtonIconEl.appendChild(bottomPinInnerEl);

const financesHudButtonIconEl = document.createElementNS(svgNamespace, 'svg');
financesHudButtonIconEl.classList.add('hud-icon-button-icon', 'finances-hud-button-icon');
financesHudButtonIconEl.setAttribute('viewBox', '0 0 24 24');
financesHudButtonIconEl.setAttribute('fill', 'none');
financesHudButtonIconEl.setAttribute('aria-hidden', 'true');
financesHudButtonIconEl.setAttribute('focusable', 'false');

const financesAxesEl = document.createElementNS(svgNamespace, 'path');
financesAxesEl.setAttribute('d', 'M4.5 4.5 V19.5 H19.5');
financesAxesEl.setAttribute('stroke', 'currentColor');
financesAxesEl.setAttribute('stroke-width', '2');
financesAxesEl.setAttribute('stroke-linecap', 'round');
financesAxesEl.setAttribute('stroke-linejoin', 'round');

const financesLineEl = document.createElementNS(svgNamespace, 'path');
financesLineEl.setAttribute('d', 'M6.5 15.5 L10.5 11 L13.5 12.8 L18.5 7');
financesLineEl.setAttribute('stroke', 'currentColor');
financesLineEl.setAttribute('stroke-width', '2');
financesLineEl.setAttribute('stroke-linecap', 'round');
financesLineEl.setAttribute('stroke-linejoin', 'round');

const financesPointEl = document.createElementNS(svgNamespace, 'circle');
financesPointEl.setAttribute('cx', '18.5');
financesPointEl.setAttribute('cy', '7');
financesPointEl.setAttribute('r', '1.6');
financesPointEl.setAttribute('fill', 'currentColor');

financesHudButtonIconEl.appendChild(financesAxesEl);
financesHudButtonIconEl.appendChild(financesLineEl);
financesHudButtonIconEl.appendChild(financesPointEl);

shopHudButtonEl.appendChild(shopHudButtonIconEl);
routesHudButtonEl.appendChild(routesHudButtonIconEl);
financesHudButtonEl.appendChild(financesHudButtonIconEl);
const AIRPORT_PRICE_FILTER_STOPS = [
  { label: 'All', maxPrice: null },
  { label: '2.5B', maxPrice: 2500000000 },
  { label: '1B', maxPrice: 1000000000 },
  { label: '750M', maxPrice: 750000000 },
  { label: '500M', maxPrice: 500000000 },
  { label: '250M', maxPrice: 250000000 },
  { label: '100M', maxPrice: 100000000 },
  { label: '75M', maxPrice: 75000000 },
  { label: '50M', maxPrice: 50000000 },
  { label: '25M', maxPrice: 25000000 },
  { label: '10M', maxPrice: 10000000 },
  { label: '7.5M', maxPrice: 7500000 },
  { label: '5M', maxPrice: 5000000 },
  { label: '2.5M', maxPrice: 2500000 },
  { label: '1M', maxPrice: 1000000 },
  { label: '750K', maxPrice: 750000 },
  { label: '500K', maxPrice: 500000 },
  { label: '250K', maxPrice: 250000 },
  { label: 'Min', maxPrice: 0 }
];

const airportPriceFilterEl = document.createElement('div');
airportPriceFilterEl.className = 'airport-price-filter';

const airportPriceFilterLabelEl = document.createElement('div');
airportPriceFilterLabelEl.className = 'airport-price-filter-label';
airportPriceFilterLabelEl.textContent = 'Budget';

const airportPriceFilterResetButtonEl = document.createElement('button');
airportPriceFilterResetButtonEl.type = 'button';
airportPriceFilterResetButtonEl.className = 'airport-price-filter-action-button airport-price-filter-reset';
airportPriceFilterResetButtonEl.textContent = '↺';
airportPriceFilterResetButtonEl.setAttribute('aria-label', 'Reset');
airportPriceFilterResetButtonEl.title = 'Reset';

const airportPriceFilterBudgetButtonEl = document.createElement('button');
airportPriceFilterBudgetButtonEl.type = 'button';
airportPriceFilterBudgetButtonEl.className = 'airport-price-filter-action-button airport-price-filter-budget';
airportPriceFilterBudgetButtonEl.textContent = 'Cash';

const airportPriceFilterActionsEl = document.createElement('div');
airportPriceFilterActionsEl.className = 'airport-price-filter-actions';
airportPriceFilterActionsEl.appendChild(airportPriceFilterResetButtonEl);
airportPriceFilterActionsEl.appendChild(airportPriceFilterBudgetButtonEl);

const airportPriceFilterTrackEl = document.createElement('div');
airportPriceFilterTrackEl.className = 'airport-price-filter-track';

const airportPriceFilterTicksEl = document.createElement('div');
airportPriceFilterTicksEl.className = 'airport-price-filter-ticks';

const airportPriceFilterTickEls = AIRPORT_PRICE_FILTER_STOPS.map((stop) => {
  const tickEl = document.createElement('span');
  tickEl.className = 'airport-price-filter-tick';
  tickEl.textContent = stop.label.startsWith('$') ? stop.label.slice(1) : stop.label;
  airportPriceFilterTicksEl.appendChild(tickEl);
  return tickEl;
});

const airportPriceFilterSliderStackEl = document.createElement('div');
airportPriceFilterSliderStackEl.className = 'airport-price-filter-slider-stack';

const airportPriceFilterRailEl = document.createElement('div');
airportPriceFilterRailEl.className = 'airport-price-filter-rail';
airportPriceFilterRailEl.setAttribute('aria-hidden', 'true');

const airportPriceFilterRangeEl = document.createElement('div');
airportPriceFilterRangeEl.className = 'airport-price-filter-range';
airportPriceFilterRangeEl.setAttribute('aria-hidden', 'true');

const airportPriceFilterMinHitTargetEl = document.createElement('div');
airportPriceFilterMinHitTargetEl.className = 'airport-price-filter-hit-target airport-price-filter-hit-target--min';
airportPriceFilterMinHitTargetEl.setAttribute('aria-hidden', 'true');

const airportPriceFilterMaxHitTargetEl = document.createElement('div');
airportPriceFilterMaxHitTargetEl.className = 'airport-price-filter-hit-target airport-price-filter-hit-target--max';
airportPriceFilterMaxHitTargetEl.setAttribute('aria-hidden', 'true');

const airportPriceFilterMinSliderEl = document.createElement('input');
airportPriceFilterMinSliderEl.type = 'range';
airportPriceFilterMinSliderEl.className = 'airport-price-filter-slider airport-price-filter-slider--min';
airportPriceFilterMinSliderEl.min = '0';
airportPriceFilterMinSliderEl.max = String(AIRPORT_PRICE_FILTER_STOPS.length - 1);
airportPriceFilterMinSliderEl.step = 'any';
airportPriceFilterMinSliderEl.value = '0';
airportPriceFilterMinSliderEl.setAttribute('orient', 'vertical');
airportPriceFilterMinSliderEl.setAttribute('aria-label', 'Minimum airport price');
airportPriceFilterMinSliderEl.setAttribute('aria-orientation', 'vertical');

const airportPriceFilterMaxSliderEl = document.createElement('input');
airportPriceFilterMaxSliderEl.type = 'range';
airportPriceFilterMaxSliderEl.className = 'airport-price-filter-slider airport-price-filter-slider--max';
airportPriceFilterMaxSliderEl.min = '0';
airportPriceFilterMaxSliderEl.max = String(AIRPORT_PRICE_FILTER_STOPS.length - 1);
airportPriceFilterMaxSliderEl.step = 'any';
airportPriceFilterMaxSliderEl.value = String(AIRPORT_PRICE_FILTER_STOPS.length - 1);
airportPriceFilterMaxSliderEl.setAttribute('orient', 'vertical');
airportPriceFilterMaxSliderEl.setAttribute('aria-label', 'Maximum airport price');
airportPriceFilterMaxSliderEl.setAttribute('aria-orientation', 'vertical');

function getAirportPriceFilterMinimumPrice(index) {
  return getAirportPriceFilterPriceAtStopPosition(index);
}

// The All endpoint stays unbounded; its fractional upper segment uses the highest current airport price as a finite anchor.
function getAirportPriceFilterAllSegmentFiniteMaximumPrice() {
  const state = gameState.getState();
  const airports = Array.isArray(state && state.game && state.game.airports) ? state.game.airports : [];
  return airports.reduce((maximumPrice, airport) => {
    const basePrice = airport && Number(airport.basePrice);
    return Number.isFinite(basePrice) && basePrice > maximumPrice ? basePrice : maximumPrice;
  }, AIRPORT_PRICE_FILTER_STOPS[1].maxPrice);
}

function getAirportPriceFilterPriceAtStopPosition(position, isUpperBound = false) {
  const maxStopIndex = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  const clampedPosition = Math.max(0, Math.min(maxStopIndex, Number(position) || 0));

  if (clampedPosition === 0) {
    return isUpperBound ? null : AIRPORT_PRICE_FILTER_STOPS[1].maxPrice;
  }

  if (clampedPosition < 1) {
    if (!isUpperBound) {
      return AIRPORT_PRICE_FILTER_STOPS[1].maxPrice;
    }

    const segmentMaximumPrice = getAirportPriceFilterAllSegmentFiniteMaximumPrice();
    const twoPointFiveBPrice = AIRPORT_PRICE_FILTER_STOPS[1].maxPrice;
    return segmentMaximumPrice + (twoPointFiveBPrice - segmentMaximumPrice) * clampedPosition;
  }

  const upperStopIndex = Math.floor(clampedPosition);
  const lowerStopIndex = Math.ceil(clampedPosition);
  const upperPrice = AIRPORT_PRICE_FILTER_STOPS[upperStopIndex].maxPrice;
  const lowerPrice = AIRPORT_PRICE_FILTER_STOPS[lowerStopIndex].maxPrice;
  const segmentProgress = clampedPosition - upperStopIndex;
  const interpolatedPrice = upperPrice + (lowerPrice - upperPrice) * segmentProgress;
  // Normalize floating-point noise so exact price boundaries remain inclusive.
  return Number(interpolatedPrice.toPrecision(15));
}

function getAirportPriceFilterStopPositionForPrice(price) {
  const maxStopIndex = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  if (price >= AIRPORT_PRICE_FILTER_STOPS[1].maxPrice) {
    return price === AIRPORT_PRICE_FILTER_STOPS[1].maxPrice ? 1 : 0;
  }

  for (let index = 1; index < maxStopIndex; index += 1) {
    const upperPrice = AIRPORT_PRICE_FILTER_STOPS[index].maxPrice;
    const lowerPrice = AIRPORT_PRICE_FILTER_STOPS[index + 1].maxPrice;
    if (price <= upperPrice && price >= lowerPrice) {
      return index + (upperPrice - price) / (upperPrice - lowerPrice);
    }
  }

  return maxStopIndex;
}

function getAirportPriceFilterLowerStopIndexBelowPrice(price) {
  let lowerStopIndex = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  let lowerStopPrice = AIRPORT_PRICE_FILTER_STOPS[lowerStopIndex].maxPrice;

  for (let index = 1; index < AIRPORT_PRICE_FILTER_STOPS.length - 1; index += 1) {
    const stopPrice = AIRPORT_PRICE_FILTER_STOPS[index].maxPrice;
    if (stopPrice < price && stopPrice > lowerStopPrice) {
      lowerStopIndex = index;
      lowerStopPrice = stopPrice;
    }
  }

  return lowerStopIndex;
}

function getAirportPriceFilterMinimumRawValueForBudget(budget, currentMinRawValue) {
  const maxSliderValue = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  const currentMinRaw = Number(currentMinRawValue);
  const currentMinStopIndex = maxSliderValue - currentMinRaw;
  if (getAirportPriceFilterMinimumPrice(currentMinStopIndex) < budget) {
    return currentMinRaw;
  }

  return maxSliderValue - getAirportPriceFilterLowerStopIndexBelowPrice(budget);
}

let airportPriceFilterExactMaxPrice = null;

function snapAirportPriceFilterPosition(position) {
  const nearestStop = Math.round(position);
  return Math.abs(position - nearestStop) <= 0.22 + Number.EPSILON * 4 ? nearestStop : position;
}

function applyAirportPriceFilterRange(minRawValue, maxRawValue, activeHandle = null) {
  const maxSliderValue = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  let minRaw = Math.max(0, Math.min(maxSliderValue, Number(minRawValue) || 0));
  let maxRaw = Math.max(0, Math.min(maxSliderValue, Number(maxRawValue) || 0));

  if (activeHandle === 'min') {
    minRaw = snapAirportPriceFilterPosition(minRaw);
  } else if (activeHandle === 'max') {
    maxRaw = snapAirportPriceFilterPosition(maxRaw);
  }

  if (activeHandle === 'min' && minRaw > maxRaw) {
    minRaw = maxRaw;
  } else if (activeHandle === 'max' && maxRaw < minRaw) {
    maxRaw = minRaw;
  } else if (!activeHandle && minRaw > maxRaw) {
    maxRaw = minRaw;
  }
  const minStopPosition = maxSliderValue - minRaw;
  const maxStopPosition = maxSliderValue - maxRaw;
  const maxStopIndex = Math.ceil(maxStopPosition);

  airportPriceFilterMinSliderEl.value = String(minRaw);
  airportPriceFilterMaxSliderEl.value = String(maxRaw);

  airportPriceFilterTickEls.forEach((tickEl, tickIndex) => {
    tickEl.classList.toggle(
      'airport-price-filter-tick--active',
      tickIndex >= maxStopIndex && tickIndex <= minStopPosition
    );
  });

  const sliderRange = maxSliderValue || 1;
  airportPriceFilterSliderStackEl.style.setProperty('--airport-price-filter-min-hit-top', `${((sliderRange - minRaw) / sliderRange) * 100}%`);
  airportPriceFilterSliderStackEl.style.setProperty('--airport-price-filter-max-hit-top', `${((sliderRange - maxRaw) / sliderRange) * 100}%`);
  airportPriceFilterSliderStackEl.style.setProperty('--airport-price-filter-range-top', `${((sliderRange - maxRaw) / sliderRange) * 100}%`);
  airportPriceFilterSliderStackEl.style.setProperty('--airport-price-filter-range-bottom', `${(minRaw / sliderRange) * 100}%`);

  if (typeof renderer.setAirportPriceFilter === 'function') {
    renderer.setAirportPriceFilter({
      minPrice: getAirportPriceFilterPriceAtStopPosition(minStopPosition),
      maxPrice: airportPriceFilterExactMaxPrice == null
        ? getAirportPriceFilterPriceAtStopPosition(maxStopPosition, true)
        : airportPriceFilterExactMaxPrice
    });
  }
}

airportPriceFilterMinSliderEl.addEventListener('input', () => {
  airportPriceFilterExactMaxPrice = null;
  applyAirportPriceFilterRange(
    airportPriceFilterMinSliderEl.value,
    airportPriceFilterMaxSliderEl.value,
    'min'
  );
});

airportPriceFilterMaxSliderEl.addEventListener('input', () => {
  airportPriceFilterExactMaxPrice = null;
  applyAirportPriceFilterRange(
    airportPriceFilterMinSliderEl.value,
    airportPriceFilterMaxSliderEl.value,
    'max'
  );
});

airportPriceFilterBudgetButtonEl.addEventListener('click', () => {
  const state = gameState.getState();
  const playerId = state && state.session ? state.session.playerId : null;
  const players = Array.isArray(state && state.game && state.game.players) ? state.game.players : [];
  const localPlayer = playerId == null
    ? null
    : players.find((player) => player && String(player.id) === String(playerId));
  const budget = localPlayer && Number.isFinite(localPlayer.capital) && localPlayer.capital >= 0
    ? localPlayer.capital
    : null;

  if (budget == null) {
    return;
  }

  const maxSliderValue = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  const minRaw = getAirportPriceFilterMinimumRawValueForBudget(
    budget,
    airportPriceFilterMinSliderEl.value
  );
  airportPriceFilterExactMaxPrice = budget;
  const maxStopPosition = getAirportPriceFilterStopPositionForPrice(budget);
  const maxRaw = maxSliderValue - maxStopPosition;
  applyAirportPriceFilterRange(minRaw, maxRaw);
});

airportPriceFilterResetButtonEl.addEventListener('click', () => {
  airportPriceFilterExactMaxPrice = null;
  airportPriceFilterMinSliderEl.value = '0';
  airportPriceFilterMaxSliderEl.value = String(AIRPORT_PRICE_FILTER_STOPS.length - 1);
  applyAirportPriceFilterRange(
    airportPriceFilterMinSliderEl.value,
    airportPriceFilterMaxSliderEl.value
  );
});

let airportPriceFilterHitDragHandle = null;
let airportPriceFilterHitDragPointerId = null;

function getAirportPriceFilterRawValueFromPointer(event) {
  const stackRect = airportPriceFilterSliderStackEl.getBoundingClientRect();
  const sliderRange = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  if (!stackRect.height || !sliderRange) {
    return 0;
  }

  const progress = Math.max(0, Math.min(1, (event.clientY - stackRect.top) / stackRect.height));
  return (1 - progress) * sliderRange;
}

function beginAirportPriceFilterHitDrag(event) {
  if (event.target !== airportPriceFilterMinHitTargetEl && event.target !== airportPriceFilterMaxHitTargetEl) {
    return;
  }

  const stackRect = airportPriceFilterSliderStackEl.getBoundingClientRect();
  const sliderRange = AIRPORT_PRICE_FILTER_STOPS.length - 1;
  const getCenterY = (rawValue) => stackRect.top + ((sliderRange - Number(rawValue)) / sliderRange) * stackRect.height;
  const pointerY = event.clientY;
  const minCenterY = getCenterY(airportPriceFilterMinSliderEl.value);
  const maxCenterY = getCenterY(airportPriceFilterMaxSliderEl.value);
  const minDistance = Math.abs(pointerY - minCenterY);
  const maxDistance = Math.abs(pointerY - maxCenterY);

  airportPriceFilterHitDragHandle = minDistance < maxDistance ? 'min' : 'max';
  airportPriceFilterHitDragPointerId = event.pointerId;
  airportPriceFilterExactMaxPrice = null;
  event.preventDefault();
  if (typeof airportPriceFilterSliderStackEl.setPointerCapture === 'function') {
    airportPriceFilterSliderStackEl.setPointerCapture(event.pointerId);
  }
  applyAirportPriceFilterRange(
    airportPriceFilterHitDragHandle === 'min'
      ? getAirportPriceFilterRawValueFromPointer(event)
      : airportPriceFilterMinSliderEl.value,
    airportPriceFilterHitDragHandle === 'max'
      ? getAirportPriceFilterRawValueFromPointer(event)
      : airportPriceFilterMaxSliderEl.value,
    airportPriceFilterHitDragHandle
  );
}

function updateAirportPriceFilterHitDrag(event) {
  if (airportPriceFilterHitDragPointerId !== event.pointerId || !airportPriceFilterHitDragHandle) {
    return;
  }

  const rawValue = getAirportPriceFilterRawValueFromPointer(event);
  applyAirportPriceFilterRange(
    airportPriceFilterHitDragHandle === 'min' ? rawValue : airportPriceFilterMinSliderEl.value,
    airportPriceFilterHitDragHandle === 'max' ? rawValue : airportPriceFilterMaxSliderEl.value,
    airportPriceFilterHitDragHandle
  );
}

function endAirportPriceFilterHitDrag(event) {
  if (airportPriceFilterHitDragPointerId !== event.pointerId) {
    return;
  }

  airportPriceFilterHitDragHandle = null;
  airportPriceFilterHitDragPointerId = null;
}

airportPriceFilterSliderStackEl.addEventListener('pointerdown', beginAirportPriceFilterHitDrag);
window.addEventListener('pointermove', updateAirportPriceFilterHitDrag);
window.addEventListener('pointerup', endAirportPriceFilterHitDrag);
window.addEventListener('pointercancel', endAirportPriceFilterHitDrag);

applyAirportPriceFilterRange(airportPriceFilterMinSliderEl.value, airportPriceFilterMaxSliderEl.value);

airportPriceFilterTrackEl.appendChild(airportPriceFilterTicksEl);
airportPriceFilterSliderStackEl.appendChild(airportPriceFilterRailEl);
airportPriceFilterSliderStackEl.appendChild(airportPriceFilterRangeEl);
airportPriceFilterSliderStackEl.appendChild(airportPriceFilterMinSliderEl);
airportPriceFilterSliderStackEl.appendChild(airportPriceFilterMaxSliderEl);
airportPriceFilterSliderStackEl.appendChild(airportPriceFilterMinHitTargetEl);
airportPriceFilterSliderStackEl.appendChild(airportPriceFilterMaxHitTargetEl);
airportPriceFilterTrackEl.appendChild(airportPriceFilterSliderStackEl);
airportPriceFilterEl.appendChild(airportPriceFilterLabelEl);
airportPriceFilterEl.appendChild(airportPriceFilterTrackEl);
airportPriceFilterEl.appendChild(airportPriceFilterActionsEl);

hudIconColumnEl.appendChild(shopHudButtonEl);
hudIconColumnEl.appendChild(routesHudButtonEl);
hudIconColumnEl.appendChild(financesHudButtonEl);
hudBottomRightStackEl.appendChild(airportPriceFilterEl);
hudBottomRightStackEl.appendChild(hudIconColumnEl);
if (capitalHudEl) {
  hudBottomRightStackEl.appendChild(capitalHudEl);
}
hudBottomRightStackEl.appendChild(simulationClockHudEl);

const routesModalOverlayEl = document.createElement('div');
routesModalOverlayEl.className = 'shop-modal-overlay routes-modal-overlay hidden';
routesModalOverlayEl.setAttribute('aria-hidden', 'true');

const routesModalDialogEl = document.createElement('div');
routesModalDialogEl.className = 'shop-modal routes-modal';
routesModalDialogEl.setAttribute('role', 'dialog');
routesModalDialogEl.setAttribute('aria-modal', 'true');

const routesModalCloseButtonEl = document.createElement('button');
routesModalCloseButtonEl.type = 'button';
routesModalCloseButtonEl.className = 'shop-modal-close';
routesModalCloseButtonEl.setAttribute('aria-label', 'Close routes modal');
routesModalCloseButtonEl.textContent = 'x';

const routesModalTitleEl = document.createElement('h3');
routesModalTitleEl.className = 'shop-modal-title';
routesModalTitleEl.textContent = 'Routes';

const routesModalContentEl = document.createElement('div');
routesModalContentEl.className = 'shop-modal-content routes-modal-content';

const routesOpenCreateModalButtonEl = document.createElement('button');
routesOpenCreateModalButtonEl.type = 'button';
routesOpenCreateModalButtonEl.className = 'airport-interaction-action-button shop-aircraft-trade-button shop-aircraft-buy-button routes-modal-open-create-button';
routesOpenCreateModalButtonEl.textContent = 'Create Route';

const routesCreationSectionEl = document.createElement('section');
routesCreationSectionEl.className = 'routes-modal-section';

const routesSelectorsRowEl = document.createElement('div');
routesSelectorsRowEl.className = 'routes-create-selectors-row';

const routesOriginSelectorFieldEl = document.createElement('div');
routesOriginSelectorFieldEl.className = 'routes-create-selector-field';

const routesOriginSelectorLabelEl = document.createElement('label');
routesOriginSelectorLabelEl.className = 'routes-create-selector-label';
routesOriginSelectorLabelEl.setAttribute('for', 'routeOriginSearchInput');
routesOriginSelectorLabelEl.textContent = 'From';

const routesOriginSearchInputEl = document.createElement('input');
routesOriginSearchInputEl.id = 'routeOriginSearchInput';
routesOriginSearchInputEl.type = 'text';
routesOriginSearchInputEl.className = 'shop-airport-search-input routes-create-selector-input';
routesOriginSearchInputEl.placeholder = 'Search owned airport...';
routesOriginSearchInputEl.setAttribute('autocomplete', 'off');
routesOriginSearchInputEl.setAttribute('aria-expanded', 'false');

const routesOriginResultsListEl = document.createElement('div');
routesOriginResultsListEl.className = 'shop-airport-results-list routes-create-selector-results hidden';

const routesDestinationSelectorFieldEl = document.createElement('div');
routesDestinationSelectorFieldEl.className = 'routes-create-selector-field';

const routesDestinationSelectorLabelEl = document.createElement('label');
routesDestinationSelectorLabelEl.className = 'routes-create-selector-label';
routesDestinationSelectorLabelEl.setAttribute('for', 'routeDestinationSearchInput');
routesDestinationSelectorLabelEl.textContent = 'To';

const routesDestinationSearchInputEl = document.createElement('input');
routesDestinationSearchInputEl.id = 'routeDestinationSearchInput';
routesDestinationSearchInputEl.type = 'text';
routesDestinationSearchInputEl.className = 'shop-airport-search-input routes-create-selector-input';
routesDestinationSearchInputEl.placeholder = 'Search owned airport...';
routesDestinationSearchInputEl.setAttribute('autocomplete', 'off');
routesDestinationSearchInputEl.setAttribute('aria-expanded', 'false');

const routesDestinationResultsListEl = document.createElement('div');
routesDestinationResultsListEl.className = 'shop-airport-results-list routes-create-selector-results hidden';

const routesDistanceRowEl = document.createElement('p');
routesDistanceRowEl.className = 'airport-interaction-row';
routesDistanceRowEl.innerHTML = '<span class="airport-interaction-label">Distance:</span> <span class="airport-interaction-value" data-route-distance-value>-</span>';
const routesDistanceValueEl = routesDistanceRowEl.querySelector('[data-route-distance-value]');

const routesCreateFeedbackEl = document.createElement('p');
routesCreateFeedbackEl.className = 'airport-interaction-row routes-create-feedback hidden';
routesCreateFeedbackEl.setAttribute('role', 'status');

const routesCreateButtonEl = document.createElement('button');
routesCreateButtonEl.type = 'button';
routesCreateButtonEl.className = 'airport-interaction-action-button shop-aircraft-trade-button shop-aircraft-buy-button routes-modal-create-button';
routesCreateButtonEl.textContent = 'Create Route';
routesCreateButtonEl.disabled = true;

routesOriginSelectorFieldEl.appendChild(routesOriginSelectorLabelEl);
routesOriginSelectorFieldEl.appendChild(routesOriginSearchInputEl);
routesOriginSelectorFieldEl.appendChild(routesOriginResultsListEl);

routesDestinationSelectorFieldEl.appendChild(routesDestinationSelectorLabelEl);
routesDestinationSelectorFieldEl.appendChild(routesDestinationSearchInputEl);
routesDestinationSelectorFieldEl.appendChild(routesDestinationResultsListEl);

routesSelectorsRowEl.appendChild(routesOriginSelectorFieldEl);
routesSelectorsRowEl.appendChild(routesDestinationSelectorFieldEl);

routesCreationSectionEl.appendChild(routesSelectorsRowEl);
routesCreationSectionEl.appendChild(routesDistanceRowEl);
routesCreationSectionEl.appendChild(routesCreateFeedbackEl);
routesCreationSectionEl.appendChild(routesCreateButtonEl);

const routesListSectionEl = document.createElement('section');
routesListSectionEl.className = 'routes-modal-section';

const routesListTitleEl = document.createElement('h4');
routesListTitleEl.className = 'routes-modal-section-title';
routesListTitleEl.textContent = 'Your Routes';

const routesListFeedbackEl = document.createElement('p');
routesListFeedbackEl.className = 'airport-interaction-row routes-list-feedback hidden';

const routesListContainerEl = document.createElement('div');
routesListContainerEl.className = 'routes-list-container';

const routesListEl = document.createElement('div');
routesListEl.className = 'routes-list';

const routesListEmptyEl = document.createElement('p');
routesListEmptyEl.className = 'shop-airport-results-empty';
routesListEmptyEl.textContent = 'No routes yet. Create one to get started.';

routesListSectionEl.appendChild(routesListTitleEl);
routesListSectionEl.appendChild(routesListFeedbackEl);
routesListSectionEl.appendChild(routesListContainerEl);
routesListContainerEl.appendChild(routesListEl);
routesListContainerEl.appendChild(routesListEmptyEl);
routesListEmptyEl.classList.add('hidden');

routesModalContentEl.appendChild(routesListSectionEl);
routesModalContentEl.appendChild(routesOpenCreateModalButtonEl);

routesModalDialogEl.appendChild(routesModalCloseButtonEl);
routesModalDialogEl.appendChild(routesModalTitleEl);
routesModalDialogEl.appendChild(routesModalContentEl);
routesModalOverlayEl.appendChild(routesModalDialogEl);

const createRouteModalOverlayEl = document.createElement('div');
createRouteModalOverlayEl.className = 'shop-modal-overlay routes-create-modal-overlay hidden';
createRouteModalOverlayEl.setAttribute('aria-hidden', 'true');

const createRouteModalDialogEl = document.createElement('div');
createRouteModalDialogEl.className = 'shop-modal routes-modal routes-create-modal';
createRouteModalDialogEl.setAttribute('role', 'dialog');
createRouteModalDialogEl.setAttribute('aria-modal', 'true');

const createRouteModalCloseButtonEl = document.createElement('button');
createRouteModalCloseButtonEl.type = 'button';
createRouteModalCloseButtonEl.className = 'shop-modal-close';
createRouteModalCloseButtonEl.setAttribute('aria-label', 'Close create route modal');
createRouteModalCloseButtonEl.textContent = 'x';

const createRouteModalTitleEl = document.createElement('h3');
createRouteModalTitleEl.className = 'shop-modal-title';
createRouteModalTitleEl.textContent = 'Create Route';

const createRouteModalContentEl = document.createElement('div');
createRouteModalContentEl.className = 'shop-modal-content routes-modal-content';
createRouteModalContentEl.appendChild(routesCreationSectionEl);

createRouteModalDialogEl.appendChild(createRouteModalCloseButtonEl);
createRouteModalDialogEl.appendChild(createRouteModalTitleEl);
createRouteModalDialogEl.appendChild(createRouteModalContentEl);
createRouteModalOverlayEl.appendChild(createRouteModalDialogEl);

const routeAircraftManagementModalOverlayEl = document.createElement('div');
routeAircraftManagementModalOverlayEl.className = 'shop-modal-overlay routes-aircraft-modal-overlay hidden';
routeAircraftManagementModalOverlayEl.setAttribute('aria-hidden', 'true');

const routeAircraftManagementModalDialogEl = document.createElement('div');
routeAircraftManagementModalDialogEl.className = 'shop-modal routes-modal routes-aircraft-modal';
routeAircraftManagementModalDialogEl.setAttribute('role', 'dialog');
routeAircraftManagementModalDialogEl.setAttribute('aria-modal', 'true');

const routeAircraftManagementModalCloseButtonEl = document.createElement('button');
routeAircraftManagementModalCloseButtonEl.type = 'button';
routeAircraftManagementModalCloseButtonEl.className = 'shop-modal-close';
routeAircraftManagementModalCloseButtonEl.setAttribute('aria-label', 'Close route aircraft management modal');
routeAircraftManagementModalCloseButtonEl.textContent = 'x';

const routeAircraftManagementModalTitleEl = document.createElement('h3');
routeAircraftManagementModalTitleEl.className = 'shop-modal-title';
routeAircraftManagementModalTitleEl.textContent = '-';

const routeAircraftManagementModalContentEl = document.createElement('div');
routeAircraftManagementModalContentEl.className = 'shop-modal-content routes-modal-content';

const routeAircraftManagementFeedbackEl = document.createElement('p');
routeAircraftManagementFeedbackEl.className = 'airport-interaction-row routes-aircraft-management-feedback hidden';

const routeAvailableAircraftSectionEl = document.createElement('section');
routeAvailableAircraftSectionEl.className = 'routes-aircraft-section';

const routeAvailableAircraftTitleEl = document.createElement('h4');
routeAvailableAircraftTitleEl.className = 'routes-modal-section-title';
routeAvailableAircraftTitleEl.textContent = 'Available Aircraft';

const routeAvailableAircraftListEl = document.createElement('div');
routeAvailableAircraftListEl.className = 'routes-aircraft-group-list';

routeAvailableAircraftSectionEl.appendChild(routeAvailableAircraftTitleEl);
routeAvailableAircraftSectionEl.appendChild(routeAvailableAircraftListEl);

const routeAircraftSectionsDividerEl = document.createElement('div');
routeAircraftSectionsDividerEl.className = 'routes-aircraft-sections-divider';

const routeAssignedAircraftSectionEl = document.createElement('section');
routeAssignedAircraftSectionEl.className = 'routes-aircraft-section';

const routeAssignedAircraftTitleEl = document.createElement('h4');
routeAssignedAircraftTitleEl.className = 'routes-modal-section-title';
routeAssignedAircraftTitleEl.textContent = 'Assigned Aircraft';

const routeAssignedAircraftListEl = document.createElement('div');
routeAssignedAircraftListEl.className = 'routes-aircraft-group-list';

routeAssignedAircraftSectionEl.appendChild(routeAssignedAircraftTitleEl);
routeAssignedAircraftSectionEl.appendChild(routeAssignedAircraftListEl);

routeAircraftManagementModalContentEl.appendChild(routeAircraftManagementFeedbackEl);
routeAircraftManagementModalContentEl.appendChild(routeAvailableAircraftSectionEl);
routeAircraftManagementModalContentEl.appendChild(routeAircraftSectionsDividerEl);
routeAircraftManagementModalContentEl.appendChild(routeAssignedAircraftSectionEl);

routeAircraftManagementModalDialogEl.appendChild(routeAircraftManagementModalCloseButtonEl);
routeAircraftManagementModalDialogEl.appendChild(routeAircraftManagementModalTitleEl);
routeAircraftManagementModalDialogEl.appendChild(routeAircraftManagementModalContentEl);
routeAircraftManagementModalOverlayEl.appendChild(routeAircraftManagementModalDialogEl);

if (gameScreenEl) {
  gameScreenEl.appendChild(hudBottomRightStackEl);
  gameScreenEl.appendChild(routesModalOverlayEl);
  gameScreenEl.appendChild(createRouteModalOverlayEl);
  gameScreenEl.appendChild(routeAircraftManagementModalOverlayEl);
  
  routesModalDialogEl.addEventListener('pointerdown', (e) => {
    startPointerInteraction(e.pointerId);
  });
  
  createRouteModalDialogEl.addEventListener('pointerdown', (e) => {
    startPointerInteraction(e.pointerId);
  });
  
  routeAircraftManagementModalDialogEl.addEventListener('pointerdown', (e) => {
    startPointerInteraction(e.pointerId);
  });
}

window.addEventListener('pointerup', (e) => {
  endPointerInteraction(e.pointerId);
});

window.addEventListener('pointercancel', (e) => {
  endPointerInteraction(e.pointerId);
});

window.addEventListener('blur', handleWindowBlurOrVisibilityChange);

document.addEventListener('visibilitychange', handleWindowBlurOrVisibilityChange);

isRoutesModalDomReady = Boolean(gameScreenEl);

const shopModalOverlayEl = document.createElement('div');
shopModalOverlayEl.className = 'shop-modal-overlay hidden';
shopModalOverlayEl.setAttribute('aria-hidden', 'true');

const shopModalDialogEl = document.createElement('div');
shopModalDialogEl.className = 'shop-modal shop-store-modal';
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

const shopTabbedPanelEl = document.createElement('div');
shopTabbedPanelEl.className = 'shop-tabbed-panel';

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
shopModalContentEl.className = 'shop-modal-content shop-tab-content';

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

const shopAirportCapacityLimitsRowEl = document.createElement('p');
shopAirportCapacityLimitsRowEl.className = 'airport-interaction-row';
shopAirportCapacityLimitsRowEl.innerHTML = '<span class="airport-interaction-label">Max Aircraft per route:</span> <span class="airport-interaction-value" data-shop-airport-capacity-limits>-</span>';
const shopAirportCapacityLimitsValueEl = shopAirportCapacityLimitsRowEl.querySelector('[data-shop-airport-capacity-limits]');

const shopAirportRoutesRowEl = document.createElement('p');
shopAirportRoutesRowEl.className = 'airport-interaction-row';
shopAirportRoutesRowEl.innerHTML = '<span class="airport-interaction-label">Max Routes:</span> <span class="airport-interaction-value" data-shop-airport-routes>-</span>';
const shopAirportRoutesValueEl = shopAirportRoutesRowEl.querySelector('[data-shop-airport-routes]');

const shopAirportAssignedAircraftRowEl = document.createElement('p');
shopAirportAssignedAircraftRowEl.className = 'airport-interaction-row';
shopAirportAssignedAircraftRowEl.innerHTML = '<span class="airport-interaction-label">Assigned Aircraft:</span> <span class="airport-interaction-value" data-shop-airport-assigned-aircraft>-</span>';
const shopAirportAssignedAircraftValueEl = shopAirportAssignedAircraftRowEl.querySelector('[data-shop-airport-assigned-aircraft]');

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
shopAirportDetailsEl.appendChild(shopAirportRoutesRowEl);
shopAirportDetailsEl.appendChild(shopAirportCapacityLimitsRowEl);
shopAirportDetailsEl.appendChild(shopAirportAssignedAircraftRowEl);
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

function handleAircraftQuantityInputChanged() {
  isAircraftPurchaseQuantityEditing = true;
  aircraftPurchaseQuantityRawInput = shopAircraftQuantityInputEl.value;
  const normalizedQuantity = normalizeAircraftPurchaseQuantity(aircraftPurchaseQuantityRawInput);
  if (normalizedQuantity != null) {
    aircraftPurchaseQuantity = normalizedQuantity;
  }
  refreshShopAircraftInteractionPanel(gameState.getState());
}

function commitAircraftQuantityInputChanged() {
  const normalizedQuantity = normalizeAircraftPurchaseQuantity(shopAircraftQuantityInputEl.value);
  const normalizedMax = Number.isInteger(aircraftMaxPurchasable) && aircraftMaxPurchasable >= 0
    ? aircraftMaxPurchasable
    : 0;
  if (normalizedQuantity == null) {
    aircraftPurchaseQuantity = normalizedMax >= 1 ? 1 : 0;
  } else {
    aircraftPurchaseQuantity = Math.min(normalizedQuantity, normalizedMax);
  }

  if (aircraftPurchaseQuantity === 0 && normalizedMax >= 1) {
    aircraftPurchaseQuantity = 1;
  }

  isAircraftPurchaseQuantityEditing = false;
  aircraftPurchaseQuantityRawInput = '';
  refreshShopAircraftInteractionPanel(gameState.getState());
}

shopAircraftQuantityInputEl.addEventListener('focus', () => {
  isAircraftPurchaseQuantityEditing = true;
  aircraftPurchaseQuantityRawInput = shopAircraftQuantityInputEl.value;
});
shopAircraftQuantityInputEl.addEventListener('input', handleAircraftQuantityInputChanged);
shopAircraftQuantityInputEl.addEventListener('change', commitAircraftQuantityInputChanged);
shopAircraftQuantityInputEl.addEventListener('blur', commitAircraftQuantityInputChanged);

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
  refreshShopAircraftInteractionPanel(gameState.getState());
  socket.emit('aircraft:purchase:request', {
    aircraftCatalogId: selectedAircraft.aircraftCatalogId,
    quantity: normalizedQuantity
  });
});

bindQuantityInputShortcuts({
  inputEl: shopAircraftQuantityInputEl,
  maxButtonEl: shopAircraftMaxLabelEl,
  actionButtonEl: shopAircraftBuyButtonEl,
  getMaxValue: () => Number.isInteger(aircraftMaxPurchasable) && aircraftMaxPurchasable > 0 ? aircraftMaxPurchasable : 0,
  isMaxAllowed: () => Number.isInteger(aircraftMaxPurchasable) && aircraftMaxPurchasable >= 1 && !isAircraftPurchasePending && !isAircraftQuotePending,
  onMaxClick: (maxValue) => {
    if (isAircraftPurchasePending) {
      return;
    }
    aircraftPurchaseQuantity = normalizeAircraftPurchaseQuantity(maxValue);
    isAircraftPurchaseQuantityEditing = false;
    aircraftPurchaseQuantityRawInput = '';
    refreshShopAircraftInteractionPanel(gameState.getState());
  }
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
  isAircraftSellQuantityEditing = true;
  aircraftSellQuantityRawInput = shopAircraftSellQuantityInputEl.value;
  const parsedValue = parseIntegerInputValue(aircraftSellQuantityRawInput);
  if (parsedValue != null) {
    aircraftSellQuantity = normalizeAircraftSellQuantity(parsedValue, aircraftMaxSellable);
  }
  refreshShopAircraftInteractionPanel(gameState.getState());
}

function commitAircraftSellQuantityInputChanged() {
  const parsedValue = parseIntegerInputValue(shopAircraftSellQuantityInputEl.value);
  aircraftSellQuantity = normalizeAircraftSellQuantity(parsedValue, aircraftMaxSellable);
  isAircraftSellQuantityEditing = false;
  aircraftSellQuantityRawInput = '';
  refreshShopAircraftInteractionPanel(gameState.getState());
}

shopAircraftSellQuantityInputEl.addEventListener('focus', () => {
  isAircraftSellQuantityEditing = true;
  aircraftSellQuantityRawInput = shopAircraftSellQuantityInputEl.value;
});
shopAircraftSellQuantityInputEl.addEventListener('input', handleAircraftSellQuantityInputChanged);
shopAircraftSellQuantityInputEl.addEventListener('change', commitAircraftSellQuantityInputChanged);
shopAircraftSellQuantityInputEl.addEventListener('blur', commitAircraftSellQuantityInputChanged);

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

bindQuantityInputShortcuts({
  inputEl: shopAircraftSellQuantityInputEl,
  maxButtonEl: shopAircraftOwnedLabelEl,
  actionButtonEl: shopAircraftSellButtonEl,
  getMaxValue: () => Number.isInteger(aircraftMaxSellable) && aircraftMaxSellable > 0 ? aircraftMaxSellable : 0,
  onMaxClick: (maxValue) => {
    if (isAircraftSellPending) {
      return;
    }
    aircraftSellQuantity = normalizeAircraftSellQuantity(maxValue, aircraftMaxSellable);
    isAircraftSellQuantityEditing = false;
    aircraftSellQuantityRawInput = '';
    refreshShopAircraftInteractionPanel(gameState.getState());
  }
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
shopTabbedPanelEl.appendChild(shopModalTabsEl);
shopTabbedPanelEl.appendChild(shopModalContentEl);
shopModalDialogEl.appendChild(shopTabbedPanelEl);
shopModalOverlayEl.appendChild(shopModalDialogEl);

if (gameScreenEl) {
  gameScreenEl.appendChild(shopModalOverlayEl);
  
  shopModalDialogEl.addEventListener('pointerdown', (e) => {
    startPointerInteraction(e.pointerId);
  });
}

const financesModalEl = document.createElement('div');
financesModalEl.className = 'finances-modal hidden';
financesModalEl.setAttribute('role', 'dialog');
financesModalEl.setAttribute('aria-modal', 'false');
financesModalEl.setAttribute('aria-label', 'Finances');

const financesModalCloseButtonEl = document.createElement('button');
financesModalCloseButtonEl.type = 'button';
financesModalCloseButtonEl.className = 'shop-modal-close finances-modal-close';
financesModalCloseButtonEl.setAttribute('aria-label', 'Close finances modal');
financesModalCloseButtonEl.textContent = 'x';

const financesModalTitleEl = document.createElement('h3');
financesModalTitleEl.className = 'shop-modal-title finances-modal-title';
financesModalTitleEl.textContent = 'Finances';

const financesModalContentEl = document.createElement('div');
financesModalContentEl.className = 'finances-modal-content';

const financesSummaryEl = document.createElement('div');
financesSummaryEl.className = 'finances-modal-summary';

const financesSummaryRowEl = document.createElement('div');
financesSummaryRowEl.className = 'finances-modal-row finances-modal-row--summary';

const financesCashGroupEl = document.createElement('span');
financesCashGroupEl.className = 'finances-modal-summary-group';

const financesCashLabelEl = document.createElement('span');
financesCashLabelEl.className = 'finances-modal-label';
financesCashLabelEl.textContent = 'Cash:';

const financesCashValueEl = document.createElement('span');
financesCashValueEl.className = 'finances-modal-value';
financesCashValueEl.textContent = '--';

financesCashGroupEl.appendChild(financesCashLabelEl);
financesCashGroupEl.appendChild(financesCashValueEl);

const financesNetWorthGroupEl = document.createElement('span');
financesNetWorthGroupEl.className = 'finances-modal-summary-group finances-modal-summary-group--net-worth';

const financesNetWorthLabelEl = document.createElement('span');
financesNetWorthLabelEl.className = 'finances-modal-label';
financesNetWorthLabelEl.textContent = 'Net Worth:';

const financesNetWorthValueEl = document.createElement('span');
financesNetWorthValueEl.className = 'finances-modal-value';
financesNetWorthValueEl.textContent = '--';

financesNetWorthGroupEl.appendChild(financesNetWorthLabelEl);
financesNetWorthGroupEl.appendChild(financesNetWorthValueEl);

financesSummaryRowEl.appendChild(financesCashGroupEl);
financesSummaryRowEl.appendChild(financesNetWorthGroupEl);

financesSummaryEl.appendChild(financesSummaryRowEl);

const financesChartTogglesEl = document.createElement('div');
financesChartTogglesEl.className = 'finances-chart-toggles';

const financesCashToggleEl = document.createElement('button');
financesCashToggleEl.type = 'button';
financesCashToggleEl.className = 'finances-chart-toggle finances-chart-toggle--cash';
financesCashToggleEl.setAttribute('aria-pressed', 'true');

const financesCashToggleSwatchEl = document.createElement('span');
financesCashToggleSwatchEl.className = 'finances-chart-toggle-swatch finances-chart-toggle-swatch--cash';
financesCashToggleSwatchEl.setAttribute('aria-hidden', 'true');

const financesCashToggleLabelEl = document.createElement('span');
financesCashToggleLabelEl.textContent = 'Cash';

financesCashToggleEl.appendChild(financesCashToggleSwatchEl);
financesCashToggleEl.appendChild(financesCashToggleLabelEl);

const financesNetWorthToggleEl = document.createElement('button');
financesNetWorthToggleEl.type = 'button';
financesNetWorthToggleEl.className = 'finances-chart-toggle finances-chart-toggle--net-worth finances-chart-toggle--off';
financesNetWorthToggleEl.setAttribute('aria-pressed', 'false');

const financesNetWorthToggleSwatchEl = document.createElement('span');
financesNetWorthToggleSwatchEl.className = 'finances-chart-toggle-swatch finances-chart-toggle-swatch--net-worth';
financesNetWorthToggleSwatchEl.setAttribute('aria-hidden', 'true');

const financesNetWorthToggleLabelEl = document.createElement('span');
financesNetWorthToggleLabelEl.textContent = 'Net Worth';

financesNetWorthToggleEl.appendChild(financesNetWorthToggleSwatchEl);
financesNetWorthToggleEl.appendChild(financesNetWorthToggleLabelEl);

financesChartTogglesEl.appendChild(financesCashToggleEl);
financesChartTogglesEl.appendChild(financesNetWorthToggleEl);

const financesChartSvgEl = document.createElementNS(svgNamespace, 'svg');
financesChartSvgEl.classList.add('finances-chart-svg');
financesChartSvgEl.setAttribute('viewBox', '0 0 308 140');
financesChartSvgEl.setAttribute('width', '100%');
financesChartSvgEl.setAttribute('aria-hidden', 'true');

const financesTimeframeTogglesEl = document.createElement('div');
financesTimeframeTogglesEl.className = 'finances-timeframe-toggles';

const financesTimeframeToggleEls = [];
for (const timeframe of FINANCE_TIMEFRAMES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'finances-timeframe-toggle';
  button.textContent = timeframe;
  button.dataset.timeframe = timeframe;
  button.setAttribute('aria-pressed', timeframe === 'All' ? 'true' : 'false');
  if (timeframe !== 'All') {
    button.classList.add('finances-timeframe-toggle--off');
  }
  button.addEventListener('click', () => {
    FinancesModalState.selectedTimeframe = timeframe;
    refreshFinancesModal(gameState.getState());
  });
  financesTimeframeTogglesEl.appendChild(button);
  financesTimeframeToggleEls.push(button);
}

financesModalContentEl.appendChild(financesSummaryEl);
financesModalContentEl.appendChild(financesChartTogglesEl);
financesModalContentEl.appendChild(financesChartSvgEl);
financesModalContentEl.appendChild(financesTimeframeTogglesEl);

financesModalEl.appendChild(financesModalCloseButtonEl);
financesModalEl.appendChild(financesModalTitleEl);
financesModalEl.appendChild(financesModalContentEl);

const FINANCES_MODAL_MIN_VISIBLE_PX = 48;
let isFinancesModalDragging = false;
let financesModalDragPointerId = null;
let financesModalDragStartClientX = 0;
let financesModalDragStartClientY = 0;
let financesModalDragStartLeft = 0;
let financesModalDragStartTop = 0;
let financesModalSessionPosition = null;

function applyFinancesModalPosition(leftPx, topPx) {
  financesModalEl.style.left = `${leftPx}px`;
  financesModalEl.style.top = `${topPx}px`;
  financesModalEl.style.bottom = 'auto';
  financesModalSessionPosition = { left: leftPx, top: topPx };
}

function clampFinancesModalPosition(leftPx, topPx) {
  const parent = financesModalEl.offsetParent;
  const parentWidth = parent && Number.isFinite(parent.clientWidth) ? parent.clientWidth : window.innerWidth;
  const parentHeight = parent && Number.isFinite(parent.clientHeight) ? parent.clientHeight : window.innerHeight;
  const modalWidth = Number.isFinite(financesModalEl.offsetWidth) ? financesModalEl.offsetWidth : 0;
  const titleHeight = Number.isFinite(financesModalTitleEl.offsetHeight) && financesModalTitleEl.offsetHeight > 0
    ? financesModalTitleEl.offsetHeight
    : FINANCES_MODAL_MIN_VISIBLE_PX;

  const minLeft = FINANCES_MODAL_MIN_VISIBLE_PX - modalWidth;
  const maxLeft = Math.max(0, parentWidth - FINANCES_MODAL_MIN_VISIBLE_PX);
  const clampedLeft = Math.min(Math.max(leftPx, minLeft), maxLeft);

  const clampedTop = Math.min(Math.max(topPx, 0), Math.max(0, parentHeight - titleHeight));

  return { left: clampedLeft, top: clampedTop };
}

function handleFinancesModalDragStart(event) {
  if (!event || event.button !== 0) {
    return;
  }

  if (financesModalCloseButtonEl.contains(event.target)) {
    return;
  }

  startPointerInteraction(event.pointerId);
  event.preventDefault();

  isFinancesModalDragging = true;
  financesModalDragPointerId = event.pointerId;
  financesModalDragStartClientX = event.clientX;
  financesModalDragStartClientY = event.clientY;

  if (financesModalSessionPosition) {
    financesModalDragStartLeft = financesModalSessionPosition.left;
    financesModalDragStartTop = financesModalSessionPosition.top;
  } else {
    financesModalDragStartLeft = financesModalEl.offsetLeft;
    financesModalDragStartTop = financesModalEl.offsetTop;
  }

  financesModalEl.classList.add('finances-modal--dragging');

  if (typeof financesModalTitleEl.setPointerCapture === 'function') {
    try {
      financesModalTitleEl.setPointerCapture(event.pointerId);
    } catch (captureError) {
      // Pointer capture can fail for synthetic pointers; dragging still works via window listeners.
    }
  }
}

function handleFinancesModalDragMove(event) {
  if (!isFinancesModalDragging || event.pointerId !== financesModalDragPointerId) {
    return;
  }

  event.preventDefault();

  const nextLeft = financesModalDragStartLeft + (event.clientX - financesModalDragStartClientX);
  const nextTop = financesModalDragStartTop + (event.clientY - financesModalDragStartClientY);
  const clamped = clampFinancesModalPosition(nextLeft, nextTop);
  applyFinancesModalPosition(clamped.left, clamped.top);
}

function handleFinancesModalDragEnd(event) {
  if (!isFinancesModalDragging || event.pointerId !== financesModalDragPointerId) {
    return;
  }

  isFinancesModalDragging = false;
  financesModalDragPointerId = null;
  financesModalEl.classList.remove('finances-modal--dragging');

  if (
    typeof financesModalTitleEl.releasePointerCapture === 'function' &&
    typeof financesModalTitleEl.hasPointerCapture === 'function' &&
    financesModalTitleEl.hasPointerCapture(event.pointerId)
  ) {
    try {
      financesModalTitleEl.releasePointerCapture(event.pointerId);
    } catch (releaseError) {
      // Safe to ignore: capture release is best-effort.
    }
  }
}

if (gameScreenEl) {
  gameScreenEl.appendChild(financesModalEl);

  financesModalEl.addEventListener('pointerdown', (e) => {
    startPointerInteraction(e.pointerId);
  });

  financesModalTitleEl.addEventListener('pointerdown', handleFinancesModalDragStart);
  financesModalTitleEl.addEventListener('pointermove', handleFinancesModalDragMove);
  financesModalTitleEl.addEventListener('pointerup', handleFinancesModalDragEnd);
  financesModalTitleEl.addEventListener('pointercancel', handleFinancesModalDragEnd);
  window.addEventListener('pointermove', handleFinancesModalDragMove);
  window.addEventListener('pointerup', handleFinancesModalDragEnd);
  window.addEventListener('pointercancel', handleFinancesModalDragEnd);
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

function resolveRouteMaxAircraftCapacity(state, route) {
  if (!route || route.originAirportId == null || route.destinationAirportId == null) {
    return null;
  }

  const originAirport = getAuthoritativeAirportById(state, route.originAirportId);
  const destinationAirport = getAuthoritativeAirportById(state, route.destinationAirportId);
  const originCapacity = originAirport && originAirport.capacity;
  const destinationCapacity = destinationAirport && destinationAirport.capacity;
  const originMax = originCapacity && originCapacity.maxAircraftPerRoute;
  const destinationMax = destinationCapacity && destinationCapacity.maxAircraftPerRoute;

  if (
    !Number.isFinite(originMax) ||
    originMax < 0 ||
    !Number.isFinite(destinationMax) ||
    destinationMax < 0
  ) {
    return null;
  }

  return Math.min(originMax, destinationMax);
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
}

function setSelectedAircraftCatalogId(nextAircraftCatalogId) {
  const normalizedNextAircraftCatalogId = nextAircraftCatalogId ? String(nextAircraftCatalogId) : null;
  const didSelectionChange = String(selectedAircraftCatalogId || '') !== String(normalizedNextAircraftCatalogId || '');

  selectedAircraftCatalogId = normalizedNextAircraftCatalogId;

  if (didSelectionChange) {
    // Let the next authoritative purchase quote initialize the default quantity.
    aircraftPurchaseQuantity = null;
    isAircraftPurchaseQuantityEditing = false;
    aircraftPurchaseQuantityRawInput = '';
    isAircraftSellQuantityEditing = false;
    aircraftSellQuantityRawInput = '';
  }
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

function parseIntegerInputValue(rawValue) {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    return null;
  }

  return numericValue;
}

function applyAuthoritativeAircraftMaxPurchasable(maxPurchasable, { initialize = false } = {}) {
  const normalizedMax = Number.isInteger(maxPurchasable) && maxPurchasable >= 0 ? maxPurchasable : 0;
  aircraftMaxPurchasable = normalizedMax;

  if (initialize) {
    aircraftPurchaseQuantity = null;
    isAircraftPurchaseQuantityEditing = false;
    aircraftPurchaseQuantityRawInput = '';
    return;
  }

  const normalizedQuantity = normalizeAircraftPurchaseQuantity(aircraftPurchaseQuantity);
  if (normalizedQuantity == null) {
    aircraftPurchaseQuantity = normalizedMax >= 1 ? 1 : 0;
  } else {
    aircraftPurchaseQuantity = normalizedQuantity > normalizedMax ? normalizedMax : normalizedQuantity;
  }

  if (aircraftPurchaseQuantity === 0 && normalizedMax >= 1) {
    aircraftPurchaseQuantity = 1;
  }
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
    isAircraftSellQuantityEditing = false;
    aircraftSellQuantityRawInput = '';
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

function refreshFinancesModal(state = gameState.getState()) {
  const shouldShowFinancesModal = FinancesModalState.isOpen;
  financesModalEl.classList.toggle('hidden', !shouldShowFinancesModal);
  financesModalEl.setAttribute('aria-hidden', shouldShowFinancesModal ? 'false' : 'true');

  if (!shouldShowFinancesModal) {
    return;
  }

  const localPlayerId = state && state.session ? state.session.playerId : null;
  const localPlayer = getAuthoritativePlayerById(state, localPlayerId);

  const cash = localPlayer && Number.isFinite(localPlayer.capital) ? localPlayer.capital : null;
  const netWorth = localPlayer && Number.isFinite(localPlayer.netWorth) ? localPlayer.netWorth : cash;

  financesCashValueEl.textContent = Number.isFinite(cash) ? formatCurrencyValue(cash) : '--';
  financesNetWorthValueEl.textContent = Number.isFinite(netWorth) ? formatCompactNetWorth(netWorth) : '--';

  financesCashToggleEl.classList.toggle('finances-chart-toggle--off', !FinancesModalState.showCash);
  financesNetWorthToggleEl.classList.toggle('finances-chart-toggle--off', !FinancesModalState.showNetWorth);
  financesCashToggleEl.setAttribute('aria-pressed', FinancesModalState.showCash ? 'true' : 'false');
  financesNetWorthToggleEl.setAttribute('aria-pressed', FinancesModalState.showNetWorth ? 'true' : 'false');

  for (const button of financesTimeframeToggleEls) {
    const isSelected = button.dataset.timeframe === FinancesModalState.selectedTimeframe;
    button.classList.toggle('finances-timeframe-toggle--off', !isSelected);
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  }

  renderFinanceChart(buildFinanceChartData(state), state);
}

function buildFinanceLiveSample(state = gameState.getState()) {
  const localPlayerId = state && state.session ? state.session.playerId : null;
  const localPlayer = getAuthoritativePlayerById(state, localPlayerId);

  const cash = localPlayer && Number.isFinite(localPlayer.capital) ? localPlayer.capital : null;
  const netWorth = localPlayer && Number.isFinite(localPlayer.netWorth) ? localPlayer.netWorth : cash;

  const simulationNowGameMs = deriveSimulationNowGameMs(simulationClockSnapshot);
  const simulationStartedAtGameMs =
    simulationClockSnapshot && Number.isFinite(simulationClockSnapshot.simulationStartedAtGameMs)
      ? simulationClockSnapshot.simulationStartedAtGameMs
      : null;

  if (!Number.isFinite(simulationNowGameMs) || !Number.isFinite(simulationStartedAtGameMs)) {
    return null;
  }

  return {
    worldElapsedSimulationMs: Math.max(0, simulationNowGameMs - simulationStartedAtGameMs),
    cash: Number.isFinite(cash) ? cash : 0,
    netWorth: Number.isFinite(netWorth) ? netWorth : 0,
    live: true
  };
}

function buildFinanceChartData(state = gameState.getState()) {
  const historySamples =
    state && state.session && Array.isArray(state.session.financeHistorySamples)
      ? state.session.financeHistorySamples
      : [];

  const chartData = historySamples.map((sample) => ({
    worldElapsedSimulationMs: Number.isFinite(sample && sample.worldElapsedSimulationMs)
      ? sample.worldElapsedSimulationMs
      : null,
    cash: Number.isFinite(sample && sample.cash) ? sample.cash : 0,
    netWorth: Number.isFinite(sample && sample.netWorth) ? sample.netWorth : 0
  }));

  const liveSample = buildFinanceLiveSample(state);
  if (liveSample) {
    chartData.push(liveSample);
  }

  if (FinancesModalState.selectedTimeframe === 'All' || chartData.length === 0) {
    return chartData;
  }

  const latestElapsedSimulationMs = chartData[chartData.length - 1].worldElapsedSimulationMs;
  const windowMs = FINANCE_TIMEFRAME_WINDOWS_MS[FinancesModalState.selectedTimeframe];
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return chartData;
  }

  const cutoff = latestElapsedSimulationMs - windowMs;
  return chartData.filter((point) =>
    Number.isFinite(point.worldElapsedSimulationMs) && point.worldElapsedSimulationMs >= cutoff
  );
}

const FINANCE_CHART_WIDTH = 308;
const FINANCE_CHART_HEIGHT = 140;
const FINANCE_CHART_PAD_LEFT = 44;
const FINANCE_CHART_PAD_RIGHT = 8;
const FINANCE_CHART_PAD_TOP = 8;
const FINANCE_CHART_PAD_BOTTOM = 20;
const FINANCE_CHART_MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function formatCompactNetWorth(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '$0.00';
  }

  const absValue = Math.abs(numericValue);

  if (absValue >= 1e9) {
    return `$${(numericValue / 1e9).toFixed(2)}B`;
  }

  if (absValue >= 1e6) {
    return `$${(numericValue / 1e6).toFixed(2)}M`;
  }

  if (absValue >= 1e3) {
    return `$${(numericValue / 1e3).toFixed(2)}k`;
  }

  return formatCurrencyValue(numericValue);
}

function formatCompactCurrencyValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '$0';
  }

  const sign = numericValue < 0 ? '-' : '';
  const absValue = Math.abs(numericValue);
  const units = [
    { threshold: 1e9, suffix: 'B' },
    { threshold: 1e6, suffix: 'M' },
    { threshold: 1e3, suffix: 'k' }
  ];

  for (const unit of units) {
    if (absValue >= unit.threshold) {
      const scaled = absValue / unit.threshold;
      const rounded = Math.round(scaled * 10) / 10;
      const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${sign}$${text}${unit.suffix}`;
    }
  }

  return `${sign}$${Math.round(absValue)}`;
}

function formatFinanceAxisLabel(worldElapsedSimulationMs, spanSimulationMs) {
  if (!Number.isFinite(worldElapsedSimulationMs)) {
    return '--';
  }

  const elapsed = Math.max(0, worldElapsedSimulationMs);
  const padTwo = (value) => String(value).padStart(2, '0');
  const dayMs = SIMULATION_HOURS_PER_DAY * SIMULATION_HOUR_MS;

  if (!Number.isFinite(spanSimulationMs) || spanSimulationMs < dayMs) {
    const totalMinutes = Math.floor(elapsed / 60000);
    const totalHours = Math.floor(elapsed / SIMULATION_HOUR_MS);
    return `${padTwo(totalHours % SIMULATION_HOURS_PER_DAY)}:${padTwo(totalMinutes % 60)}`;
  }

  const elapsedDays = Math.floor(elapsed / dayMs);
  const dayOffsetInYear = elapsedDays % SIMULATION_DAYS_PER_YEAR;
  const monthIndex = Math.floor(dayOffsetInYear / SIMULATION_DAYS_PER_MONTH);
  const dayOfMonth = (dayOffsetInYear % SIMULATION_DAYS_PER_MONTH) + 1;

  return `${FINANCE_CHART_MONTH_ABBREVIATIONS[monthIndex]} ${padTwo(dayOfMonth)}`;
}

function buildFinanceChartGeometry(chartData, { showCash = true, showNetWorth = true } = {}) {
  const plotWidth = FINANCE_CHART_WIDTH - FINANCE_CHART_PAD_LEFT - FINANCE_CHART_PAD_RIGHT;
  const plotHeight = FINANCE_CHART_HEIGHT - FINANCE_CHART_PAD_TOP - FINANCE_CHART_PAD_BOTTOM;

  const points = Array.isArray(chartData)
    ? chartData.filter((point) => point && Number.isFinite(point.worldElapsedSimulationMs))
    : [];

  if (points.length === 0) {
    return { points: [], xTicks: [], yTicks: [], cashPath: '', netWorthPath: '', isEmpty: true };
  }

  const elapsedValues = points.map((point) => point.worldElapsedSimulationMs);
  let xMin = Math.min(...elapsedValues);
  let xMax = Math.max(...elapsedValues);
  if (xMax === xMin) {
    xMin -= 1;
    xMax += 1;
  }
  const xSpan = xMax - xMin;

  const visibleValues = [];
  for (const point of points) {
    if (showCash && Number.isFinite(point.cash)) {
      visibleValues.push(point.cash);
    }
    if (showNetWorth && Number.isFinite(point.netWorth)) {
      visibleValues.push(point.netWorth);
    }
  }
  if (visibleValues.length === 0) {
    for (const point of points) {
      if (Number.isFinite(point.cash)) {
        visibleValues.push(point.cash);
      }
      if (Number.isFinite(point.netWorth)) {
        visibleValues.push(point.netWorth);
      }
    }
  }

  let yMin = visibleValues.length > 0 ? Math.min(...visibleValues) : 0;
  let yMax = visibleValues.length > 0 ? Math.max(...visibleValues) : 1;
  if (yMax === yMin) {
    const padding = Math.abs(yMax) * 0.1 || 1;
    yMin -= padding;
    yMax += padding;
  }

  const toX = (elapsed) => FINANCE_CHART_PAD_LEFT + ((elapsed - xMin) / xSpan) * plotWidth;
  const toY = (value) => FINANCE_CHART_PAD_TOP + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;

  const xTicks = [0, 1, 2, 3].map((index) => {
    const elapsed = xMin + (xSpan * index) / 3;
    return {
      elapsed,
      x: toX(elapsed),
      label: formatFinanceAxisLabel(elapsed, xMax - xMin)
    };
  });

  const yTicks = [0, 1, 2, 3].map((index) => {
    const value = yMin + ((yMax - yMin) * index) / 3;
    return {
      value,
      y: toY(value),
      label: formatCompactCurrencyValue(value)
    };
  });

  const buildPath = (key) => points
    .filter((point) => Number.isFinite(point[key]))
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.worldElapsedSimulationMs).toFixed(2)} ${toY(point[key]).toFixed(2)}`)
    .join(' ');

  return {
    points,
    xTicks,
    yTicks,
    cashPath: showCash ? buildPath('cash') : '',
    netWorthPath: showNetWorth ? buildPath('netWorth') : '',
    isEmpty: false
  };
}

function renderFinanceChart(chartData, state) {
  const geometry = buildFinanceChartGeometry(chartData, {
    showCash: FinancesModalState.showCash,
    showNetWorth: FinancesModalState.showNetWorth
  });

  financesChartSvgEl.textContent = '';

  const appendSvgChild = (tagName, attributes) => {
    const element = document.createElementNS(svgNamespace, tagName);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    financesChartSvgEl.appendChild(element);
    return element;
  };

  for (const tick of geometry.yTicks) {
    appendSvgChild('line', {
      class: 'finances-chart-grid-line',
      x1: FINANCE_CHART_PAD_LEFT,
      x2: FINANCE_CHART_WIDTH - FINANCE_CHART_PAD_RIGHT,
      y1: tick.y.toFixed(2),
      y2: tick.y.toFixed(2)
    });
    appendSvgChild('text', {
      class: 'finances-chart-tick-label',
      x: FINANCE_CHART_PAD_LEFT - 6,
      y: (tick.y + 3).toFixed(2),
      'text-anchor': 'end'
    }).textContent = tick.label;
  }

  for (const tick of geometry.xTicks) {
    appendSvgChild('text', {
      class: 'finances-chart-tick-label',
      x: tick.x.toFixed(2),
      y: FINANCE_CHART_HEIGHT - 5,
      'text-anchor': 'middle'
    }).textContent = tick.label;
  }

  if (geometry.cashPath) {
    appendSvgChild('path', {
      class: 'finances-chart-line finances-chart-line--cash',
      d: geometry.cashPath
    });
  }

  if (geometry.netWorthPath) {
    appendSvgChild('path', {
      class: 'finances-chart-line finances-chart-line--net-worth',
      d: geometry.netWorthPath
    });
  }

  if (geometry.isEmpty) {
    appendSvgChild('text', {
      class: 'finances-chart-empty-label',
      x: FINANCE_CHART_WIDTH / 2,
      y: FINANCE_CHART_HEIGHT / 2,
      'text-anchor': 'middle'
    }).textContent = 'No data yet';
  }
}

function refreshRoutesHudButton(state = gameState.getState()) {
  const isInActiveGame =
    state &&
    state.ui &&
    state.ui.screen === 'game' &&
    state.game &&
    state.game.status === 'active';

  hudBottomRightStackEl.classList.toggle('hidden', !isInActiveGame);

  if (!isInActiveGame && RoutesModalState.isOpen) {
    RoutesModalState.isOpen = false;
    RoutesModalState.isCreateRouteOpen = false;
    RoutesModalState.isAircraftManagementOpen = false;
    RoutesModalState.isStandaloneChildModal = false;
    RoutesModalState.childModalReturnContext = ROUTE_CHILD_MODAL_RETURN_CONTEXT.ROUTES;
    RoutesModalState.entryAirportId = null;
    selectedRouteAircraftManagementRouteId = null;
    pendingRouteAircraftAssignAircraftInstanceId = null;
    pendingRouteAircraftUnassignAircraftInstanceId = null;
    routeAircraftManagementErrorMessage = '';
    RoutesModalState.openedFrom = null;
  }
}

function createRouteListRow(routeId, originCode, destinationCode, assignedAircraftCount, maxAircraftCapacity, isInActiveGame, pendingRemoval) {
  const routeItemEl = document.createElement('div');
  routeItemEl.className = 'routes-list-item';
  routeItemEl.dataset.routeId = routeId;

  const routeMainEl = document.createElement('div');
  routeMainEl.className = 'routes-list-main';

  const routeTitleEl = document.createElement('p');
  routeTitleEl.className = 'routes-list-route';
  routeTitleEl.textContent = `${originCode} → ${destinationCode}`;

  const routeMetaEl = document.createElement('p');
  routeMetaEl.className = 'routes-list-meta';

  const routeDistanceMetaEl = document.createElement('span');
  routeDistanceMetaEl.className = 'routes-list-meta-metric';

  const routeAssignedAircraftMetaEl = document.createElement('span');
  routeAssignedAircraftMetaEl.className = 'routes-list-meta-metric';
  routeAssignedAircraftMetaEl.textContent =
    `Assigned Aircraft: ${INTEGER_FORMATTER.format(assignedAircraftCount)}/${maxAircraftCapacity == null ? '—' : INTEGER_FORMATTER.format(maxAircraftCapacity)}`;

  routeMetaEl.appendChild(routeDistanceMetaEl);
  routeMetaEl.appendChild(routeAssignedAircraftMetaEl);

  routeMainEl.appendChild(routeTitleEl);
  routeMainEl.appendChild(routeMetaEl);

  const routeActionsEl = document.createElement('div');
  routeActionsEl.className = 'routes-list-actions';

  const manageAircraftButtonEl = document.createElement('button');
  manageAircraftButtonEl.type = 'button';
  manageAircraftButtonEl.className = 'hud-icon-button routes-aircraft-launch-button';
  manageAircraftButtonEl.title = 'Manage aircraft';
  manageAircraftButtonEl.textContent = '✈+';
  manageAircraftButtonEl.disabled = !isInActiveGame;
  manageAircraftButtonEl.addEventListener('click', () => {
    if (!isInActiveGame) {
      return;
    }
    openRouteAircraftManagementModal(routeId);
  });

  const removeButtonEl = document.createElement('button');
  removeButtonEl.type = 'button';
  removeButtonEl.className = 'airport-interaction-action-button shop-aircraft-sell-button routes-remove-button';
  removeButtonEl.disabled = !isInActiveGame || pendingRemoval === true;
  removeButtonEl.addEventListener('click', () => {
    if (!isInActiveGame || pendingRouteRemoveRouteId != null) {
      return;
    }
    pendingRouteRemoveRouteId = routeId;
    routeRemoveErrorMessage = '';
    refreshRoutesModal(gameState.getState());
    emitRouteRemoveRequest(routeId);
  });

  routeActionsEl.appendChild(manageAircraftButtonEl);
  routeActionsEl.appendChild(removeButtonEl);

  routeItemEl.appendChild(routeMainEl);
  routeItemEl.appendChild(routeActionsEl);

  return {
    routeItemEl,
    routeTitleEl,
    routeDistanceMetaEl,
    routeAssignedAircraftMetaEl,
    manageAircraftButtonEl,
    removeButtonEl
  };
}

function updateRouteListRow(rowElements, routeId, originCode, destinationCode, distanceText, assignedAircraftCount, maxAircraftCapacity, isInActiveGame, pendingRemoval) {
  const {
    routeTitleEl,
    routeDistanceMetaEl,
    routeAssignedAircraftMetaEl,
    manageAircraftButtonEl,
    removeButtonEl
  } = rowElements;

  routeTitleEl.textContent = `${originCode} → ${destinationCode}`;
  routeDistanceMetaEl.textContent = `Distance: ${distanceText}`;
  routeAssignedAircraftMetaEl.textContent =
    `Assigned Aircraft: ${INTEGER_FORMATTER.format(assignedAircraftCount)}/${maxAircraftCapacity == null ? '—' : INTEGER_FORMATTER.format(maxAircraftCapacity)}`;
  manageAircraftButtonEl.disabled = !isInActiveGame;
  manageAircraftButtonEl.setAttribute('aria-label', `Manage aircraft for route ${originCode} to ${destinationCode}`);

  const isPendingForRoute = pendingRouteRemoveRouteId && String(pendingRouteRemoveRouteId) === routeId;
  removeButtonEl.textContent = isPendingForRoute ? 'Removing...' : 'Remove';
  removeButtonEl.disabled = !isInActiveGame || (pendingRouteRemoveRouteId != null) || pendingRemoval === true;
}

function refreshRoutesModal(state = gameState.getState()) {
  if (!isRoutesModalDomReady) {
    return;
  }

  const normalizedState = state && typeof state === 'object' ? state : null;
  const isInGameScreen = normalizedState && normalizedState.ui && normalizedState.ui.screen === 'game';
  const isInActiveGame =
    isInGameScreen &&
    normalizedState &&
    normalizedState.game &&
    normalizedState.game.status === 'active';
  const shouldShowRoutesState = Boolean(isInGameScreen && RoutesModalState.isOpen);
  const shouldHideRoutesOverlayForStandaloneChild =
    RoutesModalState.isStandaloneChildModal &&
    (RoutesModalState.isCreateRouteOpen || RoutesModalState.isAircraftManagementOpen);
  const shouldShowRoutesModal = shouldShowRoutesState && !shouldHideRoutesOverlayForStandaloneChild;

  routesModalOverlayEl.classList.toggle('hidden', !shouldShowRoutesModal);
  routesModalOverlayEl.setAttribute('aria-hidden', shouldShowRoutesModal ? 'false' : 'true');

  if (!shouldShowRoutesState) {
    RoutesModalState.isCreateRouteOpen = false;
    RoutesModalState.isAircraftManagementOpen = false;
    createRouteModalOverlayEl.classList.add('hidden');
    createRouteModalOverlayEl.setAttribute('aria-hidden', 'true');
    routeAircraftManagementModalOverlayEl.classList.add('hidden');
    routeAircraftManagementModalOverlayEl.setAttribute('aria-hidden', 'true');
    isRouteOriginDropdownOpen = false;
    isRouteDestinationDropdownOpen = false;
    return;
  }

  const airportLookupById = getAirportLookupById(normalizedState);
  let localPlayerRoutes = getLocalPlayerRoutes(normalizedState);

  if (RoutesModalState.airportFilterId) {
    const filterAirportId = String(RoutesModalState.airportFilterId);
    localPlayerRoutes = localPlayerRoutes.filter(route => {
      if (!route) return false;
      const originMatches = String(route.originAirportId || '') === filterAirportId;
      const destinationMatches = String(route.destinationAirportId || '') === filterAirportId;
      return originMatches || destinationMatches;
    });
  }

  const sortedLocalPlayerRoutes = localPlayerRoutes.slice().sort((leftRoute, rightRoute) => {
    const leftOrigin = String((leftRoute && leftRoute.originAirportId) || '');
    const leftDestination = String((leftRoute && leftRoute.destinationAirportId) || '');
    const rightOrigin = String((rightRoute && rightRoute.originAirportId) || '');
    const rightDestination = String((rightRoute && rightRoute.destinationAirportId) || '');
    const leftKey = `${leftOrigin}:${leftDestination}`;
    const rightKey = `${rightOrigin}:${rightDestination}`;
    return leftKey.localeCompare(rightKey);
  });

  if (routeRemoveErrorMessage) {
    routesListFeedbackEl.textContent = routeRemoveErrorMessage;
    routesListFeedbackEl.classList.remove('hidden');
  } else {
    routesListFeedbackEl.textContent = '';
    routesListFeedbackEl.classList.add('hidden');
  }

  const currentRouteIds = new Set();

  if (sortedLocalPlayerRoutes.length === 0) {
    routesListEl.classList.add('hidden');
    routesListEmptyEl.classList.remove('hidden');
    routeListRowByRouteId.clear();
    routesListEl.innerHTML = '';
  } else {
    routesListEl.classList.remove('hidden');
    routesListEmptyEl.classList.add('hidden');

    sortedLocalPlayerRoutes.forEach((route) => {
      if (!route) {
        return;
      }

      const routeId = String(route.routeId || '');
      if (!routeId) {
        return;
      }

      currentRouteIds.add(routeId);

      const originAirport = airportLookupById.get(String(route.originAirportId || '')) || null;
      const destinationAirport = airportLookupById.get(String(route.destinationAirportId || '')) || null;
      const originCode = getAirportCodeForRouteCard(originAirport, route.originAirportId);
      const destinationCode = getAirportCodeForRouteCard(destinationAirport, route.destinationAirportId);
      const distanceText = Number.isFinite(route.distanceKm)
        ? `${INTEGER_FORMATTER.format(route.distanceKm)} km`
        : '-';
      const assignedAircraftCount = Array.isArray(route.assignedAircraftInstanceIds)
        ? route.assignedAircraftInstanceIds.length
        : 0;
      const maxAircraftCapacity = resolveRouteMaxAircraftCapacity(normalizedState, route);

      let rowElements = routeListRowByRouteId.get(routeId);

      if (!rowElements) {
        rowElements = createRouteListRow(
          routeId,
          originCode,
          destinationCode,
          assignedAircraftCount,
          maxAircraftCapacity,
          isInActiveGame,
          route.pendingRemoval
        );
        routeListRowByRouteId.set(routeId, rowElements);
      } else {
        updateRouteListRow(
          rowElements,
          routeId,
          originCode,
          destinationCode,
          distanceText,
          assignedAircraftCount,
          maxAircraftCapacity,
          isInActiveGame,
          route.pendingRemoval
        );
      }

      routesListEl.appendChild(rowElements.routeItemEl);
    });

    for (const routeId of routeListRowByRouteId.keys()) {
      if (!currentRouteIds.has(routeId)) {
        const rowElements = routeListRowByRouteId.get(routeId);
        if (rowElements && rowElements.routeItemEl) {
          routesListEl.removeChild(rowElements.routeItemEl);
        }
        routeListRowByRouteId.delete(routeId);
      }
    }
  }

  const selectedRouteForAircraftModal = selectedRouteAircraftManagementRouteId
    ? sortedLocalPlayerRoutes.find((route) => {
      if (!route || !route.routeId) {
        return false;
      }

      return String(route.routeId) === String(selectedRouteAircraftManagementRouteId);
    })
    : null;

  if (RoutesModalState.isAircraftManagementOpen && !selectedRouteForAircraftModal) {
    RoutesModalState.isAircraftManagementOpen = false;
    selectedRouteAircraftManagementRouteId = null;
    pendingRouteAircraftAssignAircraftInstanceId = null;
    pendingRouteAircraftUnassignAircraftInstanceId = null;
    routeAircraftManagementErrorMessage = '';
    routeAircraftManagementFeedbackKind = 'error';
    routeAircraftAssignQuantityByCatalogId = new Map();
    routeAircraftUnassignQuantityByCatalogId = new Map();
    routeAircraftAssignQuantityInputByCatalogId = new Map();
    routeAircraftUnassignQuantityInputByCatalogId = new Map();
    routeAircraftAssignMaxByCatalogId = new Map();
    routeAircraftUnassignMaxByCatalogId = new Map();
    resetRouteAircraftManagementRowCaches();
    routeAircraftBulkOperation = null;
  }

  const shouldShowAircraftManagementModal = Boolean(
    shouldShowRoutesState && RoutesModalState.isAircraftManagementOpen && selectedRouteForAircraftModal
  );
  routeAircraftManagementModalOverlayEl.classList.toggle('hidden', !shouldShowAircraftManagementModal);
  routeAircraftManagementModalOverlayEl.setAttribute('aria-hidden', shouldShowAircraftManagementModal ? 'false' : 'true');

  if (routeAircraftManagementErrorMessage) {
    routeAircraftManagementFeedbackEl.textContent = routeAircraftManagementErrorMessage;
    routeAircraftManagementFeedbackEl.classList.remove('hidden');
    routeAircraftManagementFeedbackEl.classList.toggle(
      'routes-aircraft-management-feedback--success',
      routeAircraftManagementFeedbackKind === 'success'
    );
    routeAircraftManagementFeedbackEl.classList.toggle(
      'routes-aircraft-management-feedback--info',
      routeAircraftManagementFeedbackKind === 'info'
    );
  } else {
    routeAircraftManagementFeedbackEl.textContent = '';
    routeAircraftManagementFeedbackEl.classList.add('hidden');
    routeAircraftManagementFeedbackEl.classList.remove('routes-aircraft-management-feedback--success');
    routeAircraftManagementFeedbackEl.classList.remove('routes-aircraft-management-feedback--info');
  }

  if (selectedRouteForAircraftModal) {
    const selectedOriginAirport = airportLookupById.get(String(selectedRouteForAircraftModal.originAirportId || '')) || null;
    const selectedDestinationAirport = airportLookupById.get(String(selectedRouteForAircraftModal.destinationAirportId || '')) || null;
    const selectedOriginCode = getAirportCodeForRouteCard(selectedOriginAirport, selectedRouteForAircraftModal.originAirportId);
    const selectedDestinationCode = getAirportCodeForRouteCard(selectedDestinationAirport, selectedRouteForAircraftModal.destinationAirportId);
    routeAircraftManagementModalTitleEl.textContent = `${selectedOriginCode} → ${selectedDestinationCode}`;

    const localPlayerIdForAircraftModal = normalizedState && normalizedState.session ? normalizedState.session.playerId : null;
    const normalizedLocalPlayerId = String(localPlayerIdForAircraftModal || '').trim();
    const selectedRouteId = String(selectedRouteForAircraftModal.routeId || '').trim();
    const routeDistanceKm = Number(selectedRouteForAircraftModal.distanceKm);
    const ownedAircraft = Array.isArray(normalizedState && normalizedState.game && normalizedState.game.ownedAircraft)
      ? normalizedState.game.ownedAircraft
      : [];
    const aircraftCatalogLookupById = getAircraftCatalogLookupById(normalizedState);

    const localOwnedAircraft = ownedAircraft.filter((aircraft) => {
      if (!aircraft || aircraft.ownerPlayerId == null) {
        return false;
      }

      return String(aircraft.ownerPlayerId) === normalizedLocalPlayerId;
    });

    const availableAircraft = localOwnedAircraft.filter((aircraft) => {
      const aircraftStatus = String(aircraft.status || '').trim().toLocaleLowerCase();
      const assignedRouteId = String(aircraft.assignedRouteId || '').trim();
      const catalogId = String(aircraft.aircraftCatalogId || '').trim();
      const catalogEntry = aircraftCatalogLookupById.get(catalogId) || null;
      const aircraftRangeKm = Number(catalogEntry && catalogEntry.rangeKm);

      if (aircraftStatus !== 'available') {
        return false;
      }

      if (assignedRouteId) {
        return false;
      }

      if (!Number.isFinite(routeDistanceKm) || !Number.isFinite(aircraftRangeKm)) {
        return false;
      }

      return aircraftRangeKm >= routeDistanceKm;
    });

    const allocatedAircraftInstanceIds = new Set(
      (Array.isArray(selectedRouteForAircraftModal.assignedAircraftInstanceIds)
        ? selectedRouteForAircraftModal.assignedAircraftInstanceIds
        : []
      ).map((aircraftInstanceId) => String(aircraftInstanceId || '').trim())
    );
    const allocatedAssignedAircraft = localOwnedAircraft.filter((aircraft) => {
      const aircraftInstanceId = String(aircraft.aircraftInstanceId || '').trim();
      const assignedRouteId = String(aircraft.assignedRouteId || '').trim();
      return allocatedAircraftInstanceIds.has(aircraftInstanceId) && assignedRouteId === selectedRouteId;
    });
    const assignedAircraftCountByCatalogId = new Map();
    allocatedAssignedAircraft.forEach((aircraft) => {
      const catalogId = String(aircraft.aircraftCatalogId || '').trim();
      if (!catalogId) return;

      assignedAircraftCountByCatalogId.set(
        catalogId,
        (assignedAircraftCountByCatalogId.get(catalogId) || 0) + 1
      );
    });

    const groupedAvailableAircraft = groupRouteAircraftByCatalog(availableAircraft, aircraftCatalogLookupById);
    const groupedAllocatedAircraft = groupRouteAircraftByCatalog(allocatedAssignedAircraft, aircraftCatalogLookupById);
    const actionableAssignedAircraft = allocatedAssignedAircraft.filter((aircraft) => aircraft.isPendingUnassign !== true);
    const groupedAssignedAircraft = groupRouteAircraftByCatalog(actionableAssignedAircraft, aircraftCatalogLookupById);
    const actionableAircraftIdsByCatalogId = new Map(
      groupedAssignedAircraft.map((group) => [group.catalogId, group.aircraftInstanceIds])
    );
    const groupedAssignedAircraftForDisplay = groupedAllocatedAircraft.map((group) => ({
      ...group,
      aircraftInstanceIds: actionableAircraftIdsByCatalogId.get(group.catalogId) || []
    }));
    const maxAircraftCapacity = resolveRouteMaxAircraftCapacity(normalizedState, selectedRouteForAircraftModal);
    const assignedAircraftCount = Array.isArray(selectedRouteForAircraftModal.assignedAircraftInstanceIds)
      ? selectedRouteForAircraftModal.assignedAircraftInstanceIds.length
      : 0;
    const isRouteAtAircraftCapacity =
      maxAircraftCapacity != null && maxAircraftCapacity - assignedAircraftCount <= 0;
    const modelEditLockedUntilRealMs = getRouteAircraftModelEditLocks(selectedRouteForAircraftModal);
    if (lastRenderedRouteAircraftManagementRouteId !== selectedRouteId) {
      routeAvailableAircraftRowByCatalogId = new Map();
      routeAssignedAircraftRowByCatalogId = new Map();
      routeAvailableAircraftListEl.innerHTML = '';
      routeAssignedAircraftListEl.innerHTML = '';
      lastRenderedRouteAircraftManagementRouteId = selectedRouteId;
    }

    routeAvailableAircraftGroupByCatalogId = groupedAvailableAircraft.reduce((lookup, group) => {
      const catalogId = String(group && group.catalogId ? group.catalogId : '').trim();
      if (!catalogId) {
        return lookup;
      }

      lookup.set(catalogId, group);
      return lookup;
    }, new Map());

    routeAssignedAircraftGroupByCatalogId = groupedAssignedAircraft.reduce((lookup, group) => {
      const catalogId = String(group && group.catalogId ? group.catalogId : '').trim();
      if (!catalogId) {
        return lookup;
      }

      lookup.set(catalogId, group);
      return lookup;
    }, new Map());

    const focusedRouteQuantityInputBeforeSync =
      document.activeElement &&
      document.activeElement.classList &&
      document.activeElement.classList.contains('routes-aircraft-quantity-input')
        ? document.activeElement
        : null;

    syncRouteAircraftGroupRows({
      mode: 'assign',
      groups: groupedAvailableAircraft,
      listEl: routeAvailableAircraftListEl,
      emptyMessage: 'No range-compatible available aircraft for this route.',
      isInActiveGame,
      modelEditLockedUntilRealMs,
      isRouteAtAircraftCapacity
    });

    syncRouteAircraftGroupRows({
      mode: 'unassign',
      groups: groupedAssignedAircraftForDisplay,
      listEl: routeAssignedAircraftListEl,
      emptyMessage: 'No aircraft currently assigned to this route.',
      isInActiveGame,
      modelEditLockedUntilRealMs,
      assignedAircraftCountByCatalogId,
      maxAircraftCapacity
    });

    scheduleRouteAircraftModelEditLockRefresh(modelEditLockedUntilRealMs);

    if (focusedRouteQuantityInputBeforeSync) {
      const focusedRouteQuantityInputAfterSync = document.activeElement;
      if (DEBUG_ROUTE_AIRCRAFT_FOCUS) {
        console.debug(
          '[route-aircraft-focus-check]',
          focusedRouteQuantityInputBeforeSync === focusedRouteQuantityInputAfterSync,
          {
            mode: focusedRouteQuantityInputBeforeSync.closest('[data-mode]')
              ? focusedRouteQuantityInputBeforeSync.closest('[data-mode]').getAttribute('data-mode')
              : null,
            catalogId: focusedRouteQuantityInputBeforeSync.closest('[data-catalog-id]')
              ? focusedRouteQuantityInputBeforeSync.closest('[data-catalog-id]').getAttribute('data-catalog-id')
              : null
          }
        );
      }
    }
  } else {
    routeAircraftManagementModalTitleEl.textContent = '-';
    routeAvailableAircraftListEl.innerHTML = '';
    routeAssignedAircraftListEl.innerHTML = '';
    resetRouteAircraftManagementRowCaches();
  }

  const shouldShowCreateRouteModal = Boolean(shouldShowRoutesState && RoutesModalState.isCreateRouteOpen);

  createRouteModalOverlayEl.classList.toggle('hidden', !shouldShowCreateRouteModal);
  createRouteModalOverlayEl.setAttribute('aria-hidden', shouldShowCreateRouteModal ? 'false' : 'true');

  if (!shouldShowCreateRouteModal) {
    isRouteOriginDropdownOpen = false;
    isRouteDestinationDropdownOpen = false;
    return;
  }

  const ownedAirports = getOwnedAirportsForLocalPlayer(normalizedState);
  const localPlayerId = normalizedState && normalizedState.session ? normalizedState.session.playerId : null;
  const authoritativeRoutes = Array.isArray(normalizedState && normalizedState.game && normalizedState.game.routes)
    ? normalizedState.game.routes
    : [];
  const ownedAirportById = new Map(
    ownedAirports
      .map((airport) => {
        if (!airport) {
          return null;
        }

        const airportId = String(airport.id || airport.iata || '');
        if (!airportId) {
          return null;
        }

        return [airportId, airport];
      })
      .filter(Boolean)
  );

  if (selectedRouteOriginAirportId && !ownedAirportById.has(String(selectedRouteOriginAirportId))) {
    selectedRouteOriginAirportId = null;
    routeOriginSearchQuery = '';
  }

  if (selectedRouteDestinationAirportId && !ownedAirportById.has(String(selectedRouteDestinationAirportId))) {
    selectedRouteDestinationAirportId = null;
    routeDestinationSearchQuery = '';
  }

  if (
    selectedRouteOriginAirportId &&
    selectedRouteDestinationAirportId &&
    String(selectedRouteOriginAirportId) === String(selectedRouteDestinationAirportId)
  ) {
    selectedRouteDestinationAirportId = null;
    routeDestinationSearchQuery = '';
  }

  if (
    selectedRouteOriginAirportId &&
    selectedRouteDestinationAirportId &&
    !isRouteSelectorAirportChoiceValid({
      routes: authoritativeRoutes,
      ownedAirports,
      localPlayerId,
      candidateAirportId: selectedRouteDestinationAirportId,
      oppositeSelectedAirportId: selectedRouteOriginAirportId,
      selectedFromId: selectedRouteOriginAirportId,
      selectedToId: selectedRouteDestinationAirportId
    })
  ) {
    selectedRouteDestinationAirportId = null;
    routeDestinationSearchQuery = '';
  }

  const selectedOriginAirport = selectedRouteOriginAirportId
    ? ownedAirportById.get(String(selectedRouteOriginAirportId)) || null
    : null;
  const selectedDestinationAirport = selectedRouteDestinationAirportId
    ? ownedAirportById.get(String(selectedRouteDestinationAirportId)) || null
    : null;

  const informationalDistanceKm = calculateRouteDistanceKmPreview(selectedOriginAirport, selectedDestinationAirport);
  routesDistanceValueEl.textContent = Number.isFinite(informationalDistanceKm)
    ? `${INTEGER_FORMATTER.format(informationalDistanceKm)} km`
    : '-';

  const canCreateRoute = isRouteCreateEligible({
    isInActiveGame,
    originAirportId: selectedRouteOriginAirportId,
    destinationAirportId: selectedRouteDestinationAirportId,
    isPending: isRouteCreatePending
  });
  routesCreateButtonEl.disabled = !canCreateRoute;
  routesCreateButtonEl.textContent = isRouteCreatePending ? 'Creating...' : 'Create Route';

  if (routeCreateErrorMessage) {
    routesCreateFeedbackEl.textContent = routeCreateErrorMessage;
    routesCreateFeedbackEl.classList.remove('hidden');
  } else {
    routesCreateFeedbackEl.textContent = '';
    routesCreateFeedbackEl.classList.add('hidden');
  }

  if (!isRouteOriginDropdownOpen) {
    routeOriginSearchQuery = selectedOriginAirport ? getAirportDisplayName(selectedOriginAirport) : '';
  }

  if (!isRouteDestinationDropdownOpen) {
    routeDestinationSearchQuery = selectedDestinationAirport ? getAirportDisplayName(selectedDestinationAirport) : '';
  }

  routesOriginSearchInputEl.value = routeOriginSearchQuery;
  routesDestinationSearchInputEl.value = routeDestinationSearchQuery;

  const renderRouteAirportDropdown = ({
    resultsListEl,
    filteredAirports,
    selectedAirportId,
    isOpen,
    onSelect,
    emptyMessage
  }) => {
    resultsListEl.innerHTML = '';
    resultsListEl.classList.toggle('hidden', !isOpen);

    if (!isOpen) {
      return;
    }

    if (filteredAirports.length === 0) {
      const emptyEl = document.createElement('p');
      emptyEl.className = 'shop-airport-results-empty';
      emptyEl.textContent = emptyMessage;
      resultsListEl.appendChild(emptyEl);
      return;
    }

    filteredAirports.forEach((airport) => {
      const airportId = String((airport && (airport.id || airport.iata)) || '');
      if (!airportId) {
        return;
      }

      const optionButtonEl = document.createElement('button');
      optionButtonEl.type = 'button';
      optionButtonEl.className = 'shop-airport-option';
      if (selectedAirportId && String(selectedAirportId) === airportId) {
        optionButtonEl.classList.add('shop-airport-option--selected');
      }

      const optionNameEl = document.createElement('span');
      optionNameEl.className = 'shop-airport-option-name';
      optionNameEl.textContent = getAirportDisplayName(airport);

      const optionMetaEl = document.createElement('span');
      optionMetaEl.className = 'shop-airport-option-meta';
      optionMetaEl.textContent = [airport && airport.city, airport && airport.country].filter(Boolean).join(', ') || 'Location unknown';

      optionButtonEl.appendChild(optionNameEl);
      optionButtonEl.appendChild(optionMetaEl);
      optionButtonEl.addEventListener('click', () => {
        onSelect(airport);
      });

      resultsListEl.appendChild(optionButtonEl);
    });
  };

  const originAvailableAirports = ownedAirports.filter((airport) => {
    const airportId = String((airport && (airport.id || airport.iata)) || '').trim();
    return isRouteSelectorAirportChoiceValid({
      routes: authoritativeRoutes,
      ownedAirports,
      localPlayerId,
      candidateAirportId: airportId,
      oppositeSelectedAirportId: selectedRouteDestinationAirportId,
      selectedFromId: airportId,
      selectedToId: selectedRouteDestinationAirportId
    });
  });

  const destinationAvailableAirports = ownedAirports.filter((airport) => {
    const airportId = String((airport && (airport.id || airport.iata)) || '').trim();
    return isRouteSelectorAirportChoiceValid({
      routes: authoritativeRoutes,
      ownedAirports,
      localPlayerId,
      candidateAirportId: airportId,
      oppositeSelectedAirportId: selectedRouteOriginAirportId,
      selectedFromId: selectedRouteOriginAirportId,
      selectedToId: airportId
    });
  });

  const filteredOriginAirports = getFilteredOwnedAirportsForRouteSelector(originAvailableAirports, routeOriginSearchQuery);
  const filteredDestinationAirports = getFilteredOwnedAirportsForRouteSelector(destinationAvailableAirports, routeDestinationSearchQuery);

  const emptyMessage = ownedAirports.length === 0
    ? 'You do not own any airports yet.'
    : 'No owned airports match this search.';

  renderRouteAirportDropdown({
    resultsListEl: routesOriginResultsListEl,
    filteredAirports: filteredOriginAirports,
    selectedAirportId: selectedRouteOriginAirportId,
    isOpen: isRouteOriginDropdownOpen,
    emptyMessage,
    onSelect: (airport) => {
      const airportId = String((airport && (airport.id || airport.iata)) || '');
      selectedRouteOriginAirportId = airportId || null;
      routeOriginSearchQuery = airport ? getAirportDisplayName(airport) : '';
      isRouteOriginDropdownOpen = false;
      routeCreateErrorMessage = '';
      refreshRoutesModal(gameState.getState());
    }
  });

  renderRouteAirportDropdown({
    resultsListEl: routesDestinationResultsListEl,
    filteredAirports: filteredDestinationAirports,
    selectedAirportId: selectedRouteDestinationAirportId,
    isOpen: isRouteDestinationDropdownOpen,
    emptyMessage,
    onSelect: (airport) => {
      const airportId = String((airport && (airport.id || airport.iata)) || '');
      selectedRouteDestinationAirportId = airportId || null;
      routeDestinationSearchQuery = airport ? getAirportDisplayName(airport) : '';
      isRouteDestinationDropdownOpen = false;
      routeCreateErrorMessage = '';
      refreshRoutesModal(gameState.getState());
    }
  });

  routesOriginSearchInputEl.setAttribute('aria-expanded', isRouteOriginDropdownOpen ? 'true' : 'false');
  routesDestinationSearchInputEl.setAttribute('aria-expanded', isRouteDestinationDropdownOpen ? 'true' : 'false');
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

function emitRouteCreateRequest(originAirportId, destinationAirportId) {
  socket.emit('route:create:request', {
    originAirportId,
    destinationAirportId
  });
}

function emitRouteRemoveRequest(routeId) {
  socket.emit('route:remove:request', { routeId });
}


function emitRouteAircraftAssignBulkRequest(routeId, aircraftInstanceIds) {
  socket.emit('route:aircraft:assign:bulk:request', {
    routeId,
    aircraftInstanceIds
  });
}

function emitRouteAircraftUnassignBulkRequest(routeId, aircraftInstanceIds) {
  socket.emit('route:aircraft:unassign:bulk:request', {
    routeId,
    aircraftInstanceIds
  });
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

function createAirportActionButton(label, onClick, { variant = 'default', isDisabled = false } = {}) {
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
    classNames.push('shop-aircraft-warning-button');
  }

  button.className = classNames.join(' ');
  button.textContent = label;
  button.disabled = Boolean(isDisabled);
  button.addEventListener('click', onClick);
  return button;
}

function createRoutesShortcutIconButton({ onClick, ariaLabel = 'Open Routes', isDisabled = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-icon-button routes-aircraft-launch-button';
  button.setAttribute('aria-label', ariaLabel);
  button.title = ariaLabel;
  button.appendChild(routesHudButtonIconEl.cloneNode(true));
  button.disabled = Boolean(isDisabled);
  button.style.marginLeft = 'auto';

  if (typeof onClick === 'function') {
    button.addEventListener('click', onClick);
  }

  return button;
}

function isAirportOwnedByLocalPlayer(state, airport) {
  const localPlayerId = state && state.session ? state.session.playerId : null;
  const ownerPlayerId = airport && airport.ownerPlayerId;
  return ownerPlayerId != null && localPlayerId != null && String(ownerPlayerId) === String(localPlayerId);
}

function setAirportInteractionFallbackContent({ titleEl, ownerValueEl, priceValueEl, capacityLimitsValueEl, routesValueEl, assignedAircraftValueEl, actionsEl, messageEl }) {
  titleEl.textContent = 'Select an airport';
  ownerValueEl.textContent = 'Unknown';
  priceValueEl.textContent = '-';
  if (capacityLimitsValueEl) {
    capacityLimitsValueEl.textContent = '—';
  }
  if (routesValueEl) {
    routesValueEl.textContent = '—';
  }
  if (assignedAircraftValueEl) {
    assignedAircraftValueEl.textContent = '—';
  }
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

function getAirportCodeForRouteCard(airport, fallbackAirportId) {
  if (airport && typeof airport.iata === 'string' && airport.iata.trim().length > 0) {
    return airport.iata.trim();
  }

  if (airport && typeof airport.icao === 'string' && airport.icao.trim().length > 0) {
    return airport.icao.trim();
  }

  if (airport && typeof airport.id === 'string' && airport.id.trim().length > 0) {
    return airport.id.trim();
  }

  const normalizedFallbackAirportId = String(fallbackAirportId || '').trim();
  return normalizedFallbackAirportId || '---';
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

function normalizeAirportSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function getOwnedAirportsForLocalPlayer(state) {
  const localPlayerId = state && state.session ? state.session.playerId : null;
  if (localPlayerId == null) {
    return [];
  }

  const airports = getAuthoritativeAirports(state);
  return airports
    .filter((airport) => {
      if (!airport || airport.ownerPlayerId == null) {
        return false;
      }

      return String(airport.ownerPlayerId) === String(localPlayerId);
    })
    .sort(compareAirportsAlphabetically);
}

function getFilteredOwnedAirportsForRouteSelector(ownedAirports, rawSearchValue) {
  const searchTokens = normalizeAirportSearchText(rawSearchValue)
    .split(/\s+/)
    .filter(Boolean);
  if (searchTokens.length === 0) {
    return ownedAirports;
  }

  return ownedAirports.filter((airport) => {
    const searchDocument = normalizeAirportSearchText(getAirportSearchDocument(airport));
    return searchTokens.every((token) => searchDocument.includes(token));
  });
}

function getCanonicalRouteKeyForSelector(leftAirportId, rightAirportId) {
  const normalizedLeftAirportId = String(leftAirportId || '').trim();
  const normalizedRightAirportId = String(rightAirportId || '').trim();

  if (!normalizedLeftAirportId || !normalizedRightAirportId) {
    return '';
  }

  return [normalizedLeftAirportId, normalizedRightAirportId].sort((leftId, rightId) => {
    return leftId.localeCompare(rightId);
  }).join('::');
}

function isRouteSelectorAirportChoiceValid({
  routes,
  ownedAirports,
  localPlayerId,
  candidateAirportId,
  oppositeSelectedAirportId,
  selectedFromId = null,
  selectedToId = null
}) {
  const normalizedCandidateAirportId = String(candidateAirportId || '').trim();
  const normalizedOppositeAirportId = String(oppositeSelectedAirportId || '').trim();
  const normalizedLocalPlayerId = String(localPlayerId || '').trim();

  if (!normalizedCandidateAirportId) {
    return false;
  }

  const ownedAirportIds = new Set(
    (Array.isArray(ownedAirports) ? ownedAirports : [])
      .map((airport) => String((airport && (airport.id || airport.iata)) || '').trim())
      .filter((airportId) => airportId.length > 0)
  );

  if (!ownedAirportIds.has(normalizedCandidateAirportId)) {
    return false;
  }

  if (!normalizedOppositeAirportId) {
    return true;
  }

  if (normalizedCandidateAirportId === normalizedOppositeAirportId) {
    return false;
  }

  if (!normalizedLocalPlayerId) {
    return true;
  }

  const existingRouteKeys = new Set(
    (Array.isArray(routes) ? routes : [])
      .filter((route) => {
        if (!route || route.ownerPlayerId == null) {
          return false;
        }

        return String(route.ownerPlayerId) === normalizedLocalPlayerId;
      })
      .map((route) => {
        const routeKey = String(route.routeKey || '').trim();
        if (routeKey) {
          return routeKey;
        }

        return getCanonicalRouteKeyForSelector(route.originAirportId, route.destinationAirportId);
      })
      .filter((routeKey) => routeKey.length > 0)
  );

  const candidateRouteKey = getCanonicalRouteKeyForSelector(normalizedCandidateAirportId, normalizedOppositeAirportId);
  if (!candidateRouteKey) {
    return true;
  }

  return !existingRouteKeys.has(candidateRouteKey);
}

function getAirportLookupById(state) {
  const airports = getAuthoritativeAirports(state);
  return airports.reduce((lookup, airport) => {
    if (!airport) {
      return lookup;
    }

    const airportId = String(airport.id || airport.iata || '').trim();
    if (!airportId) {
      return lookup;
    }

    lookup.set(airportId, airport);
    return lookup;
  }, new Map());
}

function getLocalPlayerRoutes(state) {
  const localPlayerId = state && state.session ? state.session.playerId : null;
  if (localPlayerId == null) {
    return [];
  }

  const routes = Array.isArray(state && state.game && state.game.routes) ? state.game.routes : [];
  return routes.filter((route) => {
    if (!route || route.ownerPlayerId == null) {
      return false;
    }

    return String(route.ownerPlayerId) === String(localPlayerId);
  });
}

function getLocalPlayerRoutesForAirport(state, airportId) {
  const normalizedAirportId = String(airportId || '').trim();
  if (!normalizedAirportId) {
    return [];
  }

  return getLocalPlayerRoutes(state).filter((route) => {
    if (!route) {
      return false;
    }

    const originAirportId = String(route.originAirportId || '').trim();
    const destinationAirportId = String(route.destinationAirportId || '').trim();
    return originAirportId === normalizedAirportId || destinationAirportId === normalizedAirportId;
  });
}

function openRouteContextForAirport(airportId) {
  const state = gameState.getState();
  const normalizedAirportId = String(selectedAirportId || airportId || '').trim();
  if (!normalizedAirportId) {
    return;
  }

  const authoritativeAirport = getAuthoritativeAirportById(state, normalizedAirportId);
  if (!authoritativeAirport || !isAirportOwnedByLocalPlayer(state, authoritativeAirport)) {
    return;
  }

  if (authoritativeAirport.isOwnershipChangePending === true) {
    return;
  }

  const matchingRoutes = getLocalPlayerRoutesForAirport(state, normalizedAirportId);
  if (matchingRoutes.length < 1) {
    openCreateRouteModalForAirport(normalizedAirportId, {
      openedFrom: ROUTES_MODAL_OPENED_FROM.SHOP_AIRPORT_PANEL
    });
    return;
  }

  openRoutesModal({
    openedFrom: ROUTES_MODAL_OPENED_FROM.SHOP_AIRPORT_PANEL,
    entryAirportId: normalizedAirportId,
    airportFilterId: normalizedAirportId
  });
}

function calculateRouteDistanceKmPreview(originAirport, destinationAirport) {
  if (!originAirport || !destinationAirport) {
    return null;
  }

  const originLat = Number(originAirport.lat);
  const originLng = Number(originAirport.lng);
  const destinationLat = Number(destinationAirport.lat);
  const destinationLng = Number(destinationAirport.lng);

  if (
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    return null;
  }

  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const latDelta = toRadians(destinationLat - originLat);
  const lngDelta = toRadians(destinationLng - originLng);
  const originLatRadians = toRadians(originLat);
  const destinationLatRadians = toRadians(destinationLat);

  const sinHalfLat = Math.sin(latDelta / 2);
  const sinHalfLng = Math.sin(lngDelta / 2);
  const haversineTerm =
    sinHalfLat * sinHalfLat +
    Math.cos(originLatRadians) * Math.cos(destinationLatRadians) * sinHalfLng * sinHalfLng;
  const angularDistance = 2 * Math.atan2(Math.sqrt(haversineTerm), Math.sqrt(Math.max(0, 1 - haversineTerm)));
  return Math.round(earthRadiusKm * angularDistance);
}

function isRouteCreateEligible({ isInActiveGame, originAirportId, destinationAirportId, isPending }) {
  if (!isInActiveGame || isPending) {
    return false;
  }

  if (!originAirportId || !destinationAirportId) {
    return false;
  }

  return String(originAirportId) !== String(destinationAirportId);
}

function getRouteCreateResultMessage(result) {
  const code = result && typeof result.code === 'string' ? result.code.trim() : '';
  const message = result && typeof result.message === 'string' ? result.message.trim() : '';

  if (message && code) {
    return `${message} [${code}]`;
  }

  if (message) {
    return message;
  }

  if (code) {
    return code;
  }

  return 'Unable to create route.';
}

function getRouteAircraftManagementResultMessage(result, fallbackMessage) {
  const code = result && typeof result.code === 'string' ? result.code.trim() : '';
  const message = result && typeof result.message === 'string' ? result.message.trim() : '';

  if (message && code) {
    return `${message} [${code}]`;
  }

  if (message) {
    return message;
  }

  if (code) {
    return code;
  }

  return fallbackMessage;
}

function setRouteAircraftBulkResultFeedback(result, fallbackMessage) {
  if (!result.success && result.code === 'MODEL_EDIT_LOCKED') {
    routeAircraftManagementFeedbackKind = 'info';
    routeAircraftManagementErrorMessage = 'Roster updating — please try again shortly.';
    return;
  }

  if (!result.success) {
    routeAircraftManagementFeedbackKind = 'error';
    routeAircraftManagementErrorMessage = getRouteAircraftManagementResultMessage(result, fallbackMessage);
    return;
  }

  routeAircraftManagementFeedbackKind = 'success';
  routeAircraftManagementErrorMessage = '';
}

function getAircraftCatalogLookupById(state) {
  const aircraftCatalog = getAircraftCatalogEntries(state);
  return aircraftCatalog.reduce((lookup, aircraft) => {
    if (!aircraft) {
      return lookup;
    }

    const catalogId = String(aircraft.aircraftCatalogId || '').trim();
    if (!catalogId) {
      return lookup;
    }

    lookup.set(catalogId, aircraft);
    return lookup;
  }, new Map());
}

function groupRouteAircraftByCatalog(aircraftList, aircraftCatalogLookupById) {
  const groupedByCatalogId = new Map();

  (Array.isArray(aircraftList) ? aircraftList : []).forEach((aircraft) => {
    if (!aircraft) {
      return;
    }

    const catalogId = String(aircraft.aircraftCatalogId || '').trim();
    if (!catalogId) {
      return;
    }

    const catalogEntry = aircraftCatalogLookupById.get(catalogId) || null;
    const group = groupedByCatalogId.get(catalogId) || {
      catalogId,
      catalogEntry,
      aircraftInstanceIds: []
    };

    group.aircraftInstanceIds.push(String(aircraft.aircraftInstanceId || '').trim());
    groupedByCatalogId.set(catalogId, group);
  });

  return Array.from(groupedByCatalogId.values())
    .map((group) => ({
      ...group,
      aircraftInstanceIds: group.aircraftInstanceIds
        .filter((aircraftInstanceId) => aircraftInstanceId.length > 0)
        .sort((leftAircraftInstanceId, rightAircraftInstanceId) => {
          return leftAircraftInstanceId.localeCompare(rightAircraftInstanceId);
        })
    }))
    .filter((group) => group.aircraftInstanceIds.length > 0)
    .sort((leftGroup, rightGroup) => {
      const leftDisplayName = getAircraftDisplayName(leftGroup.catalogEntry).toLocaleLowerCase();
      const rightDisplayName = getAircraftDisplayName(rightGroup.catalogEntry).toLocaleLowerCase();
      if (leftDisplayName !== rightDisplayName) {
        return leftDisplayName.localeCompare(rightDisplayName);
      }

      return leftGroup.catalogId.localeCompare(rightGroup.catalogId);
    });
}

function normalizeRouteAircraftQuantity(value, maxQuantity) {
  const normalizedMax = Number.isInteger(maxQuantity) && maxQuantity > 0 ? maxQuantity : 0;
  if (normalizedMax === 0) {
    return 0;
  }

  if (value == null) {
    return 1;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return 1;
    }

    const parsedValue = Number(trimmedValue);
    if (!Number.isInteger(parsedValue)) {
      return 1;
    }

    value = parsedValue;
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

function getRouteAircraftQuantityMapsForMode(mode) {
  const isUnassignMode = mode === 'unassign';

  if (isUnassignMode) {
    return {
      quantityByCatalogId: routeAircraftUnassignQuantityByCatalogId,
      quantityInputByCatalogId: routeAircraftUnassignQuantityInputByCatalogId,
      maxByCatalogId: routeAircraftUnassignMaxByCatalogId
    };
  }

  return {
    quantityByCatalogId: routeAircraftAssignQuantityByCatalogId,
    quantityInputByCatalogId: routeAircraftAssignQuantityInputByCatalogId,
    maxByCatalogId: routeAircraftAssignMaxByCatalogId
  };
}

function resolveRouteAircraftQuantityForRender({ mode, catalogId, maxQuantity }) {
  const normalizedCatalogId = String(catalogId || '').trim();
  const normalizedMaxQuantity = Number.isInteger(maxQuantity) && maxQuantity > 0 ? maxQuantity : 0;

  if (!normalizedCatalogId) {
    return {
      displayValue: normalizedMaxQuantity > 0 ? '1' : '0',
      normalizedQuantity: normalizedMaxQuantity > 0 ? 1 : 0
    };
  }

  const {
    quantityByCatalogId,
    quantityInputByCatalogId,
    maxByCatalogId
  } = getRouteAircraftQuantityMapsForMode(mode);

  const previousMaxQuantity = maxByCatalogId.get(normalizedCatalogId);
  const hasMaxDecreased = Number.isInteger(previousMaxQuantity) && normalizedMaxQuantity < previousMaxQuantity;
  maxByCatalogId.set(normalizedCatalogId, normalizedMaxQuantity);

  if (normalizedMaxQuantity < 1) {
    quantityByCatalogId.set(normalizedCatalogId, 0);
    quantityInputByCatalogId.set(normalizedCatalogId, '0');

    return {
      displayValue: '0',
      normalizedQuantity: 0
    };
  }

  let committedQuantity = normalizeRouteAircraftQuantity(
    quantityByCatalogId.get(normalizedCatalogId),
    normalizedMaxQuantity
  );
  quantityByCatalogId.set(normalizedCatalogId, committedQuantity);

  const rawInputValue = quantityInputByCatalogId.get(normalizedCatalogId);
  if (rawInputValue == null) {
    const initializedInputValue = String(committedQuantity);
    quantityInputByCatalogId.set(normalizedCatalogId, initializedInputValue);

    return {
      displayValue: initializedInputValue,
      normalizedQuantity: committedQuantity
    };
  }

  if (rawInputValue === '') {
    if (hasMaxDecreased && committedQuantity > normalizedMaxQuantity) {
      committedQuantity = normalizeRouteAircraftQuantity(committedQuantity, normalizedMaxQuantity);
      quantityByCatalogId.set(normalizedCatalogId, committedQuantity);
    }

    return {
      displayValue: '',
      normalizedQuantity: committedQuantity
    };
  }

  const parsedRawInputValue = Number(rawInputValue);
  const hasValidIntegerInput = Number.isFinite(parsedRawInputValue) && Number.isInteger(parsedRawInputValue);
  const hasValidPositiveInput = hasValidIntegerInput && parsedRawInputValue >= 1;

  if (!hasValidPositiveInput) {
    return {
      displayValue: String(rawInputValue),
      normalizedQuantity: committedQuantity
    };
  }

  if (hasMaxDecreased && parsedRawInputValue > normalizedMaxQuantity) {
    const clampedQuantity = normalizeRouteAircraftQuantity(parsedRawInputValue, normalizedMaxQuantity);
    quantityByCatalogId.set(normalizedCatalogId, clampedQuantity);
    quantityInputByCatalogId.set(normalizedCatalogId, String(clampedQuantity));

    return {
      displayValue: String(clampedQuantity),
      normalizedQuantity: clampedQuantity
    };
  }

  quantityByCatalogId.set(normalizedCatalogId, parsedRawInputValue);

  return {
    displayValue: String(rawInputValue),
    normalizedQuantity: parsedRawInputValue
  };
}

function commitRouteAircraftQuantityInput({ mode, catalogId, maxQuantity, rawInputValue }) {
  const normalizedCatalogId = String(catalogId || '').trim();
  const normalizedMaxQuantity = Number.isInteger(maxQuantity) && maxQuantity > 0 ? maxQuantity : 0;

  if (!normalizedCatalogId || normalizedMaxQuantity < 1) {
    return 0;
  }

  const {
    quantityByCatalogId,
    quantityInputByCatalogId,
    maxByCatalogId
  } = getRouteAircraftQuantityMapsForMode(mode);
  const normalizedQuantity = normalizeRouteAircraftQuantity(rawInputValue, normalizedMaxQuantity);

  quantityByCatalogId.set(normalizedCatalogId, normalizedQuantity);
  quantityInputByCatalogId.set(normalizedCatalogId, String(normalizedQuantity));
  maxByCatalogId.set(normalizedCatalogId, normalizedMaxQuantity);

  return normalizedQuantity;
}

function getRouteAircraftGroupLookupByMode(mode) {
  return mode === 'unassign' ? routeAssignedAircraftGroupByCatalogId : routeAvailableAircraftGroupByCatalogId;
}

function getRouteAircraftRowLookupByMode(mode) {
  return mode === 'unassign' ? routeAssignedAircraftRowByCatalogId : routeAvailableAircraftRowByCatalogId;
}

function bindQuantityInputShortcuts({ inputEl, maxButtonEl, actionButtonEl, getMaxValue, onMaxClick, isMaxAllowed }) {
  maxButtonEl.addEventListener('click', () => {
    const maxValue = getMaxValue();
    if (!Number.isFinite(maxValue) || maxValue < 1) {
      return;
    }
    const isAllowed = typeof isMaxAllowed === 'function'
      ? isMaxAllowed()
      : (actionButtonEl && !actionButtonEl.disabled);
    if (!isAllowed) {
      return;
    }
    onMaxClick(maxValue);
    inputEl.value = String(maxValue);
    inputEl.focus();
  });

  inputEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (actionButtonEl && !actionButtonEl.disabled) {
      actionButtonEl.click();
    }
  });
}

function createRouteAircraftGroupRow(mode, catalogId) {
  const groupCardEl = document.createElement('div');
  groupCardEl.className = 'routes-aircraft-group-card';
  groupCardEl.dataset.catalogId = catalogId;
  groupCardEl.dataset.mode = mode;

  const groupMainEl = document.createElement('div');
  groupMainEl.className = 'routes-aircraft-group-main';

  const groupTitleEl = document.createElement('p');
  groupTitleEl.className = 'routes-aircraft-group-title';

  const groupMetaPrimaryEl = document.createElement('p');
  groupMetaPrimaryEl.className = 'routes-aircraft-group-meta';

  const groupMetaSecondaryEl = document.createElement('p');
  groupMetaSecondaryEl.className = 'routes-aircraft-group-meta';

  groupMainEl.appendChild(groupTitleEl);
  groupMainEl.appendChild(groupMetaPrimaryEl);
  groupMainEl.appendChild(groupMetaSecondaryEl);

  const groupActionsEl = document.createElement('div');
  groupActionsEl.className = 'routes-aircraft-group-actions';

  const actionButtonEl = document.createElement('button');
  actionButtonEl.type = 'button';
  actionButtonEl.className = mode === 'unassign'
    ? 'airport-interaction-action-button airport-square-action-button shop-aircraft-warning-button'
    : 'airport-interaction-action-button airport-square-action-button routes-aircraft-assign-button';

  const quantityControlEl = document.createElement('div');
  quantityControlEl.className = 'aircraft-quantity-control routes-aircraft-quantity-control';

  const quantityInputEl = document.createElement('input');
  quantityInputEl.type = 'number';
  quantityInputEl.className = 'aircraft-quantity-input routes-aircraft-quantity-input';
  quantityInputEl.step = '1';

  const quantityMaxButtonEl = document.createElement('button');
  quantityMaxButtonEl.type = 'button';
  quantityMaxButtonEl.className = 'aircraft-quantity-max-label routes-aircraft-quantity-max-label';

  quantityInputEl.addEventListener('input', () => {
    const catalogIdFromRow = String(groupCardEl.dataset.catalogId || '').trim();
    if (!catalogIdFromRow) {
      return;
    }

    if (mode === 'unassign') {
      routeAircraftUnassignQuantityInputByCatalogId.set(catalogIdFromRow, quantityInputEl.value);
      return;
    }

    routeAircraftAssignQuantityInputByCatalogId.set(catalogIdFromRow, quantityInputEl.value);
  });

  quantityInputEl.addEventListener('change', () => {
    const catalogIdFromRow = String(groupCardEl.dataset.catalogId || '').trim();
    const groupLookup = getRouteAircraftGroupLookupByMode(mode);
    const currentGroup = groupLookup.get(catalogIdFromRow);
    const maxQuantity = currentGroup && Array.isArray(currentGroup.aircraftInstanceIds)
      ? currentGroup.aircraftInstanceIds.length
      : 0;

    commitRouteAircraftQuantityInput({
      mode,
      catalogId: catalogIdFromRow,
      maxQuantity,
      rawInputValue: quantityInputEl.value
    });
    refreshRoutesModal(gameState.getState());
  });

  bindQuantityInputShortcuts({
    inputEl: quantityInputEl,
    maxButtonEl: quantityMaxButtonEl,
    actionButtonEl,
    getMaxValue: () => {
      const catalogIdFromRow = String(groupCardEl.dataset.catalogId || '').trim();
      const groupLookup = getRouteAircraftGroupLookupByMode(mode);
      const currentGroup = groupLookup.get(catalogIdFromRow);
      return currentGroup && Array.isArray(currentGroup.aircraftInstanceIds)
        ? currentGroup.aircraftInstanceIds.length
        : 0;
    },
    onMaxClick: (maxValue) => {
      const catalogIdFromRow = String(groupCardEl.dataset.catalogId || '').trim();
      commitRouteAircraftQuantityInput({
        mode,
        catalogId: catalogIdFromRow,
        maxQuantity: maxValue,
        rawInputValue: maxValue
      });
      refreshRoutesModal(gameState.getState());
    }
  });

  actionButtonEl.addEventListener('click', () => {
    const catalogIdFromRow = String(groupCardEl.dataset.catalogId || '').trim();
    const selectedRouteId = String(selectedRouteAircraftManagementRouteId || '').trim();
    const state = gameState.getState();
    const isInActiveGame = Boolean(state && state.ui && state.ui.screen === 'game' && state && state.game && state.game.id);
    const groupLookup = getRouteAircraftGroupLookupByMode(mode);
    const currentGroup = groupLookup.get(catalogIdFromRow);
    const aircraftInstanceIds = currentGroup && Array.isArray(currentGroup.aircraftInstanceIds)
      ? currentGroup.aircraftInstanceIds
      : [];
    const maxQuantity = aircraftInstanceIds.length;
    const hasPendingAircraftMutation =
      pendingRouteAircraftAssignAircraftInstanceId != null || pendingRouteAircraftUnassignAircraftInstanceId != null;
    const isBulkAssignInProgress = routeAircraftBulkOperation && routeAircraftBulkOperation.mode === 'assign';
    const isBulkUnassignInProgress = routeAircraftBulkOperation && routeAircraftBulkOperation.mode === 'unassign';

    if (
      !selectedRouteId ||
      maxQuantity < 1 ||
      !currentGroup ||
      !Array.isArray(currentGroup.aircraftInstanceIds) ||
      hasPendingAircraftMutation ||
      !isInActiveGame
    ) {
      return;
    }

    if ((mode === 'assign' && isBulkUnassignInProgress) || (mode === 'unassign' && isBulkAssignInProgress)) {
      return;
    }

    const rawInputValue = mode === 'unassign'
      ? routeAircraftUnassignQuantityInputByCatalogId.get(catalogIdFromRow)
      : routeAircraftAssignQuantityInputByCatalogId.get(catalogIdFromRow);
    const committedQuantity = commitRouteAircraftQuantityInput({
      mode,
      catalogId: catalogIdFromRow,
      maxQuantity,
      rawInputValue
    });
    let aircraftInstanceIdsToMutate = currentGroup.aircraftInstanceIds.slice(0, committedQuantity);
    if (mode === 'assign') {
      const latestRoutes = Array.isArray(state && state.game && state.game.routes)
        ? state.game.routes
        : [];
      const latestRoute = latestRoutes.find((route) => {
        return route && String(route.routeId || '') === selectedRouteId;
      }) || null;
      const maxAircraftCapacity = resolveRouteMaxAircraftCapacity(state, latestRoute);

      if (maxAircraftCapacity != null && latestRoute) {
        const assignedAircraftCount = Array.isArray(latestRoute.assignedAircraftInstanceIds)
          ? latestRoute.assignedAircraftInstanceIds.length
          : 0;
        const remainingCapacity = Math.max(0, maxAircraftCapacity - assignedAircraftCount);
        if (remainingCapacity === 0) {
          return;
        }

        aircraftInstanceIdsToMutate = aircraftInstanceIdsToMutate.slice(0, remainingCapacity);
      }
    }

    if (!aircraftInstanceIdsToMutate.length) {
      refreshRoutesModal(gameState.getState());
      return;
    }

    startRouteAircraftBulkOperation({
      mode,
      routeId: selectedRouteId,
      aircraftInstanceIds: aircraftInstanceIdsToMutate
    });
  });

  quantityControlEl.appendChild(quantityInputEl);
  quantityControlEl.appendChild(quantityMaxButtonEl);
  groupActionsEl.appendChild(actionButtonEl);
  groupActionsEl.appendChild(quantityControlEl);

  groupCardEl.appendChild(groupMainEl);
  groupCardEl.appendChild(groupActionsEl);

  return {
    groupCardEl,
    groupTitleEl,
    groupMetaPrimaryEl,
    groupMetaSecondaryEl,
    actionButtonEl,
    quantityInputEl,
    quantityMaxButtonEl
  };
}

function syncRouteAircraftGroupRows({
  mode,
  groups,
  listEl,
  emptyMessage,
  isInActiveGame,
  modelEditLockedUntilRealMs,
  assignedAircraftCountByCatalogId,
  maxAircraftCapacity,
  isRouteAtAircraftCapacity = false
}) {
  const rowLookup = getRouteAircraftRowLookupByMode(mode);
  const currentCatalogIds = new Set();
  const isBulkAssignInProgress = routeAircraftBulkOperation && routeAircraftBulkOperation.mode === 'assign';
  const isBulkUnassignInProgress = routeAircraftBulkOperation && routeAircraftBulkOperation.mode === 'unassign';
  const hasPendingAircraftMutation =
    pendingRouteAircraftAssignAircraftInstanceId != null || pendingRouteAircraftUnassignAircraftInstanceId != null;

  groups.forEach((group, groupIndex) => {
    const catalogId = String(group && group.catalogId ? group.catalogId : '').trim();
    if (!catalogId) {
      return;
    }

    currentCatalogIds.add(catalogId);

    let row = rowLookup.get(catalogId);
    if (!row) {
      row = createRouteAircraftGroupRow(mode, catalogId);
      rowLookup.set(catalogId, row);
    }

    const expectedRowAtIndex = listEl.children[groupIndex] || null;
    if (expectedRowAtIndex !== row.groupCardEl) {
      listEl.insertBefore(row.groupCardEl, expectedRowAtIndex);
    }

    const maxQuantity = Array.isArray(group.aircraftInstanceIds) ? group.aircraftInstanceIds.length : 0;
    const {
      displayValue: quantityDisplayValue,
      normalizedQuantity
    } = resolveRouteAircraftQuantityForRender({
      mode,
      catalogId,
      maxQuantity
    });

    row.groupTitleEl.textContent = getAircraftDisplayName(group.catalogEntry);

    if (mode === 'assign') {
      row.groupMetaPrimaryEl.textContent = `Available: ${INTEGER_FORMATTER.format(maxQuantity)}`;
      row.groupMetaPrimaryEl.classList.remove('hidden');
      row.groupMetaSecondaryEl.textContent = '';
      row.groupMetaSecondaryEl.classList.add('hidden');
    } else {
      const assignedAircraftCount = assignedAircraftCountByCatalogId instanceof Map
        ? assignedAircraftCountByCatalogId.get(catalogId)
        : maxQuantity;
      const displayAssignedAircraftCount = Number.isFinite(assignedAircraftCount)
        ? assignedAircraftCount
        : maxQuantity;
      row.groupMetaPrimaryEl.textContent =
        `Assigned: ${INTEGER_FORMATTER.format(displayAssignedAircraftCount)}/${maxAircraftCapacity == null ? '—' : INTEGER_FORMATTER.format(maxAircraftCapacity)}`;
      row.groupMetaPrimaryEl.classList.remove('hidden');
      row.groupMetaSecondaryEl.textContent = '';
      row.groupMetaSecondaryEl.classList.add('hidden');
    }

    row.quantityInputEl.min = maxQuantity >= 1 ? '1' : '0';
    row.quantityInputEl.max = String(Math.max(0, maxQuantity));

    const desiredInputValue = maxQuantity >= 1 ? quantityDisplayValue : '0';
    if (row.quantityInputEl.value !== desiredInputValue) {
      row.quantityInputEl.value = desiredInputValue;
    }

    row.quantityMaxButtonEl.textContent = `Max ${INTEGER_FORMATTER.format(maxQuantity)}`;

    const aircraftInstanceIdsToMutate = Array.isArray(group.aircraftInstanceIds)
      ? group.aircraftInstanceIds.slice(0, normalizedQuantity)
      : [];
    const aircraftInstanceIdToMutate = aircraftInstanceIdsToMutate[0] || null;
    const isPendingForGroup = mode === 'assign'
      ? isBulkAssignInProgress && Boolean(aircraftInstanceIdToMutate)
      : isBulkUnassignInProgress && Boolean(aircraftInstanceIdToMutate);

    const lockedUntil = Number(modelEditLockedUntilRealMs?.[catalogId]);
    const isModelEditLocked = Number.isFinite(lockedUntil) && Date.now() < lockedUntil;

    row.actionButtonEl.textContent = mode === 'assign' ? '+' : '−';
    row.actionButtonEl.setAttribute('aria-label', mode === 'assign' ? 'Assign aircraft' : 'Unassign aircraft');
    row.actionButtonEl.title = mode === 'assign' ? 'Assign aircraft' : 'Unassign aircraft';
    row.actionButtonEl.disabled =
      !isInActiveGame ||
      hasPendingAircraftMutation ||
      !aircraftInstanceIdsToMutate.length ||
      (mode === 'assign' ? isBulkUnassignInProgress : isBulkAssignInProgress) ||
      isModelEditLocked ||
      (mode === 'assign' && isRouteAtAircraftCapacity);
    row.quantityInputEl.disabled =
      !isInActiveGame ||
      hasPendingAircraftMutation ||
      maxQuantity < 1 ||
      isModelEditLocked ||
      (mode === 'assign' && isRouteAtAircraftCapacity);
    row.quantityMaxButtonEl.disabled =
      !isInActiveGame ||
      hasPendingAircraftMutation ||
      maxQuantity < 1 ||
      isModelEditLocked ||
      (mode === 'assign' && isRouteAtAircraftCapacity);
  });

  Array.from(rowLookup.keys()).forEach((catalogId) => {
    if (currentCatalogIds.has(catalogId)) {
      return;
    }

    const row = rowLookup.get(catalogId);
    if (row && row.groupCardEl.parentElement) {
      row.groupCardEl.parentElement.removeChild(row.groupCardEl);
    }

    rowLookup.delete(catalogId);
  });

  const emptyStateEl = listEl.querySelector('.routes-aircraft-empty');
  if (!groups.length) {
    if (!emptyStateEl) {
      const emptyEl = document.createElement('p');
      emptyEl.className = 'shop-airport-results-empty routes-aircraft-empty';
      emptyEl.textContent = emptyMessage;
      listEl.appendChild(emptyEl);
    }
    return;
  }

  if (emptyStateEl) {
    emptyStateEl.remove();
  }
}


function startRouteAircraftBulkOperation({ mode, routeId, aircraftInstanceIds }) {
  const normalizedMode = mode === 'unassign' ? 'unassign' : 'assign';
  const normalizedRouteId = String(routeId || '').trim();
  const queueAircraftInstanceIds = (Array.isArray(aircraftInstanceIds) ? aircraftInstanceIds : [])
    .map((aircraftInstanceId) => String(aircraftInstanceId || '').trim())
    .filter((aircraftInstanceId) => aircraftInstanceId.length > 0);

  if (!queueAircraftInstanceIds.length) {
    routeAircraftManagementFeedbackKind = 'error';
    routeAircraftManagementErrorMessage = normalizedMode === 'unassign'
      ? 'No assigned aircraft are available to unassign.'
      : 'No available aircraft are ready to assign.';
    refreshRoutesModal(gameState.getState());
    return;
  }

  const latestState = gameState.getState();
  const latestGame = latestState && latestState.game;
  const latestRoutes = Array.isArray(latestGame && latestGame.routes) ? latestGame.routes : [];
  const latestRoute = latestRoutes.find((route) => {
    return route && String(route.routeId || '').trim() === normalizedRouteId;
  });
  const latestOwnedAircraft = Array.isArray(latestGame && latestGame.ownedAircraft)
    ? latestGame.ownedAircraft
    : [];
  const selectedAircraftCatalogIds = new Set(
    queueAircraftInstanceIds
      .map((aircraftInstanceId) => {
        const aircraft = latestOwnedAircraft.find((candidate) => {
          return candidate && String(candidate.aircraftInstanceId || '').trim() === aircraftInstanceId;
        });
        return String(aircraft && aircraft.aircraftCatalogId || '').trim();
      })
      .filter((catalogId) => catalogId.length > 0)
  );

  if (latestRoute && selectedAircraftCatalogIds.size === 1) {
    const [catalogId] = selectedAircraftCatalogIds;
    const modelEditLockedUntilRealMs = getRouteAircraftModelEditLocks(latestRoute);
    const lockedUntil = Number(modelEditLockedUntilRealMs[catalogId]);
    if (Number.isFinite(lockedUntil) && Date.now() < lockedUntil) {
      routeAircraftManagementErrorMessage = '';
      refreshRoutesModal(latestState);
      return;
    }
  }

  routeAircraftBulkOperation = {
    mode: normalizedMode
  };

  routeAircraftManagementFeedbackKind = 'error';
  routeAircraftManagementErrorMessage = '';

  if (normalizedMode === 'assign') {
    pendingRouteAircraftUnassignAircraftInstanceId = null;
    pendingRouteAircraftAssignAircraftInstanceId = '__BULK__';
    emitRouteAircraftAssignBulkRequest(normalizedRouteId, queueAircraftInstanceIds);
    refreshRoutesModal(gameState.getState());
    return;
  }

  pendingRouteAircraftAssignAircraftInstanceId = null;
  pendingRouteAircraftUnassignAircraftInstanceId = '__BULK__';
  emitRouteAircraftUnassignBulkRequest(normalizedRouteId, queueAircraftInstanceIds);
  refreshRoutesModal(gameState.getState());
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
  const searchTokens = normalizeAirportSearchText(rawSearchValue)
    .split(/\s+/)
    .filter(Boolean);
  const airports = getAuthoritativeAirports(state).slice().sort(compareAirportsAlphabetically);
  if (searchTokens.length === 0) {
    return airports;
  }

  return airports.filter((airport) => {
    const searchDocument = normalizeAirportSearchText(getAirportSearchDocument(airport));
    return searchTokens.every((token) => searchDocument.includes(token));
  });
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

  const isInActiveGame = Boolean(state && state.ui && state.ui.screen === 'game' && state && state.game && state.game.id);
  const ownerPlayerId = airport.ownerPlayerId;
  const hasOwner = ownerPlayerId != null;
  const isOwnedByLocalPlayer = isAirportOwnedByLocalPlayer(state, airport);
  const hasListing = !!(airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice));
  const isOwnershipChangePending = airport.isOwnershipChangePending === true;
  const airportId = String(airport.id || airport.iata);

  const localPlayerId = state && state.session ? state.session.playerId : null;
  const localPlayer = getAuthoritativePlayerById(state, localPlayerId);
  const capital = Number.isFinite(localPlayer && localPlayer.capital) ? localPlayer.capital : null;

  if (!hasOwner) {
    const purchasePrice = Number.isFinite(airport.basePrice) ? airport.basePrice : null;
    const cannotAfford = capital !== null && purchasePrice !== null && capital < purchasePrice;
    const isBuyDisabled = !isInActiveGame || isOwnershipChangePending || cannotAfford;
    actionsEl.appendChild(
      createAirportActionButton('Buy', () => emitAirportPurchaseUnownedRequest(airportId), { variant: 'buy', isDisabled: isBuyDisabled })
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

    actionsEl.appendChild(
      createRoutesShortcutIconButton({
        ariaLabel: 'Open Routes',
        isDisabled: !isInActiveGame || isOwnershipChangePending,
        onClick: () => {
          if (!isInActiveGame || isOwnershipChangePending) {
            return;
          }

          openRouteContextForAirport(airportId);
        }
      })
    );

    return;
  }

  if (hasListing) {
    const purchasePrice = airport.saleListing.askingPrice;
    const cannotAfford = capital !== null && Number.isFinite(purchasePrice) && capital < purchasePrice;
    const isBuyDisabled = !isInActiveGame || isOwnershipChangePending || cannotAfford;
    actionsEl.appendChild(
      createAirportActionButton('Buy', () => emitAirportPurchaseListedRequest(airportId), { variant: 'buy', isDisabled: isBuyDisabled })
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

function renderAirportInteractionCapacity(state, airport, capacityLimitsValueEl, routesValueEl, assignedAircraftValueEl) {
  const airportOwnerId = airport && airport.ownerPlayerId != null ? String(airport.ownerPlayerId) : null;
  const capacity = airport && airport.capacity && typeof airport.capacity === 'object' ? airport.capacity : null;
  const maxRoutes = capacity && Number.isFinite(capacity.maxRoutes) ? capacity.maxRoutes : null;
  const maxAircraftPerRoute = capacity && Number.isFinite(capacity.maxAircraftPerRoute) ? capacity.maxAircraftPerRoute : null;
  const airportId = airport ? String(airport.id || airport.iata || '') : '';
  const isCapacityAvailable = maxRoutes != null && maxAircraftPerRoute != null && airportId !== '';

  if (!capacityLimitsValueEl && !routesValueEl && !assignedAircraftValueEl) {
    return;
  }

  if (!isCapacityAvailable) {
    if (capacityLimitsValueEl) {
      capacityLimitsValueEl.textContent = '—';
    }
    if (routesValueEl) {
      routesValueEl.textContent = '—';
    }
    if (assignedAircraftValueEl) {
      assignedAircraftValueEl.textContent = '—';
    }
    return;
  }

  const routes = Array.isArray(state && state.game && state.game.routes) ? state.game.routes : [];
  const airportRoutes = airportOwnerId == null
    ? []
    : routes.filter((route) => {
        if (!route || String(route.ownerPlayerId) !== airportOwnerId) {
          return false;
        }

        return String(route.originAirportId) === airportId || String(route.destinationAirportId) === airportId;
      });

  let assignedAircraftCount = 0;
  for (const route of airportRoutes) {
    if (Array.isArray(route.assignedAircraftInstanceIds)) {
      assignedAircraftCount += route.assignedAircraftInstanceIds.length;
    }
  }

  if (capacityLimitsValueEl) {
    capacityLimitsValueEl.textContent = String(maxAircraftPerRoute);
  }
  if (routesValueEl) {
    routesValueEl.textContent = airportRoutes.length > 0 ? `${maxRoutes} (${airportRoutes.length})` : String(maxRoutes);
  }
  if (assignedAircraftValueEl) {
    assignedAircraftValueEl.textContent = `${assignedAircraftCount}/${maxRoutes * maxAircraftPerRoute}`;
  }
}

function resolveAirportOwnerText(state, airport) {
  const ownerPlayerId = airport.ownerPlayerId;
  if (ownerPlayerId == null) {
    return 'Unowned';
  }

  const ownerPlayer = getAuthoritativePlayerById(state, ownerPlayerId);
  const localPlayerId = state && state.session ? state.session.playerId : null;
  if (localPlayerId != null && String(ownerPlayerId) === String(localPlayerId)) {
    return ownerPlayer && ownerPlayer.username ? `${ownerPlayer.username} (You)` : 'You';
  }

  if (!ownerPlayer || !ownerPlayer.username) {
    return 'Unknown';
  }

  return ownerPlayer.isBot ? `[Bot] ${ownerPlayer.username}` : ownerPlayer.username;
}

function applyAirportOwnerTextColor(state, airport, ownerValueEl) {
  ownerValueEl.style.removeProperty('color');
  if (!airport || airport.ownerPlayerId == null) {
    return;
  }

  const ownerPlayer = getAuthoritativePlayerById(state, airport.ownerPlayerId);
  const ownerColorHex = ownerPlayer && typeof ownerPlayer.colorHex === 'string'
    ? ownerPlayer.colorHex.trim()
    : '';
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(ownerColorHex)) {
    ownerValueEl.style.color = ownerColorHex;
  }
}

function renderAirportInteractionContent({ titleEl, ownerValueEl, priceLabelEl, priceValueEl, capacityLimitsValueEl, routesValueEl, assignedAircraftValueEl, actionsEl, messageEl }, state, airport) {
  const airportCode = airport.iata || airport.id || selectedAirportId;
  const airportName = airport.name || 'Unknown Airport';
  titleEl.textContent = '';
  const airportNameEl = document.createElement('span');
  airportNameEl.className = 'airport-interaction-title-name';
  airportNameEl.textContent = `${airportName} (${airportCode})`;
  titleEl.appendChild(airportNameEl);
  const tierBadgeEl =
    window.airportTiers && typeof window.airportTiers.createAirportTierBadge === 'function'
      ? window.airportTiers.createAirportTierBadge(document, airport.economicClass)
      : null;
  if (tierBadgeEl) {
    titleEl.appendChild(tierBadgeEl);
  }
  ownerValueEl.textContent = resolveAirportOwnerText(state, airport);
  applyAirportOwnerTextColor(state, airport, ownerValueEl);
  renderAirportInteractionPrice(state, airport, priceLabelEl, priceValueEl);
  renderAirportInteractionCapacity(state, airport, capacityLimitsValueEl, routesValueEl, assignedAircraftValueEl);
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
  const isPurchaseInputFocused = document.activeElement === shopAircraftQuantityInputEl;
  const purchaseQuantityForDisplay =
    isPurchaseInputFocused || isAircraftPurchaseQuantityEditing
      ? normalizeAircraftPurchaseQuantity(shopAircraftQuantityInputEl.value)
      : normalizedQuantity;
  const enteredQuantity = Number.isInteger(purchaseQuantityForDisplay) ? purchaseQuantityForDisplay : 0;
  const unitPrice = Number.isFinite(selectedAircraft.purchasePrice) ? selectedAircraft.purchasePrice : 0;
  const buyTotal = unitPrice * enteredQuantity;
  shopAircraftBuyTotalValueEl.textContent = formatCurrencyValue(buyTotal);
  const canAffordQuantity = enteredQuantity >= 1 && enteredQuantity <= aircraftMaxPurchasable;
  const exceedsMaxPurchasable = enteredQuantity > aircraftMaxPurchasable;
  const isBuyDisabled = isAircraftPurchasePending || !canAffordQuantity;
  shopAircraftBuyTotalValueEl.classList.toggle('aircraft-order-total-unaffordable', exceedsMaxPurchasable);

  if (!isPurchaseInputFocused && !isAircraftPurchaseQuantityEditing) {
    shopAircraftQuantityInputEl.value = normalizedQuantity == null ? '' : String(normalizedQuantity);
  }
  shopAircraftQuantityInputEl.disabled = isAircraftPurchasePending;
  shopAircraftMaxLabelEl.textContent = `Max ${INTEGER_FORMATTER.format(aircraftMaxPurchasable)}`;
  shopAircraftMaxLabelEl.disabled = isAircraftPurchasePending || aircraftMaxPurchasable < 1;

  shopAircraftBuyButtonEl.disabled = isBuyDisabled;
  shopAircraftBuyButtonEl.textContent = 'Buy';

  const normalizedSellQuantity = normalizeAircraftSellQuantity(aircraftSellQuantity, aircraftMaxSellable);
  const isSellInputFocused = document.activeElement === shopAircraftSellQuantityInputEl;
  const parsedSellInputValue = parseIntegerInputValue(shopAircraftSellQuantityInputEl.value);
  const effectiveSellQuantity =
    isSellInputFocused || isAircraftSellQuantityEditing
      ? (parsedSellInputValue == null ? 0 : parsedSellInputValue)
      : normalizedSellQuantity;
  const sellTotal = aircraftUnitSellPrice * effectiveSellQuantity;
  const canSellQuantity = effectiveSellQuantity >= 1 && effectiveSellQuantity <= aircraftMaxSellable;

  shopAircraftSellTotalValueEl.textContent = formatCurrencyValue(sellTotal);
  if (!isSellInputFocused && !isAircraftSellQuantityEditing) {
    shopAircraftSellQuantityInputEl.value = String(normalizedSellQuantity);
  }
  shopAircraftSellQuantityInputEl.disabled = isAircraftSellPending;
  shopAircraftSellButtonEl.disabled =
    isAircraftSellPending || !canSellQuantity;
  shopAircraftSellButtonEl.textContent = 'Sell';
  shopAircraftOwnedLabelEl.textContent = `Owned ${INTEGER_FORMATTER.format(aircraftOwnedQuantity)}`;
  shopAircraftOwnedLabelEl.disabled =
    isAircraftSellPending || aircraftMaxSellable < 1;

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
    capacityLimitsValueEl: shopAirportCapacityLimitsValueEl,
    routesValueEl: shopAirportRoutesValueEl,
    assignedAircraftValueEl: shopAirportAssignedAircraftValueEl,
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
  closeAirportSearchResults({ clearQuery: true });
  openShopModal({ openedFrom: SHOP_MODAL_OPENED_FROM.AIRPORT_MARKER });
}

renderer.setAirportSelectHandler(openShopFromAirportMarker);
renderer.setAircraftSelectHandler(openShopFromHud);

if (typeof renderer.setCountryHoverChangeHandler === 'function') {
  renderer.setCountryHoverChangeHandler((countryName) => {
    simulationClockCountryEl.textContent = String(countryName || '').trim();
  });
}

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

routesHudButtonEl.addEventListener('click', () => {
  if (RoutesModalState.isOpen) {
    closeRoutesModal();
    return;
  }

  if (ShopModalState.isOpen) {
    closeShopModal();
  }

  openRoutesModal({ openedFrom: ROUTES_MODAL_OPENED_FROM.HUD });
});

shopHudButtonEl.addEventListener('click', () => {
  if (ShopModalState.isOpen) {
    closeShopModal();
    return;
  }

  if (RoutesModalState.isOpen) {
    closeRoutesModal();
  }

  openShopFromHud();
});

financesHudButtonEl.addEventListener('click', () => {
  toggleFinancesModal();
});

financesModalCloseButtonEl.addEventListener('click', () => {
  closeFinancesModal();
});

financesCashToggleEl.addEventListener('click', () => {
  FinancesModalState.showCash = !FinancesModalState.showCash;
  refreshFinancesModal(gameState.getState());
});

financesNetWorthToggleEl.addEventListener('click', () => {
  FinancesModalState.showNetWorth = !FinancesModalState.showNetWorth;
  refreshFinancesModal(gameState.getState());
});

routesModalCloseButtonEl.addEventListener('click', () => {
  closeRoutesModal();
});

routesOpenCreateModalButtonEl.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  openCreateRouteModal();
});

routesOriginSearchInputEl.addEventListener('focus', () => {
  isRouteOriginDropdownOpen = true;
  refreshRoutesModal(gameState.getState());
});

routesOriginSearchInputEl.addEventListener('input', () => {
  routeOriginSearchQuery = routesOriginSearchInputEl.value;
  if (selectedRouteOriginAirportId) {
    selectedRouteOriginAirportId = null;
  }

  routeCreateErrorMessage = '';
  isRouteOriginDropdownOpen = true;
  refreshRoutesModal(gameState.getState());
});

routesDestinationSearchInputEl.addEventListener('focus', () => {
  isRouteDestinationDropdownOpen = true;
  refreshRoutesModal(gameState.getState());
});

routesDestinationSearchInputEl.addEventListener('input', () => {
  routeDestinationSearchQuery = routesDestinationSearchInputEl.value;
  if (selectedRouteDestinationAirportId) {
    selectedRouteDestinationAirportId = null;
  }

  routeCreateErrorMessage = '';
  isRouteDestinationDropdownOpen = true;
  refreshRoutesModal(gameState.getState());
});

routesCreateButtonEl.addEventListener('click', () => {
  if (isRouteCreatePending) {
    return;
  }

  const state = gameState.getState();
  const isInActiveGame =
    state &&
    state.ui &&
    state.ui.screen === 'game' &&
    state.game &&
    state.game.status === 'active';

  const canCreateRoute = isRouteCreateEligible({
    isInActiveGame,
    originAirportId: selectedRouteOriginAirportId,
    destinationAirportId: selectedRouteDestinationAirportId,
    isPending: isRouteCreatePending
  });

  if (!canCreateRoute) {
    refreshRoutesModal(state);
    return;
  }

  isRouteCreatePending = true;
  routeCreateErrorMessage = '';
  refreshRoutesModal(state);
  emitRouteCreateRequest(selectedRouteOriginAirportId, selectedRouteDestinationAirportId);
});

routesModalOverlayEl.addEventListener('click', (event) => {
  if (event.target !== routesModalOverlayEl) {
    return;
  }

  closeRoutesModal();
});

createRouteModalCloseButtonEl.addEventListener('click', () => {
  closeCreateRouteModal();
});

createRouteModalOverlayEl.addEventListener('click', (event) => {
  if (event.target !== createRouteModalOverlayEl) {
    return;
  }

  const didClose = closeRouteAirportDropdowns();
  if (didClose) {
    event.stopPropagation();
    return;
  }

  event.stopPropagation();
  closeCreateRouteModal();
});

createRouteModalDialogEl.addEventListener('click', (event) => {
  const isInsideOriginSelector = routesOriginSelectorFieldEl.contains(event.target);
  const isInsideDestinationSelector = routesDestinationSelectorFieldEl.contains(event.target);

  if (!isInsideOriginSelector && !isInsideDestinationSelector) {
    const didClose = closeRouteAirportDropdowns();
    if (didClose) {
      event.stopPropagation();
      return;
    }
  }

  event.stopPropagation();
});

routeAircraftManagementModalCloseButtonEl.addEventListener('click', () => {
  closeRouteAircraftManagementModal();
});

routeAircraftManagementModalOverlayEl.addEventListener('click', (event) => {
  if (event.target !== routeAircraftManagementModalOverlayEl) {
    return;
  }

  event.stopPropagation();
  closeRouteAircraftManagementModal();
});

routeAircraftManagementModalDialogEl.addEventListener('click', (event) => {
  event.stopPropagation();
});

shopModalOverlayEl.addEventListener('click', (event) => {
  if (event.target !== shopModalOverlayEl) {
    return;
  }

  const isAnyShopSearchOpen = isAirportSearchResultsOpen || isAircraftSearchResultsOpen;
  if (isAnyShopSearchOpen) {
    if (isAirportSearchResultsOpen) {
      closeAirportSearchResults();
    }

    if (isAircraftSearchResultsOpen) {
      closeAircraftSearchResults();
    }

    refreshShopAirportInteractionPanel(gameState.getState());
    refreshShopAircraftInteractionPanel(gameState.getState());
    event.stopPropagation();
    return;
  }

  event.stopPropagation();
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

document.addEventListener('click', (event) => {
  const isAnyShopSearchOpen = isAirportSearchResultsOpen || isAircraftSearchResultsOpen;
  const isAnyRouteSearchOpen = isRouteOriginDropdownOpen || isRouteDestinationDropdownOpen;

  if (!isAnyShopSearchOpen && !isAnyRouteSearchOpen) {
    return;
  }

  let shouldRefreshRoutes = false;

  if (isAnyShopSearchOpen) {
    const isInsideAirportSearch = shopAirportSearchContainerEl.contains(event.target);
    const isInsideAircraftSearch = shopAircraftSearchContainerEl.contains(event.target);

    if (!isInsideAirportSearch && !isInsideAircraftSearch) {
      if (isAirportSearchResultsOpen) {
        closeAirportSearchResults();
      }

      if (isAircraftSearchResultsOpen) {
        closeAircraftSearchResults();
      }

      refreshShopAirportInteractionPanel(gameState.getState());
      refreshShopAircraftInteractionPanel(gameState.getState());
    }
  }

  if (isAnyRouteSearchOpen) {
    const isInsideOriginSelector = routesOriginSelectorFieldEl.contains(event.target);
    const isInsideDestinationSelector = routesDestinationSelectorFieldEl.contains(event.target);

    if (!isInsideOriginSelector && !isInsideDestinationSelector) {
      if (closeRouteAirportDropdowns()) {
        event.stopPropagation();
      }
    }
  }

  if (shouldRefreshRoutes) {
    refreshRoutesModal(gameState.getState());
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  if (!createRouteModalOverlayEl.classList.contains('hidden')) {
    event.preventDefault();
    closeCreateRouteModal();
    return;
  }

  if (!routeAircraftManagementModalOverlayEl.classList.contains('hidden')) {
    event.preventDefault();
    closeRouteAircraftManagementModal();
    return;
  }

  if (!routesModalOverlayEl.classList.contains('hidden')) {
    event.preventDefault();
    closeRoutesModal();
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

function normalizeLobbyPalette(sourcePalette, fallbackPalette = []) {
  const paletteEntries = Array.isArray(sourcePalette) ? sourcePalette : fallbackPalette;

  const palette = [];
  const seenColorIds = new Set();

  paletteEntries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const colorId = String(entry.colorId || '').trim();
    const colorHex = String(entry.colorHex || '').trim();
    if (!colorId || !colorHex || seenColorIds.has(colorId)) {
      return;
    }

    seenColorIds.add(colorId);
    palette.push({ colorId, colorHex });
  });

  return palette;
}

function normalizeLobbyPlayer(player) {
  if (!player || typeof player !== 'object') {
    return {
      id: null,
      displayName: 'Unknown player',
      connected: false,
      isBot: false,
      colorId: null,
      colorHex: null
    };
  }

  const colorId = typeof player.colorId === 'string' && player.colorId.trim().length > 0
    ? player.colorId.trim()
    : null;

  const colorHex = typeof player.colorHex === 'string' && player.colorHex.trim().length > 0
    ? player.colorHex.trim()
    : null;

  return {
    ...player,
    isBot: Boolean(player.isBot),
    colorId,
    colorHex
  };
}

function normalizeLobbySnapshot(payload, currentLobby = getEmptyLobbyState()) {
  const source = payload || {};
  const current = currentLobby && typeof currentLobby === 'object' ? currentLobby : getEmptyLobbyState();
  const normalizedPlayers = Array.isArray(source.players)
    ? source.players.map((player) => normalizeLobbyPlayer(player))
    : Array.isArray(current.players)
      ? current.players.map((player) => normalizeLobbyPlayer(player))
      : [];

  const normalizedPalette = normalizeLobbyPalette(source.palette, current.palette);
  const paletteColorIds = new Set(normalizedPalette.map((entry) => entry.colorId));

  let normalizedAvailableColorIds = [];
  if (Array.isArray(source.availableColorIds)) {
    normalizedAvailableColorIds = source.availableColorIds
      .map((colorId) => String(colorId || '').trim())
      .filter((colorId) => colorId.length > 0 && paletteColorIds.has(colorId));
  } else if (Array.isArray(current.availableColorIds)) {
    normalizedAvailableColorIds = current.availableColorIds
      .map((colorId) => String(colorId || '').trim())
      .filter((colorId) => colorId.length > 0 && paletteColorIds.has(colorId));
  }

  const computedPlayerCount = Number.isFinite(source.playerCount)
    ? source.playerCount
    : normalizedPlayers.length;

  return {
    lobbyId: source.lobbyId || current.lobbyId || null,
    status: source.status === 'countdown' ? 'countdown' : 'waiting',
    playerCount: computedPlayerCount,
    maxPlayers: Number.isFinite(source.maxPlayers) ? source.maxPlayers : current.maxPlayers,
    players: normalizedPlayers,
    palette: normalizedPalette,
    availableColorIds: normalizedAvailableColorIds,
    botFillInProgress: typeof source.botFillInProgress === 'boolean'
      ? source.botFillInProgress
      : Boolean(current.botFillInProgress),
    countdownSeconds: Number.isFinite(source.countdown)
      ? source.countdown
      : (Number.isFinite(current.countdownSeconds) ? current.countdownSeconds : null)
  };
}

function applyLobbySnapshot(payload) {
  const currentLobby = gameState.getState().lobby;
  const lobbySnapshot = normalizeLobbySnapshot(payload, currentLobby);
  gameState.update((state) => ({
    session: {
      preferredLobbyColorId:
        state.session && state.session.joined
          ? state.session.preferredLobbyColorId
          : (state.session && state.session.preferredLobbyColorId &&
            lobbySnapshot.palette.some((entry) => entry.colorId === state.session.preferredLobbyColorId)
              ? state.session.preferredLobbyColorId
              : null)
    },
    lobby: lobbySnapshot
  }));
}

function getLocalLobbyPlayer(state) {
  const sessionPlayerId = state && state.session ? state.session.playerId : null;
  const lobbyPlayers = Array.isArray(state && state.lobby && state.lobby.players) ? state.lobby.players : [];

  if (sessionPlayerId == null) {
    return null;
  }

  return lobbyPlayers.find((player) => player && String(player.id) === String(sessionPlayerId)) || null;
}

function getPreferredLobbyColorIdForJoin(state) {
  const preferredColorId = state && state.session ? state.session.preferredLobbyColorId : null;
  if (typeof preferredColorId !== 'string' || preferredColorId.trim().length === 0) {
    return null;
  }

  const palette = Array.isArray(state && state.lobby && state.lobby.palette) ? state.lobby.palette : [];
  const paletteColorIds = new Set(palette.map((entry) => entry.colorId));
  return paletteColorIds.has(preferredColorId) ? preferredColorId : null;
}

function refreshLobbyColorPicker(state) {
  if (!lobbyColorPickerEl || !lobbyColorPickerRowEl) {
    return;
  }

  const isLobbyScreen = Boolean(state && state.ui && state.ui.screen === 'lobby');
  const palette = Array.isArray(state && state.lobby && state.lobby.palette) ? state.lobby.palette : [];
  const availableColorIds = new Set(
    Array.isArray(state && state.lobby && state.lobby.availableColorIds) ? state.lobby.availableColorIds : []
  );
  const localPlayer = getLocalLobbyPlayer(state);
  const authoritativeColorId = localPlayer && localPlayer.colorId ? localPlayer.colorId : null;
  const joined = Boolean(state && state.session && state.session.joined);
  const colorRequestPending = Boolean(state && state.session && state.session.lobbyColorRequestPending);
  const preferredColorId = state && state.session ? state.session.preferredLobbyColorId : null;
  const selectedColorId = joined ? authoritativeColorId : preferredColorId;

  if (!isLobbyScreen || palette.length === 0) {
    lobbyColorPickerEl.classList.add('hidden');
    lobbyColorPickerRowEl.innerHTML = '';
    return;
  }

  lobbyColorPickerEl.classList.remove('hidden');
  lobbyColorPickerRowEl.innerHTML = '';

  const fragment = document.createDocumentFragment();
  palette.forEach((entry) => {
    const colorId = entry.colorId;
    const colorHex = entry.colorHex;
    const isAvailable = availableColorIds.has(colorId);
    const isSelected = selectedColorId === colorId;
    const canRequestColorChange = joined && !colorRequestPending && isAvailable && colorId !== authoritativeColorId;
    const canSetPreference = !joined && isAvailable;

    const tileButtonEl = document.createElement('button');
    tileButtonEl.type = 'button';
    tileButtonEl.className = 'lobby-color-tile';
    tileButtonEl.style.backgroundColor = colorHex;
    tileButtonEl.setAttribute('data-color-id', colorId);
    tileButtonEl.setAttribute('aria-label', `Choose ${colorId}`);
    tileButtonEl.setAttribute('role', 'option');
    tileButtonEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    tileButtonEl.title = isAvailable
      ? `${colorId}${isSelected ? ' (selected)' : ''}`
      : `${colorId} (unavailable)`;

    if (isSelected) {
      tileButtonEl.classList.add('is-selected');
    }

    if (!isAvailable) {
      tileButtonEl.classList.add('is-unavailable');
    }

    tileButtonEl.disabled = !(canSetPreference || canRequestColorChange);
    fragment.appendChild(tileButtonEl);
  });

  lobbyColorPickerRowEl.appendChild(fragment);
}

function setSimulationClockSnapshotFromGame(authoritativeGame) {
  if (!authoritativeGame || typeof authoritativeGame !== 'object') {
    simulationClockSnapshot = getEmptySimulationClockSnapshot();
    return;
  }

  const sourceSnapshot =
    authoritativeGame.simulationClock && typeof authoritativeGame.simulationClock === 'object'
      ? authoritativeGame.simulationClock
      : authoritativeGame;
  simulationClockSnapshot = normalizeSimulationClockSnapshot(sourceSnapshot);
}

function renderSimulationClockText(dateText, timeText) {
  if (simulationClockDateEl && lastRenderedSimulationDateText !== dateText) {
    simulationClockDateEl.textContent = dateText;
    lastRenderedSimulationDateText = dateText;
  }

  if (simulationClockTimeEl && lastRenderedSimulationTimeText !== timeText) {
    simulationClockTimeEl.textContent = timeText;
    lastRenderedSimulationTimeText = timeText;
  }
}

function formatElapsedSimulationClockText(snapshot, simulationNowGameMs) {
  const formatTwoDigit = (value) => String(Math.max(0, Number(value) || 0)).padStart(2, '0');
  const formatYear = (value) => String(Math.max(0, Number(value) || 0));

  if (!Number.isFinite(simulationNowGameMs) || !snapshot || !Number.isFinite(snapshot.simulationStartedAtGameMs)) {
    return {
      primaryText: '--',
      secondaryText: ''
    };
  }

  const elapsedSimulationMs = Math.max(0, simulationNowGameMs - snapshot.simulationStartedAtGameMs);
  const totalElapsedHours = Math.floor(elapsedSimulationMs / SIMULATION_HOUR_MS);
  const elapsedCompleteDays = Math.floor(totalElapsedHours / SIMULATION_HOURS_PER_DAY);
  const hourOfDay = totalElapsedHours % SIMULATION_HOURS_PER_DAY;

  const yearNumber = Math.floor(elapsedCompleteDays / SIMULATION_DAYS_PER_YEAR) + 1;
  const dayOffsetInYear = elapsedCompleteDays % SIMULATION_DAYS_PER_YEAR;
  const monthOfYear = Math.floor(dayOffsetInYear / SIMULATION_DAYS_PER_MONTH) + 1;
  const dayOfMonth = (dayOffsetInYear % SIMULATION_DAYS_PER_MONTH) + 1;

  return {
    primaryText:
      `Year ${formatYear(yearNumber)}, ` +
      `Month ${formatTwoDigit(monthOfYear)}, ` +
      `Day ${formatTwoDigit(dayOfMonth)}, ` +
      `Hour ${formatTwoDigit(hourOfDay + 1)}`,
    secondaryText: ''
  };
}

function updateSimulationClockDisplay() {
  if (!simulationClockHudEl || !simulationClockDateEl || !simulationClockTimeEl) {
    return false;
  }

  const state = gameState.getState();
  const isGameScreen = Boolean(state && state.ui && state.ui.screen === 'game');
  const gameStatus = state && state.game ? state.game.status : null;
  const shouldShowClock = isGameScreen && (gameStatus === 'active' || gameStatus === 'ended');

  if (!shouldShowClock) {
    simulationClockHudEl.classList.add('hidden');
    renderSimulationClockText('--', '--:--');
    return false;
  }

  simulationClockHudEl.classList.remove('hidden');

  const simulationNowGameMs = deriveSimulationNowGameMs(simulationClockSnapshot);
  const elapsedClockText = formatElapsedSimulationClockText(simulationClockSnapshot, simulationNowGameMs);
  renderSimulationClockText(elapsedClockText.primaryText, elapsedClockText.secondaryText);
  return true;
}

function stopSimulationClockTicker() {
  if (simulationClockIntervalId) {
    clearInterval(simulationClockIntervalId);
    simulationClockIntervalId = null;
  }
}

function startSimulationClockTicker() {
  if (simulationClockIntervalId) {
    return;
  }

  simulationClockIntervalId = setInterval(() => {
    updateSimulationClockDisplay();
  }, SIMULATION_CLOCK_TICK_MS);
}

function syncSimulationClockLifecycle() {
  const shouldRun = updateSimulationClockDisplay();
  if (!shouldRun) {
    stopSimulationClockTicker();
    return;
  }

  startSimulationClockTicker();
}

function resetSimulationClockClientState() {
  simulationClockSnapshot = getEmptySimulationClockSnapshot();
  stopSimulationClockTicker();
  renderSimulationClockText('--', '--:--');
  if (simulationClockHudEl) {
    simulationClockHudEl.classList.add('hidden');
  }
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

if (lobbyColorPickerRowEl) {
  lobbyColorPickerRowEl.addEventListener('wheel', (event) => {
    if (!event || !Number.isFinite(event.deltaY) || event.deltaY === 0) {
      return;
    }

    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
      return;
    }

    event.preventDefault();
    lobbyColorPickerRowEl.scrollLeft += event.deltaY;
  }, { passive: false });

  lobbyColorPickerRowEl.addEventListener('click', (event) => {
    const tileButton = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('.lobby-color-tile')
      : null;

    if (!tileButton || tileButton.disabled) {
      return;
    }

    const requestedColorId = String(tileButton.getAttribute('data-color-id') || '').trim();
    if (!requestedColorId) {
      return;
    }

    const state = gameState.getState();
    const palette = Array.isArray(state && state.lobby && state.lobby.palette) ? state.lobby.palette : [];
    const paletteColorIds = new Set(palette.map((entry) => entry.colorId));
    if (!paletteColorIds.has(requestedColorId)) {
      return;
    }

    const availableColorIds = new Set(
      Array.isArray(state && state.lobby && state.lobby.availableColorIds) ? state.lobby.availableColorIds : []
    );
    const isAvailable = availableColorIds.has(requestedColorId);
    if (!isAvailable) {
      return;
    }

    if (!state.session.joined) {
      gameState.update(() => ({
        session: {
          preferredLobbyColorId: requestedColorId
        },
        ui: {
          errorMessage: null
        }
      }));
      return;
    }

    if (state.session.lobbyColorRequestPending) {
      return;
    }

    const localPlayer = getLocalLobbyPlayer(state);
    if (localPlayer && localPlayer.colorId === requestedColorId) {
      return;
    }

    gameState.update(() => ({
      session: {
        lobbyColorRequestPending: true
      },
      ui: {
        errorMessage: null
      }
    }));

    socket.emit('lobby:color:request', { colorId: requestedColorId });
  });
}

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
    const preferredColorId = getPreferredLobbyColorIdForJoin(state);
    socket.emit('lobby:join', {
      username,
      preferredColorId
    });
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
  resetSimulationClockClientState();
  closeRoutesModal();
  isRouteCreatePending = false;
  routeCreateErrorMessage = '';
  pendingRouteRemoveRouteId = null;
  routeRemoveErrorMessage = '';
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
      lobbyColorRequestPending: false,
      preferredLobbyColorId: null,
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

socket.on('lobby:joined', (payload = {}) => {
  const lobbyId = payload.lobbyId || null;
  const playerId = payload.playerId || null;
  const username = payload.username;

  if (typeof username === 'string') {
    usernameInputEl.value = username;
  }

  if (payload && payload.lobbyId) {
    applyLobbySnapshot(payload);
  }

  gameState.update(() => ({
    session: {
      playerId,
      joined: true,
      joinPending: false,
      botFillPending: false,
      lobbyColorRequestPending: false,
      preferredLobbyColorId:
        typeof payload.colorId === 'string' && payload.colorId.trim().length > 0
          ? payload.colorId.trim()
          : null,
      currentLobbyId: lobbyId
    }
  }));

  console.log(`Joined lobby ${lobbyId} as ${playerId}.`);
});

socket.on('lobby:left', ({ lobbyId, playerId }) => {
  stopGameCountdown();
  resetSimulationClockClientState();
  gameState.update(() => ({
    session: {
      joined: false,
      joinPending: false,
      botFillPending: false,
      lobbyColorRequestPending: false,
      currentLobbyId: null
    },
    lobby: getEmptyLobbyState()
  }));

  console.log(`Left lobby ${lobbyId} as ${playerId}.`);
});

socket.on('game:left', ({ gameId, playerId }) => {
  stopGameCountdown();
  resetSimulationClockClientState();
  closeShopModal();
  closeRoutesModal();
  isRouteCreatePending = false;
  routeCreateErrorMessage = '';
  pendingRouteRemoveRouteId = null;
  routeRemoveErrorMessage = '';
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
      lobbyColorRequestPending: false,
      preferredLobbyColorId: null,
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
      session: {
        botFillPending: false,
        lobbyColorRequestPending: false
      }
    }));
    applyLobbySnapshot(payload);
  }
});

socket.on('lobby:color:result', (result = {}) => {
  gameState.update((state) => {
    const currentLobby = state && state.lobby ? state.lobby : getEmptyLobbyState();
    const currentPlayers = Array.isArray(currentLobby.players) ? currentLobby.players : [];

    const nextPlayers = result.success
      ? currentPlayers.map((player) => {
          if (!player || String(player.id) !== String(result.playerId)) {
            return player;
          }

          return {
            ...player,
            colorId: typeof result.colorId === 'string' ? result.colorId : player.colorId,
            colorHex: typeof result.colorHex === 'string' ? result.colorHex : player.colorHex
          };
        })
      : currentPlayers;

    const nextAvailableColorIds = Array.isArray(result.availableColorIds)
      ? result.availableColorIds
      : currentLobby.availableColorIds;

    return {
      session: {
        lobbyColorRequestPending: false,
        preferredLobbyColorId:
          typeof result.colorId === 'string' && result.colorId.trim().length > 0
            ? result.colorId.trim()
            : state.session.preferredLobbyColorId
      },
      lobby: {
        players: nextPlayers,
        availableColorIds: nextAvailableColorIds
      }
    };
  });
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
    session: { joinPending: false, botFillPending: false, lobbyColorRequestPending: false },
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

  setSimulationClockSnapshotFromGame(authoritativeGame);

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
  syncSimulationClockLifecycle();

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

window.addEventListener('beforeunload', () => {
  stopGameCountdown();
  stopSimulationClockTicker();
});

socket.on('game:event', (eventPayload) => {
  appendGameEventToHistory(eventPayload);
});

const FINANCE_HISTORY_CLIENT_MAX_SAMPLES = 6500;

function normalizeFinanceHistorySample(sample) {
  if (!sample || typeof sample !== 'object' || !Number.isFinite(sample.worldElapsedSimulationMs)) {
    return null;
  }

  return {
    worldElapsedSimulationMs: sample.worldElapsedSimulationMs,
    cash: Number.isFinite(sample.cash) ? sample.cash : 0,
    netWorth: Number.isFinite(sample.netWorth) ? sample.netWorth : 0
  };
}

function mergeFinanceHistorySamples(existingSamples, incomingSamples) {
  const byElapsed = new Map();

  for (const list of [existingSamples, incomingSamples]) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const raw of list) {
      const sample = normalizeFinanceHistorySample(raw);
      if (sample) {
        byElapsed.set(sample.worldElapsedSimulationMs, sample);
      }
    }
  }

  const merged = [...byElapsed.values()].sort(
    (a, b) => a.worldElapsedSimulationMs - b.worldElapsedSimulationMs
  );

  return merged.length > FINANCE_HISTORY_CLIENT_MAX_SAMPLES
    ? merged.slice(merged.length - FINANCE_HISTORY_CLIENT_MAX_SAMPLES)
    : merged;
}

socket.on('finance:history:result', (result = {}) => {
  if (!result || result.ok !== true || !Array.isArray(result.samples)) {
    return;
  }

  gameState.update((state) => ({
    session: {
      financeHistorySamples: mergeFinanceHistorySamples(
        state.session.financeHistorySamples,
        result.samples
      )
    }
  }));
});

socket.on('finance:history:sample', (sample) => {
  if (!normalizeFinanceHistorySample(sample)) {
    return;
  }

  gameState.update((state) => ({
    session: {
      financeHistorySamples: mergeFinanceHistorySamples(
        state.session.financeHistorySamples,
        [sample]
      )
    }
  }));
});

function requestFinanceHistory() {
  if (!socket || socket.connected === false) {
    return;
  }

  socket.emit('finance:history:request');
}

socket.on('route:create:result', (result = {}) => {
  if (!isRouteCreatePending) {
    return;
  }

  const shouldReturnToRoutesAfterSuccess =
    RoutesModalState.childModalReturnContext === ROUTE_CHILD_MODAL_RETURN_CONTEXT.SHOP &&
    RoutesModalState.isStandaloneChildModal;
  const retainedEntryAirportId = RoutesModalState.entryAirportId;
  const retainedOpenedFrom = RoutesModalState.openedFrom;

  isRouteCreatePending = false;

  if (!result.success) {
    routeCreateErrorMessage = getRouteCreateResultMessage(result);
    refreshRoutesModal(gameState.getState());
    return;
  }

  routeCreateErrorMessage = '';
  selectedRouteOriginAirportId = null;
  selectedRouteDestinationAirportId = null;
  routeOriginSearchQuery = '';
  routeDestinationSearchQuery = '';
  isRouteOriginDropdownOpen = false;
  isRouteDestinationDropdownOpen = false;

  if (shouldReturnToRoutesAfterSuccess) {
    openRoutesModal({
      openedFrom: retainedOpenedFrom || ROUTES_MODAL_OPENED_FROM.SHOP_AIRPORT_PANEL,
      entryAirportId: retainedEntryAirportId
    });
    return;
  }

  closeCreateRouteModal();
});

socket.on('route:remove:result', (result = {}) => {
  if (pendingRouteRemoveRouteId == null) {
    return;
  }

  pendingRouteRemoveRouteId = null;

  if (!result.success) {
    routeRemoveErrorMessage = getRouteCreateResultMessage(result);
    refreshRoutesModal(gameState.getState());
    return;
  }

  routeRemoveErrorMessage = '';
  refreshRoutesModal(gameState.getState());
});


socket.on('route:aircraft:assign:bulk:result', (result = {}) => {
  if (pendingRouteAircraftAssignAircraftInstanceId == null) {
    return;
  }

  rememberRouteAircraftModelEditLock(result);
  pendingRouteAircraftAssignAircraftInstanceId = null;
  pendingRouteAircraftUnassignAircraftInstanceId = null;
  routeAircraftBulkOperation = null;

  setRouteAircraftBulkResultFeedback(result, 'Unable to assign aircraft.');
  refreshRoutesModal(gameState.getState());
});


socket.on('route:aircraft:unassign:bulk:result', (result = {}) => {
  if (pendingRouteAircraftUnassignAircraftInstanceId == null) {
    return;
  }

  rememberRouteAircraftModelEditLock(result);
  pendingRouteAircraftUnassignAircraftInstanceId = null;
  pendingRouteAircraftAssignAircraftInstanceId = null;
  routeAircraftBulkOperation = null;

  setRouteAircraftBulkResultFeedback(result, 'Unable to unassign aircraft.');
  refreshRoutesModal(gameState.getState());
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
      refreshShopAircraftInteractionPanel(gameState.getState());
      return;
    }

    applyAuthoritativeAircraftSellQuote(result.ownedQuantity, result.maxSellable, result.unitSellPrice, {
      initialize: false
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

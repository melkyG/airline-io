const socket = io();

const joinButtonEl = document.getElementById('joinButton');
const usernameInputEl = document.getElementById('usernameInput');
const gameTimerEl = document.getElementById('gameTimer');
const devAddScoreButtonEl = document.getElementById('devAddScoreButton');
const gameScreenEl = document.getElementById('gameScreen');
const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});
let gameCountdownIntervalId = null;
let selectedAirportId = null;

function getEmptyLobbyState() {
  return {
    lobbyId: null,
    status: 'waiting',
    playerCount: 0,
    maxPlayers: 5,
    players: [],
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
    airports: []
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
  refreshAirportInteractionModal(state);
});
renderer.render(gameState.getState());

const airportModalOverlayEl = document.createElement('div');
airportModalOverlayEl.className = 'airport-interaction-overlay hidden';
airportModalOverlayEl.setAttribute('aria-hidden', 'true');

const airportModalDialogEl = document.createElement('div');
airportModalDialogEl.className = 'airport-interaction-modal';
airportModalDialogEl.setAttribute('role', 'dialog');
airportModalDialogEl.setAttribute('aria-modal', 'true');

const airportModalCloseButtonEl = document.createElement('button');
airportModalCloseButtonEl.type = 'button';
airportModalCloseButtonEl.className = 'airport-interaction-close';
airportModalCloseButtonEl.setAttribute('aria-label', 'Close airport modal');
airportModalCloseButtonEl.textContent = 'x';

const airportModalTitleEl = document.createElement('h3');
airportModalTitleEl.className = 'airport-interaction-title';

const airportModalOwnerRowEl = document.createElement('p');
airportModalOwnerRowEl.className = 'airport-interaction-row';
airportModalOwnerRowEl.innerHTML = '<span class="airport-interaction-label">Owner:</span> <span class="airport-interaction-value" data-airport-owner></span>';
const airportModalOwnerValueEl = airportModalOwnerRowEl.querySelector('[data-airport-owner]');

const airportModalPriceRowEl = document.createElement('p');
airportModalPriceRowEl.className = 'airport-interaction-row';
airportModalPriceRowEl.innerHTML = '<span class="airport-interaction-label">Price:</span> <span class="airport-interaction-value" data-airport-price></span>';
const airportModalPriceValueEl = airportModalPriceRowEl.querySelector('[data-airport-price]');

const airportModalActionsEl = document.createElement('div');
airportModalActionsEl.className = 'airport-interaction-actions';

airportModalDialogEl.appendChild(airportModalCloseButtonEl);
airportModalDialogEl.appendChild(airportModalTitleEl);
airportModalDialogEl.appendChild(airportModalOwnerRowEl);
airportModalDialogEl.appendChild(airportModalPriceRowEl);
airportModalDialogEl.appendChild(airportModalActionsEl);
airportModalOverlayEl.appendChild(airportModalDialogEl);

if (gameScreenEl) {
  gameScreenEl.appendChild(airportModalOverlayEl);
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

function getAuthoritativePlayerById(state, playerId) {
  const players = Array.isArray(state && state.game && state.game.players) ? state.game.players : [];
  return players.find((player) => player && String(player.id) === String(playerId)) || null;
}

function closeAirportInteractionModal() {
  selectedAirportId = null;
  airportModalOverlayEl.classList.add('hidden');
  airportModalOverlayEl.setAttribute('aria-hidden', 'true');
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

function renderAirportInteractionActions(state, airport) {
  airportModalActionsEl.innerHTML = '';

  const localPlayerId = state && state.session ? state.session.playerId : null;
  const ownerPlayerId = airport.ownerPlayerId;
  const hasOwner = ownerPlayerId != null;
  const isOwnedByLocalPlayer = hasOwner && localPlayerId != null && String(ownerPlayerId) === String(localPlayerId);
  const hasListing = !!(airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice));
  const airportId = String(airport.id || airport.iata);

  if (!hasOwner) {
    airportModalActionsEl.appendChild(
      createAirportActionButton('Purchase', () => emitAirportPurchaseUnownedRequest(airportId))
    );
    return;
  }

  if (isOwnedByLocalPlayer) {
    if (hasListing) {
      airportModalActionsEl.appendChild(
        createAirportActionButton('Cancel Listing', () => emitAirportCancelListingRequest(airportId))
      );
    } else {
      airportModalActionsEl.appendChild(
        createAirportActionButton('List', () => emitAirportListRequestWithPrompt(airportId))
      );
    }

    airportModalActionsEl.appendChild(
      createAirportActionButton('Sell to Game', () => emitAirportSellToGameRequest(airportId))
    );
    return;
  }

  if (hasListing) {
    airportModalActionsEl.appendChild(
      createAirportActionButton('Purchase', () => emitAirportPurchaseListedRequest(airportId))
    );
  }
}

function renderAirportInteractionPrice(airport) {
  airportModalPriceValueEl.innerHTML = '';
  const basePrice = formatCurrencyValue(airport.basePrice);
  const hasListingPrice =
    airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice);

  if (!hasListingPrice) {
    airportModalPriceValueEl.textContent = basePrice;
    return;
  }

  const basePriceEl = document.createElement('span');
  basePriceEl.className = 'airport-interaction-price-base';
  basePriceEl.textContent = basePrice;

  const listedPriceEl = document.createElement('span');
  listedPriceEl.className = 'airport-interaction-price-listed';
  listedPriceEl.textContent = formatCurrencyValue(airport.saleListing.askingPrice);

  airportModalPriceValueEl.appendChild(basePriceEl);
  airportModalPriceValueEl.appendChild(document.createTextNode(' '));
  airportModalPriceValueEl.appendChild(listedPriceEl);
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
  return ownerPlayer && ownerPlayer.username ? ownerPlayer.username : 'Unknown';
}

function refreshAirportInteractionModal(state) {
  if (!selectedAirportId) {
    return;
  }

  if (!state || !state.ui || state.ui.screen !== 'game') {
    closeAirportInteractionModal();
    return;
  }

  const airport = getAuthoritativeAirportById(state, selectedAirportId);
  if (!airport) {
    closeAirportInteractionModal();
    return;
  }

  const airportCode = airport.iata || airport.id || selectedAirportId;
  const airportName = airport.name || 'Unknown Airport';
  airportModalTitleEl.textContent = `${airportName} (${airportCode})`;
  airportModalOwnerValueEl.textContent = resolveAirportOwnerText(state, airport);
  renderAirportInteractionPrice(airport);
  renderAirportInteractionActions(state, airport);

  airportModalOverlayEl.classList.remove('hidden');
  airportModalOverlayEl.setAttribute('aria-hidden', 'false');
}

function openAirportInteractionModal(airportId) {
  if (!airportId) {
    return;
  }

  selectedAirportId = String(airportId);
  refreshAirportInteractionModal(gameState.getState());
}

renderer.setAirportSelectHandler(openAirportInteractionModal);

airportModalCloseButtonEl.addEventListener('click', () => {
  closeAirportInteractionModal();
});

airportModalOverlayEl.addEventListener('click', (event) => {
  if (event.target !== airportModalOverlayEl) {
    return;
  }

  closeAirportInteractionModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  if (airportModalOverlayEl.classList.contains('hidden')) {
    return;
  }

  closeAirportInteractionModal();
});

function sanitizeUsername(rawValue) {
  const trimmed = (rawValue || '').trim();
  const cleaned = trimmed.replace(/[^A-Za-z0-9 _-]/g, '');
  return cleaned.slice(0, 25);
}

function generateUsername() {
  const sillyAdjectives = [
  'Silly',
  'Goofy',
  'Clumsy',
  'Sleepy',
  'Wobbly',
  'Dizzy',
  'Muddy',
  'Bouncy',
  'Stinky',
  'Smelly',
  'Rotten',
  'Abandoned',
  'Dirty',
  'Malnourished',
  'Overencumbered',
  'Fat',
  'Oversized',
  'Brainless',
  'Confused',
  'Adopted',
  'Moldy',
  'Farting',
  'Cursed',
  'Paralyzed',
  'Crusty',
  'Greasy',
  'Soggy',
  'Crispy',
  'Sticky',
  'Sweaty',
  'Dusty',
  'Wrinkly',
  'Cranky',
  'Spicy',
  'Grumpy',
  'Big breasted',
  'Lost',
  'Expired',
  'Suspicious',
  'Explosive',
  'Shivering',
  'Screaming',
  'Howling',
  'Leaking',
  'Toasted',
  'Burnt',
  'Radioactive',
  'Mutated',
  'Possessed',
  'Glitchy',
  'Bootleg',
  'Tiny',
  'Boneless',
  'Hairy',
  'Slimy',
  'Drooling',
  'Snoring'
];

const sillyNouns = [
  'Goose',
  'Noodle',
  'Pancake',
  'Chaburtz',
  'Penguin',
  'Turnip',
  'Muffin',
  'Bean',
  'Goblin',
  'Zombie',
  'Doctor',
  'Diaper',
  'Hamster',
  'Dumpster',
  'Yeti',
  'Surgeon',
  'Naresh',
  'Monkey',
  'SumoWrestler',
  'Clown',
  'Hitchhiker',
  'Nooblet',
  'Bob',
  'ToiletBowl',
  'Potato',
  'Banana Peel',
  'Pickle',
  'Meatball',
  'Chicken',
  'Microwave',
  'RubberDucky',
  'Sock',
  'Terrorist',
  'TrashCan',
  'Taliban',
  'Prisoner',
  'Vacuum',
  'LawnMower',
  'Tire',
  'Brick',
  'Rock',
  'Mop',
  'Pigeon',
  'Seagull',
  'Gremlin',
  'Gargoyle',
  'Skeleton',
  'Ghost',
  'Waffle',
  'Burrito',
  'HotDog',
  'Donut',
  'Pilot',
  'Cactus',
  'Mushroom',
  'Gnome',
  'Wizard',
  'Pirate',
  'Ninja',
  'Caveman',
  'Alien',
  'Robot',
  'Blob',
  'Blobfish',
  'Fossil',
  'Crayon',
  'Turd',
  'Fetus'
];
  const adjective = sillyAdjectives[Math.floor(Math.random() * sillyAdjectives.length)];
  const noun = sillyNouns[Math.floor(Math.random() * sillyNouns.length)];
  return `${adjective} ${noun}`;
}

function getUsernameForJoin() {
  const sanitized = sanitizeUsername(usernameInputEl.value);
  if (sanitized) {
    usernameInputEl.value = sanitized;
    return sanitized;
  }

  const generated = generateUsername();
  usernameInputEl.value = generated;
  return generated;
}

function normalizeLobbySnapshot(payload) {
  const source = payload || {};
  return {
    lobbyId: source.lobbyId || null,
    status: source.status === 'countdown' ? 'countdown' : 'waiting',
    playerCount: Number.isFinite(source.playerCount) ? source.playerCount : 0,
    maxPlayers: Number.isFinite(source.maxPlayers) ? source.maxPlayers : 5,
    players: Array.isArray(source.players) ? source.players : [],
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

socket.on('lobby:joined', ({ lobbyId, playerId }) => {
  gameState.update(() => ({
    session: {
      playerId,
      joined: true,
      joinPending: false,
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
      currentLobbyId: null
    },
    lobby: getEmptyLobbyState()
  }));

  console.log(`Left lobby ${lobbyId} as ${playerId}.`);
});

socket.on('lobby:update', (payload) => {
  if (payload && payload.lobbyId) {
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
    session: { joinPending: false },
    ui: { errorMessage: message || '' }
  }));

  if (message) {
    console.error(message);
  }
});

function applyAuthoritativeGamePayload(payload) {
  const authoritativeGame = payload && payload.game ? payload.game : getEmptyGameState();

  gameState.update(() => ({
    session: {
      currentGameId: authoritativeGame.id,
      joinPending: false
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

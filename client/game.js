const socket = io();

const joinButtonEl = document.getElementById('joinButton');
const usernameInputEl = document.getElementById('usernameInput');
const gameTimerEl = document.getElementById('gameTimer');
const devAddScoreButtonEl = document.getElementById('devAddScoreButton');
let gameCountdownIntervalId = null;

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
});
renderer.render(gameState.getState());

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

socket.on('game:started', (payload) => {
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

  console.log('Game started.');
});

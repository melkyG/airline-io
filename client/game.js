const socket = io();

const connectionStatusEl = document.getElementById('connectionStatus');
const lobbyPreviewEl = document.getElementById('lobbyPreview');
const joinButtonEl = document.getElementById('joinButton');
const usernameInputEl = document.getElementById('usernameInput');
const countdownAreaEl = document.getElementById('countdownArea');
const statusTextEl = document.getElementById('statusText');
const statusDotsEl = document.getElementById('statusDots');
const lobbyPlayerListEl = document.getElementById('lobbyPlayerList');
const statusMessageEl = document.getElementById('statusMessage');
const lobbyScreenEl = document.getElementById('lobbyScreen');
const gameScreenEl = document.getElementById('gameScreen');
const gameStatusEl = document.getElementById('gameStatus');
const leaderboardEl = document.getElementById('leaderboard');

let connected = false;
let joined = false;
let joinPending = false;
let currentLobbyId = null;
let currentGameId = null;
let statusAnimationFrame = null;
let statusAnimationStep = 0;
let waitingStatusActive = false;

function sanitizeUsername(rawValue) {
  const trimmed = (rawValue || '').trim();
  const cleaned = trimmed.replace(/[^A-Za-z0-9 _-]/g, '');
  return cleaned.slice(0, 20);
}

function generateUsername() {
  const sillyAdjectives = ['Silly', 'Goofy', 'Clumsy', 'Sleepy', 'Wobbly', 'Dizzy', 'Muddy', 'Bouncy'];
  const sillyNouns = ['Goose', 'Noodle', 'Pancake', 'Penguin', 'Turnip', 'Muffin', 'Bean', 'Goblin'];
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

joinButtonEl.classList.remove('leave-state');
joinButtonEl.classList.add('join-state');
initializeStatusAnimation();

function setConnectionStatus(message, state) {
  connectionStatusEl.textContent = message;
  connectionStatusEl.className = `status ${state}`;
}

function setStatusMessage(message) {
  statusMessageEl.textContent = message;
}

function showError(message) {
  if (message) {
    console.error(message);
    setStatusMessage(message);
  } else {
    setStatusMessage('');
  }
}

function getDotsForStep(step) {
  const sequence = ['', '.', '. .', '. . .'];
  return sequence[step % sequence.length];
}

function renderWaitingStatus() {
  if (!waitingStatusActive) {
    return;
  }

  statusTextEl.textContent = 'Waiting for players';
  statusDotsEl.textContent = getDotsForStep(statusAnimationStep);
}

function setWaitingStatus() {
  waitingStatusActive = true;
  renderWaitingStatus();
}

function setStatusText(message) {
  waitingStatusActive = false;
  statusTextEl.textContent = message;
  statusDotsEl.textContent = '';
}

function initializeStatusAnimation() {
  if (statusAnimationFrame) {
    return;
  }

  statusAnimationStep = 0;
  setWaitingStatus();

  statusAnimationFrame = setInterval(() => {
    if (!waitingStatusActive) {
      return;
    }

    statusAnimationStep = (statusAnimationStep + 1) % 4;
    renderWaitingStatus();
  }, 850);
}

function resetLobbyView() {
  joined = false;
  currentLobbyId = null;
  joinButtonEl.disabled = false;
  joinButtonEl.textContent = 'Join';
  joinButtonEl.classList.remove('leave-state');
  joinButtonEl.classList.add('join-state');
  usernameInputEl.disabled = false;
  setWaitingStatus();
  lobbyPlayerListEl.innerHTML = '';
  setStatusMessage('');
}

function renderLobbySnapshot(payload) {
  const safePayload = payload || {
    lobbyId: null,
    status: 'waiting',
    playerCount: 0,
    maxPlayers: 5,
    players: [],
    countdown: null
  };

  currentLobbyId = safePayload.lobbyId;
  lobbyPreviewEl.textContent = `${safePayload.playerCount}/${safePayload.maxPlayers} players`;
  lobbyPlayerListEl.innerHTML = '';

  if (!Array.isArray(safePayload.players)) {
    return;
  }

  safePayload.players.forEach((player) => {
    const item = document.createElement('li');
    item.textContent = `${player.displayName} ${player.connected ? '(connected)' : '(disconnected)'}`;
    lobbyPlayerListEl.appendChild(item);
  });
}

joinButtonEl.addEventListener('click', () => {
  if (!connected || joinPending) {
    return;
  }

  if (!joined) {
    joinPending = true;
    joinButtonEl.disabled = true;
    joinButtonEl.textContent = 'Joining...';
    showError('');
    const username = getUsernameForJoin();
    socket.emit('lobby:join', { username });
    return;
  }

  joinPending = true;
  joinButtonEl.disabled = true;
  joinButtonEl.textContent = 'Leaving...';
  showError('');
  socket.emit('lobby:leave');
});

usernameInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    joinButtonEl.click();
  }
});

socket.on('connect', () => {
  connected = true;
  setConnectionStatus('Connected', 'connected');
  console.log('Connected to the server.');
});

socket.on('disconnect', () => {
  connected = false;
  setConnectionStatus('Disconnected', 'disconnected');
  showError('Connection lost. Reconnecting...');
  resetLobbyView();
  lobbyScreenEl.classList.remove('hidden');
  gameScreenEl.classList.add('hidden');
});

socket.on('connection:ready', ({ playerId }) => {
  console.log(`Player ID ready: ${playerId}`);
});

socket.on('lobby:preview', (payload) => {
  if (joined || currentGameId) {
    return;
  }
  renderLobbySnapshot(payload);
});

socket.on('lobby:joined', ({ lobbyId, playerId }) => {
  joined = true;
  joinPending = false;
  currentLobbyId = lobbyId;
  joinButtonEl.disabled = false;
  joinButtonEl.textContent = 'Leave';
  joinButtonEl.classList.remove('join-state');
  joinButtonEl.classList.add('leave-state');
  usernameInputEl.disabled = true;
  console.log(`Joined lobby ${lobbyId} as ${playerId}.`);
});

socket.on('lobby:left', ({ lobbyId, playerId }) => {
  joined = false;
  joinPending = false;
  currentLobbyId = null;
  joinButtonEl.disabled = false;
  joinButtonEl.textContent = 'Join';
  joinButtonEl.classList.remove('leave-state');
  joinButtonEl.classList.add('join-state');
  usernameInputEl.disabled = false;
  setWaitingStatus();
  lobbyPlayerListEl.innerHTML = '';
  console.log(`Left lobby ${lobbyId} as ${playerId}.`);
});

socket.on('lobby:update', (payload) => {
  if (payload && payload.lobbyId) {
    renderLobbySnapshot(payload);
    if (payload.status === 'waiting') {
      setWaitingStatus();
    }
  }
});

socket.on('lobby:countdown', ({ lobbyId, secondsRemaining }) => {
  setStatusText(`Starting in ${secondsRemaining}`);
});

socket.on('lobby:countdown-cancelled', ({ lobbyId, message }) => {
  setWaitingStatus();
  console.warn(`${message} (${lobbyId})`);
});

socket.on('lobby:error', ({ message }) => {
  joinPending = false;
  joinButtonEl.disabled = false;
  joinButtonEl.textContent = joined ? 'Leave' : 'Join';
  joinButtonEl.classList.toggle('leave-state', joined);
  joinButtonEl.classList.toggle('join-state', !joined);
  showError(message);
});

socket.on('game:started', (payload) => {
  currentGameId = payload.gameId;
  lobbyScreenEl.classList.add('hidden');
  gameScreenEl.classList.remove('hidden');
  gameStatusEl.textContent = `Game ${payload.gameId} is active`;
  leaderboardEl.innerHTML = '';

  payload.leaderboard.forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = `${entry.displayName} — ${entry.score}`;
    leaderboardEl.appendChild(item);
  });

  console.log('Game started.');
});

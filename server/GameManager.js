const { randomUUID } = require('node:crypto');
const Player = require('./Player');
const Lobby = require('./Lobby');
const Game = require('./Game');
const { createGame } = require('./gameFactory');
const { AIRCRAFT_CATALOG_BY_ID } = require('./aircraft/catalog');
const { FULL_AIRPORT_CATALOG } = require('./airports/catalog');

const AIRPORT_CATALOG_BY_ID = Object.freeze(
  FULL_AIRPORT_CATALOG.reduce((lookup, airport) => {
    if (!airport || typeof airport.id !== 'string' || airport.id.trim().length === 0) {
      return lookup;
    }

    lookup[airport.id] = airport;
    return lookup;
  }, {})
);

function resolveAirportAssetName(airportId) {
  const airportDefinition = AIRPORT_CATALOG_BY_ID[String(airportId || '')] || null;
  if (airportDefinition && typeof airportDefinition.name === 'string' && airportDefinition.name.trim().length > 0) {
    return airportDefinition.name.trim();
  }

  return String(airportId || 'Airport');
}

function resolvePlayerDisplayNameFromGame(game, playerId) {
  const authoritativePlayers =
    game && game.authoritativeState && Array.isArray(game.authoritativeState.players)
      ? game.authoritativeState.players
      : [];

  const matched = authoritativePlayers.find((player) => player && player.id === playerId);
  if (matched && typeof matched.username === 'string' && matched.username.trim().length > 0) {
    return matched.username.trim();
  }

  return String(playerId || 'Player');
}

const SILLY_ADJECTIVES = Object.freeze([
  'Silly',
  'Goofy',
  'Clumsy',
  'Sleepy',
  'Wobbly',
  'Dizzy',
  'Muddy',
  'Gargling',
  'Bouncy',
  'Stinky',
  'Flying',
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
  'Diabetic',
  'Drooling',
  'Snoring',
  'Crying',
  'Screeching',
  'Screaming',
  'Drowning',
  'Frozen',
]);

const SILLY_NOUNS = Object.freeze([
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
  'Fetus',
  'Cucumber',
  'Janitor',
  'Leprechaun',
  'Vampire',
  'Werewolf',
  'Dragon',
  'Unicorn',
  'Mermaid',
]);

const DEFAULT_ENDED_GAME_RETENTION_MS = 5 * 60 * 1000;

class GameManager {
  constructor(io, options = {}) {
    this.io = io;
    this.connections = new Map();
    this.lobbies = new Map();
    this.games = new Map();
    this.players = new Map();
    this.playerLobbyIds = new Map();
    this.playerGameIds = new Map();
    this.endedGameRetentionTimeoutIds = new Map();
    this.destroyingGameIds = new Set();
    this.endedGameRetentionMs = Number.isFinite(options.endedGameRetentionMs)
      ? Math.max(0, options.endedGameRetentionMs)
      : DEFAULT_ENDED_GAME_RETENTION_MS;
    this.timerApi = options.timerApi || {
      setTimeout,
      clearTimeout
    };
  }

  registerConnection(socket) {
    this.connections.set(socket.id, socket);
    return socket;
  }

  createPlayer(socket, displayName = null) {
    const player = new Player({
      socket,
      displayName,
      isBot: false,
      connected: true
    });
    this.players.set(player.id, player);
    return player;
  }

  createBotPlayer(displayName = null) {
    const player = new Player({
      id: `bot-${randomUUID()}`,
      socket: null,
      displayName,
      isBot: true,
      connected: true
    });
    this.players.set(player.id, player);
    return player;
  }

  addPlayerToLobby(lobby, player) {
    if (!lobby || !player) {
      return false;
    }

    const added = lobby.addPlayer(player);
    if (!added) {
      return false;
    }

    if (player.socket && player.socket.connected) {
      player.socket.join(lobby.getRoomName());
    }

    return true;
  }

  normalizeUsername(username) {
    const trimmed = (username || '').trim();
    const sanitized = trimmed.replace(/[^A-Za-z0-9 _-]/g, '');
    return sanitized.slice(0, 25);
  }

  getLobbyUsernameConstraints(lobby) {
    const usedFullNames = new Set();
    const usedAdjectives = new Set();
    const usedNouns = new Set();

    Array.from(lobby.players.values()).forEach((player) => {
      const displayName = player && typeof player.displayName === 'string' ? player.displayName : '';
      const normalizedName = displayName.trim().toLowerCase();
      if (!normalizedName) {
        return;
      }

      usedFullNames.add(normalizedName);

      SILLY_ADJECTIVES.forEach((adjective) => {
        const normalizedAdjective = adjective.toLowerCase();
        if (normalizedName.startsWith(`${normalizedAdjective} `)) {
          usedAdjectives.add(normalizedAdjective);
        }
      });

      SILLY_NOUNS.forEach((noun) => {
        const normalizedNoun = noun.toLowerCase();
        if (normalizedName.endsWith(` ${normalizedNoun}`)) {
          usedNouns.add(normalizedNoun);
        }
      });
    });

    return {
      usedFullNames,
      usedAdjectives,
      usedNouns
    };
  }

  generateLobbyAwareUsername(lobby) {
    const { usedFullNames, usedAdjectives, usedNouns } = this.getLobbyUsernameConstraints(lobby);

    const availableAdjectives = SILLY_ADJECTIVES.filter(
      (word) => !usedAdjectives.has(word.toLowerCase())
    );
    const availableNouns = SILLY_NOUNS.filter(
      (word) => !usedNouns.has(word.toLowerCase())
    );

    const candidateNames = [];
    availableAdjectives.forEach((adjective) => {
      availableNouns.forEach((noun) => {
        const fullName = `${adjective} ${noun}`;
        if (!usedFullNames.has(fullName.toLowerCase())) {
          candidateNames.push(fullName);
        }
      });
    });

    if (candidateNames.length > 0) {
      return candidateNames[Math.floor(Math.random() * candidateNames.length)];
    }

    let attempt = 0;
    while (attempt < 1000) {
      const fallbackName = `Player_${Math.random().toString(36).slice(2, 8)}`;
      if (!usedFullNames.has(fallbackName.toLowerCase())) {
        return fallbackName;
      }

      attempt += 1;
    }

    return `Player_${Date.now().toString(36)}`;
  }

  assignPlayerToLobby(socketId, requestedUsername) {
    const socket = this.connections.get(socketId);
    if (!socket && !this.players.has(socketId)) {
      return { success: false, message: 'Player not registered.' };
    }

    if (this.playerLobbyIds.has(socketId) || this.playerGameIds.has(socketId)) {
      return { success: false, message: 'You have already joined.' };
    }

    const normalizedUsername = this.normalizeUsername(requestedUsername);
    const targetLobby = this.findBestJoinableLobby();
    const lobby = targetLobby || this.createLobby();

    let resolvedUsername = normalizedUsername;
    if (!resolvedUsername) {
      resolvedUsername = this.generateLobbyAwareUsername(lobby);
    } else {
      const usernameTaken = Array.from(lobby.players.values()).some((existingPlayer) => {
        return existingPlayer.displayName.trim().toLowerCase() === resolvedUsername.trim().toLowerCase();
      });

      if (usernameTaken) {
        return { success: false, message: 'That username is already being used in this lobby.' };
      }
    }

    let player = this.players.get(socketId);
    if (!player) {
      player = this.createPlayer(socket, resolvedUsername);
      this.connections.delete(socketId);
    } else {
      player.setDisplayName(resolvedUsername);
    }

    if (!this.addPlayerToLobby(lobby, player)) {
      return { success: false, message: 'Unable to join the lobby.' };
    }

    this.playerLobbyIds.set(socketId, lobby.id);

    this.io.to(player.socket.id).emit('lobby:joined', {
      lobbyId: lobby.id,
      playerId: player.id,
      username: player.displayName
    });

    this.io.to(player.socket.id).emit('lobby:update', lobby.getPublicState());

    this.broadcastLobbyPreviews();
    return { success: true, lobby };
  }

  handleLobbyBotFillRequest(socketId) {
    const player = this.players.get(socketId);
    if (!player) {
      return { success: false, code: 'PLAYER_NOT_REGISTERED', message: 'Player not registered.' };
    }

    if (player.isBot) {
      return { success: false, code: 'BOT_REQUEST_DENIED', message: 'Only real players can request bot fill.' };
    }

    if (!player.lobbyId) {
      return { success: false, code: 'NOT_IN_LOBBY', message: 'You are not in a lobby.' };
    }

    const lobby = this.lobbies.get(player.lobbyId);
    if (!lobby) {
      this.playerLobbyIds.delete(socketId);
      player.lobbyId = null;
      return { success: false, code: 'LOBBY_NOT_FOUND', message: 'Lobby no longer exists.' };
    }

    if (lobby.status !== 'waiting') {
      return { success: false, code: 'LOBBY_NOT_WAITING', message: 'Lobby is no longer waiting.' };
    }

    if (lobby.getPlayerCount() >= lobby.maxPlayers) {
      return { success: false, code: 'LOBBY_FULL', message: 'Lobby is already full.' };
    }

    if (lobby.botFillInProgress) {
      return { success: false, code: 'BOT_FILL_BUSY', message: 'Bot fill is already in progress.' };
    }

    const realPlayerCount = Array.from(lobby.players.values()).filter((member) => member && !member.isBot).length;
    if (realPlayerCount < 1) {
      return { success: false, code: 'NO_REAL_PLAYERS', message: 'At least one real player must be in the lobby.' };
    }

    lobby.botFillInProgress = true;
    lobby.broadcastState();

    let botsAdded = 0;

    try {
      while (lobby.isJoinable()) {
        const botDisplayName = this.generateLobbyAwareUsername(lobby);
        const botPlayer = this.createBotPlayer(botDisplayName);
        const added = this.addPlayerToLobby(lobby, botPlayer);
        if (!added) {
          this.players.delete(botPlayer.id);
          break;
        }

        botsAdded += 1;
      }
    } finally {
      lobby.botFillInProgress = false;
      lobby.broadcastState();
      this.broadcastLobbyPreviews();
    }

    return {
      success: true,
      code: 'OK',
      message: botsAdded > 0 ? `Added ${botsAdded} bot${botsAdded === 1 ? '' : 's'}.` : 'Lobby is already full.',
      addedCount: botsAdded,
      lobbyId: lobby.id
    };
  }

  leaveLobby(socketId) {
    const player = this.players.get(socketId);
    if (!player) {
      return { success: false, message: 'Player not registered.' };
    }

    if (!player.lobbyId) {
      return { success: false, message: 'You are not in a lobby.' };
    }

    const lobby = this.lobbies.get(player.lobbyId);
    if (!lobby) {
      this.playerLobbyIds.delete(socketId);
      player.lobbyId = null;
      return { success: false, message: 'Lobby no longer exists.' };
    }

    const removed = lobby.removePlayer(player.id, false);
    if (!removed) {
      return { success: false, message: 'Unable to leave the lobby.' };
    }

    this.playerLobbyIds.delete(socketId);
    this.connections.set(socketId, player.socket);
    player.connected = true;

    this.io.to(socketId).emit('lobby:left', {
      lobbyId: lobby.id,
      playerId: player.id
    });

    this.io.to(socketId).emit('lobby:preview', this.getLobbyPreview());
    this.broadcastLobbyPreviews();
    return { success: true, lobbyId: lobby.id };
  }

  leaveGame(socketId) {
    const player = this.players.get(socketId);
    if (!player) {
      return { success: false, code: 'PLAYER_NOT_REGISTERED', message: 'Player not registered.' };
    }

    if (!player.gameId) {
      return { success: false, code: 'PLAYER_NOT_IN_GAME', message: 'You are not in an active game.' };
    }

    return this.handleGameParticipantExit(socketId, { isDisconnect: false });
  }

  findBestJoinableLobby() {
    const joinableLobbies = Array.from(this.lobbies.values()).filter((lobby) => lobby.isJoinable());
    joinableLobbies.sort((a, b) => b.getPlayerCount() - a.getPlayerCount());
    return joinableLobbies[0] || null;
  }

  createLobby() {
    const lobbyId = `lobby-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lobby = new Lobby(lobbyId, this);
    this.lobbies.set(lobbyId, lobby);
    return lobby;
  }

  getLobbyRealPlayerCount(lobby) {
    if (!lobby || !lobby.players) {
      return 0;
    }

    return Array.from(lobby.players.values()).filter((player) => player && !player.isBot).length;
  }

  cleanupWaitingLobbyWithoutRealPlayers(lobby) {
    if (!lobby || lobby.status !== 'waiting') {
      return false;
    }

    const realPlayerCount = this.getLobbyRealPlayerCount(lobby);
    if (realPlayerCount > 0) {
      return false;
    }

    lobby.botFillInProgress = false;
    lobby.countdownRemaining = null;
    if (lobby.countdownInterval) {
      clearInterval(lobby.countdownInterval);
      lobby.countdownInterval = null;
    }

    Array.from(lobby.players.values()).forEach((member) => {
      if (!member) {
        return;
      }

      if (member.socket && member.socket.connected) {
        member.socket.leave(lobby.getRoomName());
      }

      member.lobbyId = null;
      this.playerLobbyIds.delete(member.id);

      if (member.isBot) {
        this.players.delete(member.id);
        this.playerGameIds.delete(member.id);
      }
    });

    lobby.players.clear();
    this.removeLobby(lobby.id);
    this.broadcastLobbyPreviews();
    return true;
  }

  removeLobby(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      return;
    }

    if (lobby.countdownInterval) {
      clearInterval(lobby.countdownInterval);
      lobby.countdownInterval = null;
    }

    this.lobbies.delete(lobbyId);
  }

  getConnectedRealHumansInGame(game) {
    if (!game || !game.players) {
      return 0;
    }

    return Array.from(game.players.values()).filter((player) => {
      return !!player && !player.isBot && player.connected === true;
    }).length;
  }

  clearEndedGameRetentionTimer(gameId) {
    const timeoutId = this.endedGameRetentionTimeoutIds.get(gameId);
    if (!timeoutId) {
      return;
    }

    this.timerApi.clearTimeout(timeoutId);
    this.endedGameRetentionTimeoutIds.delete(gameId);
  }

  handleGameEnded(gameId) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'ended') {
      return false;
    }

    if (this.endedGameRetentionTimeoutIds.has(gameId)) {
      return true;
    }

    const timeoutId = this.timerApi.setTimeout(() => {
      this.destroyGame(gameId, 'ended-retention-expired');
    }, this.endedGameRetentionMs);

    this.endedGameRetentionTimeoutIds.set(gameId, timeoutId);
    return true;
  }

  destroyGame(gameId, reason = 'unspecified') {
    const existingGame = this.games.get(gameId);
    if (!existingGame && !this.endedGameRetentionTimeoutIds.has(gameId)) {
      return false;
    }

    if (this.destroyingGameIds.has(gameId)) {
      return false;
    }

    this.destroyingGameIds.add(gameId);

    try {
      this.clearEndedGameRetentionTimer(gameId);

      const game = this.games.get(gameId);
      if (!game) {
        return false;
      }

      if (typeof game.dispose === 'function') {
        game.dispose();
      }

      const gameRoomName = typeof game.getRoomName === 'function' ? game.getRoomName() : `game:${gameId}`;
      const gamePlayers = game.players && typeof game.players.values === 'function'
        ? Array.from(game.players.values())
        : [];

      gamePlayers.forEach((player) => {
        if (!player) {
          return;
        }

        if (player.socket && player.socket.connected) {
          player.socket.leave(gameRoomName);
        }

        const mappedGameId = this.playerGameIds.get(player.id);
        if (mappedGameId === gameId) {
          this.playerGameIds.delete(player.id);
        }

        if (player.gameId === gameId) {
          player.gameId = null;
        }

        const isSocketConnected = !!(player.socket && player.socket.connected);
        if (isSocketConnected && !player.lobbyId && !player.gameId) {
          this.connections.set(player.id, player.socket);
        }

        const shouldPurge = player.isBot || (!player.lobbyId && !player.gameId);
        if (shouldPurge) {
          this.players.delete(player.id);
        }
      });

      if (game.players && typeof game.players.clear === 'function') {
        game.players.clear();
      }

      this.games.delete(gameId);
      this.broadcastLobbyPreviews();
      return true;
    } finally {
      this.destroyingGameIds.delete(gameId);
    }
  }

  handleGameParticipantExit(socketId, { isDisconnect = false } = {}) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return { success: false, code: 'PLAYER_NOT_IN_GAME', message: 'Player is not in an active game.' };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    const game = this.games.get(gameId);
    if (!game) {
      this.playerGameIds.delete(socketId);
      if (player.gameId === gameId) {
        player.gameId = null;
      }
      return { success: false, code: 'GAME_NOT_FOUND', message: 'Game no longer exists.' };
    }

    if (!isDisconnect && player.socket && player.socket.connected) {
      player.socket.leave(game.getRoomName());
    }

    player.connected = false;

    if (isDisconnect) {
      player.socket = null;
    } else {
      this.playerGameIds.delete(socketId);
      if (player.gameId === gameId) {
        player.gameId = null;
      }

      if (player.socket && player.socket.connected) {
        this.connections.set(socketId, player.socket);
      }

      this.io.to(socketId).emit('game:left', {
        gameId,
        playerId: player.id
      });
      this.io.to(socketId).emit('lobby:preview', this.getLobbyPreview());
    }

    if (typeof game.handlePlayerDisconnect === 'function') {
      game.handlePlayerDisconnect(player.id);
    }

    const connectedRealHumans = this.getConnectedRealHumansInGame(game);
    if (connectedRealHumans === 0) {
      this.destroyGame(game.id, isDisconnect ? 'active-game-disconnect-no-humans' : 'active-game-leave-no-humans');
      return {
        success: true,
        code: 'GAME_DESTROYED',
        destroyed: true,
        gameId
      };
    }

    if (game.status === 'ended') {
      this.handleGameEnded(game.id);
    }

    return {
      success: true,
      code: 'PLAYER_MARKED_DISCONNECTED',
      destroyed: false,
      gameId
    };
  }

  convertLobbyToGame(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      return null;
    }

    if (!lobby.isReadyToStart()) {
      return null;
    }

    const allConnected = Array.from(lobby.players.values()).every((player) => player.connected);
    if (!allConnected) {
      lobby.cancelCountdown();
      return null;
    }

    const lobbyPlayers = Array.from(lobby.players.values());
    const initialGame = createGame(lobbyPlayers);
    const game = new Game(initialGame, this);

    lobbyPlayers.forEach((player) => {
      if (player.socket && player.socket.connected) {
        player.socket.leave(lobby.getRoomName());
        player.socket.join(game.getRoomName());
      }

      this.playerLobbyIds.delete(player.id);
      this.playerGameIds.set(player.id, game.id);
      game.players.set(player.id, player);
    });

    this.games.set(game.id, game);
    this.lobbies.delete(lobby.id);

    game.initialize();
    this.broadcastLobbyPreviews();

    return game;
  }

  handleDisconnect(socketId) {
    if (this.connections.has(socketId)) {
      this.connections.delete(socketId);
      return;
    }

    const player = this.players.get(socketId);
    if (!player) {
      return;
    }

    if (player.gameId) {
      this.handleGameParticipantExit(socketId, { isDisconnect: true });
      return;
    }

    if (player.lobbyId) {
      const lobby = this.lobbies.get(player.lobbyId);
      if (lobby) {
        lobby.removePlayer(player.id, true);
      }
      this.playerLobbyIds.delete(socketId);
      player.lobbyId = null;
      player.connected = false;
      player.socket = null;
      return;
    }

    this.players.delete(socketId);
    this.playerLobbyIds.delete(socketId);
    this.playerGameIds.delete(socketId);
  }

  getLobbyPreview() {
    const joinableLobby = this.findBestJoinableLobby();
    if (!joinableLobby) {
      return {
        lobbyId: null,
        status: 'waiting',
        playerCount: 0,
        maxPlayers: 5,
        players: [],
        countdown: null
      };
    }

    return {
      lobbyId: joinableLobby.id,
      status: joinableLobby.status,
      playerCount: joinableLobby.getPlayerCount(),
      maxPlayers: joinableLobby.maxPlayers,
      players: Array.from(joinableLobby.players.values()).map((player) => player.getPublicState()),
      botFillInProgress: joinableLobby.botFillInProgress,
      countdown: joinableLobby.countdownRemaining
    };
  }

  broadcastLobbyPreviews() {
    this.connections.forEach((socket, socketId) => {
      if (!socket || !socket.connected) {
        return;
      }

      const player = this.players.get(socketId);
      if (player && !this.isPlayerUnjoined(socketId)) {
        return;
      }

      this.io.to(socket.id).emit('lobby:preview', this.getLobbyPreview());
    });
  }

  isPlayerUnjoined(socketId) {
    const player = this.players.get(socketId);
    return !!player && !player.lobbyId && !player.gameId;
  }

  handleDeveloperScoreRequest(socketId, amount = 500) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return false;
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return false;
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return false;
    }

    return game.addScore(player.id, amount);
  }

  handleAirportPurchaseRequest(socketId, airportId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.purchaseUnownedAirport(player.id, airportId);
  }

  handleAirportPurchaseSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const airportId = requestPayload ? requestPayload.airportId : undefined;

    if (typeof airportId !== 'string' || airportId.trim().length === 0) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    const result = this.handleAirportPurchaseRequest(socketId, airportId);

    if (result && result.success) {
      const player = this.players.get(socketId);
      const assetName = resolveAirportAssetName(result.airportId);

      this.emitGameEventToPlayer(socketId, 'asset:transaction', {
        action: 'purchased-from-game',
        assetType: 'airport',
        assetId: result.airportId,
        assetName,
        quantity: 1,
        totalAmount: result.pricePaid
      }, {
        gameId: player && player.gameId ? player.gameId : null,
        actorPlayerId: player && player.id ? player.id : socketId
      });
    }

    return result;
  }

  handleAirportListingRequest(socketId, airportId, askingPrice) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.listAirportForSale(player.id, airportId, askingPrice);
  }

  handleAirportListingSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const airportId = requestPayload ? requestPayload.airportId : undefined;
    const askingPrice = requestPayload ? requestPayload.askingPrice : undefined;

    if (typeof airportId !== 'string' || airportId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid airportId.'
      };
    }

    if (typeof askingPrice !== 'number' || !Number.isFinite(askingPrice)) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a finite askingPrice.'
      };
    }

    const result = this.handleAirportListingRequest(socketId, airportId, askingPrice);

    if (result && result.success) {
      const player = this.players.get(socketId);
      const assetName = resolveAirportAssetName(result.airportId);

      this.emitGameEventToPlayer(socketId, 'asset:listing', {
        action: 'listed',
        assetType: 'airport',
        assetId: result.airportId,
        assetName,
        askingPrice
      }, {
        gameId: player && player.gameId ? player.gameId : null,
        actorPlayerId: player && player.id ? player.id : socketId
      });
    }

    return result;
  }

  handleAirportListingCancelRequest(socketId, airportId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.cancelAirportListing(player.id, airportId);
  }

  handleAirportListingCancelSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const airportId = requestPayload ? requestPayload.airportId : undefined;

    if (typeof airportId !== 'string' || airportId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid airportId.'
      };
    }

    return this.handleAirportListingCancelRequest(socketId, airportId);
  }

  handleAirportListedPurchaseRequest(socketId, airportId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.purchaseListedAirport(player.id, airportId);
  }

  handleAirportListedPurchaseSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const airportId = requestPayload ? requestPayload.airportId : undefined;

    if (typeof airportId !== 'string' || airportId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid airportId.'
      };
    }

    const result = this.handleAirportListedPurchaseRequest(socketId, airportId);

    if (result && result.success) {
      const buyerPlayer = this.players.get(socketId);
      const gameId = buyerPlayer && buyerPlayer.gameId ? buyerPlayer.gameId : null;
      const game = gameId ? this.games.get(gameId) : null;
      const assetName = resolveAirportAssetName(result.airportId);
      const buyerName = resolvePlayerDisplayNameFromGame(game, result.buyerPlayerId);
      const sellerName = resolvePlayerDisplayNameFromGame(game, result.sellerPlayerId);

      this.emitGameEventToPlayer(socketId, 'asset:transaction', {
        action: 'purchased-from-player',
        assetType: 'airport',
        assetId: result.airportId,
        assetName,
        quantity: 1,
        totalAmount: result.pricePaid,
        counterpartyPlayerId: result.sellerPlayerId,
        counterpartyName: sellerName
      }, {
        gameId,
        actorPlayerId: result.buyerPlayerId
      });

      const sellerSocketEntry = Array.from(this.players.entries()).find(([, player]) => {
        return player && player.id === result.sellerPlayerId && player.gameId === gameId;
      });

      if (sellerSocketEntry) {
        const [sellerSocketId] = sellerSocketEntry;
        this.emitGameEventToPlayer(sellerSocketId, 'asset:transaction', {
          action: 'sold-to-player',
          assetType: 'airport',
          assetId: result.airportId,
          assetName,
          quantity: 1,
          totalAmount: result.pricePaid,
          counterpartyPlayerId: result.buyerPlayerId,
          counterpartyName: buyerName
        }, {
          gameId,
          actorPlayerId: result.sellerPlayerId
        });
      }
    }

    return result;
  }

  handleAirportSellToGameRequest(socketId, airportId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.sellAirportToGame(player.id, airportId);
  }

  handleAirportSellToGameSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const airportId = requestPayload ? requestPayload.airportId : undefined;

    if (typeof airportId !== 'string' || airportId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid airportId.'
      };
    }

    const result = this.handleAirportSellToGameRequest(socketId, airportId);

    if (result && result.success) {
      const player = this.players.get(socketId);
      const assetName = resolveAirportAssetName(result.airportId);

      this.emitGameEventToPlayer(socketId, 'asset:transaction', {
        action: 'sold-to-game',
        assetType: 'airport',
        assetId: result.airportId,
        assetName,
        quantity: 1,
        totalAmount: result.refundAmount
      }, {
        gameId: player && player.gameId ? player.gameId : null,
        actorPlayerId: player && player.id ? player.id : socketId
      });
    }

    return result;
  }

  handleRouteCreateRequest(socketId, originAirportId, destinationAirportId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.createRoute(player.id, originAirportId, destinationAirportId);
  }

  handleRouteCreateSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const originAirportId = requestPayload ? requestPayload.originAirportId : undefined;
    const destinationAirportId = requestPayload ? requestPayload.destinationAirportId : undefined;

    if (typeof originAirportId !== 'string' || originAirportId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid originAirportId.'
      };
    }

    if (typeof destinationAirportId !== 'string' || destinationAirportId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid destinationAirportId.'
      };
    }

    return this.handleRouteCreateRequest(socketId, originAirportId, destinationAirportId);
  }

  handleRouteRemoveRequest(socketId, routeId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.removeRoute(player.id, routeId);
  }

  handleRouteRemoveSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const routeId = requestPayload ? requestPayload.routeId : undefined;

    if (typeof routeId !== 'string' || routeId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid routeId.'
      };
    }

    return this.handleRouteRemoveRequest(socketId, routeId);
  }

  handleRouteAircraftAssignRequest(socketId, routeId, aircraftInstanceId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.assignAircraftToRoute(player.id, routeId, aircraftInstanceId);
  }

  handleRouteAircraftAssignSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const routeId = requestPayload ? requestPayload.routeId : undefined;
    const aircraftInstanceId = requestPayload ? requestPayload.aircraftInstanceId : undefined;

    if (typeof routeId !== 'string' || routeId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid routeId.'
      };
    }

    if (typeof aircraftInstanceId !== 'string' || aircraftInstanceId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid aircraftInstanceId.'
      };
    }

    return this.handleRouteAircraftAssignRequest(socketId, routeId, aircraftInstanceId);
  }

  handleRouteAircraftUnassignRequest(socketId, aircraftInstanceId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.unassignAircraftFromRoute(player.id, aircraftInstanceId);
  }

  handleRouteAircraftUnassignSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const aircraftInstanceId = requestPayload ? requestPayload.aircraftInstanceId : undefined;

    if (typeof aircraftInstanceId !== 'string' || aircraftInstanceId.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_REQUEST',
        message: 'Request must include a valid aircraftInstanceId.'
      };
    }

    return this.handleRouteAircraftUnassignRequest(socketId, aircraftInstanceId);
  }

  handleAircraftPurchaseRequest(socketId, aircraftCatalogId, quantity = 1) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.purchaseAircraftFromGame(player.id, aircraftCatalogId, quantity);
  }

  handleAircraftPurchaseQuoteRequest(socketId, aircraftCatalogId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.getAircraftPurchaseQuote(player.id, aircraftCatalogId);
  }

  handleAircraftSellQuoteRequest(socketId, aircraftCatalogId) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.getAircraftSellQuote(player.id, aircraftCatalogId);
  }

  handleAircraftSellRequest(socketId, aircraftCatalogId, quantity = 1) {
    const player = this.players.get(socketId);
    if (!player || !player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const gameId = this.playerGameIds.get(socketId) || player.gameId;
    if (!gameId || gameId !== player.gameId) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    const game = this.games.get(gameId);
    if (!game || !game.players.has(player.id)) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player is not in an active game.'
      };
    }

    return game.sellAircraftToGame(player.id, aircraftCatalogId, quantity);
  }

  emitGameEventToPlayer(socketId, eventType, data, options = {}) {
    if (typeof socketId !== 'string' || socketId.trim().length === 0) {
      return false;
    }

    if (typeof eventType !== 'string' || eventType.trim().length === 0) {
      return false;
    }

    const payload = {
      type: eventType,
      occurredAt: Number.isFinite(options.occurredAt) ? options.occurredAt : Date.now(),
      gameId: options.gameId || null,
      actorPlayerId: options.actorPlayerId || null,
      data: data && typeof data === 'object' ? { ...data } : data
    };

    this.io.to(socketId).emit('game:event', payload);
    return true;
  }

  handleAircraftPurchaseSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const aircraftCatalogId = requestPayload ? requestPayload.aircraftCatalogId : undefined;
    const quantity = requestPayload && requestPayload.quantity !== undefined ? requestPayload.quantity : 1;
    const quoteOnly = Boolean(requestPayload && requestPayload.quoteOnly === true);

    if (typeof aircraftCatalogId !== 'string' || aircraftCatalogId.trim().length === 0) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft was not found.'
      };
    }

    if (quoteOnly) {
      return this.handleAircraftPurchaseQuoteRequest(socketId, aircraftCatalogId);
    }

    const result = this.handleAircraftPurchaseRequest(socketId, aircraftCatalogId, quantity);

    if (result && result.success) {
      const player = this.players.get(socketId);
      const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(result.aircraftCatalogId || '')] || null;
      const assetName = aircraftDefinition
        ? `${aircraftDefinition.manufacturer} ${aircraftDefinition.model}`
        : String(result.aircraftCatalogId || 'Aircraft');

      this.emitGameEventToPlayer(socketId, 'asset:transaction', {
        action: 'purchased-from-game',
        assetType: 'aircraft',
        assetId: result.aircraftCatalogId,
        assetName,
        quantity: result.quantityPurchased,
        totalAmount: result.pricePaid
      }, {
        gameId: player && player.gameId ? player.gameId : null,
        actorPlayerId: player && player.id ? player.id : socketId
      });
    }

    return result;
  }

  handleAircraftSellSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const aircraftCatalogId = requestPayload ? requestPayload.aircraftCatalogId : undefined;
    const quantity = requestPayload && requestPayload.quantity !== undefined ? requestPayload.quantity : 1;
    const quoteOnly = Boolean(requestPayload && requestPayload.quoteOnly === true);

    if (typeof aircraftCatalogId !== 'string' || aircraftCatalogId.trim().length === 0) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft was not found.'
      };
    }

    if (quoteOnly) {
      return this.handleAircraftSellQuoteRequest(socketId, aircraftCatalogId);
    }

    const result = this.handleAircraftSellRequest(socketId, aircraftCatalogId, quantity);

    if (result && result.success) {
      const player = this.players.get(socketId);
      const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(result.aircraftCatalogId || '')] || null;
      const assetName = aircraftDefinition
        ? `${aircraftDefinition.manufacturer} ${aircraftDefinition.model}`
        : String(result.aircraftCatalogId || 'Aircraft');

      this.emitGameEventToPlayer(socketId, 'asset:transaction', {
        action: 'sold-to-game',
        assetType: 'aircraft',
        assetId: result.aircraftCatalogId,
        assetName,
        quantity: result.quantitySold,
        totalAmount: result.totalRefund
      }, {
        gameId: player && player.gameId ? player.gameId : null,
        actorPlayerId: player && player.id ? player.id : socketId
      });
    }

    return result;
  }

  shutdown() {
    this.lobbies.forEach((lobby) => {
      if (lobby.countdownInterval) {
        clearInterval(lobby.countdownInterval);
        lobby.countdownInterval = null;
      }
    });

    Array.from(this.games.keys()).forEach((gameId) => {
      this.destroyGame(gameId, 'shutdown');
    });

    Array.from(this.endedGameRetentionTimeoutIds.keys()).forEach((gameId) => {
      this.clearEndedGameRetentionTimer(gameId);
    });
  }
}

module.exports = GameManager;

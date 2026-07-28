const Player = require('./Player');
const Lobby = require('./Lobby');
const Game = require('./Game');
const { createGame } = require('./gameFactory');

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

class GameManager {
  constructor(io) {
    this.io = io;
    this.connections = new Map();
    this.lobbies = new Map();
    this.games = new Map();
    this.players = new Map();
    this.playerLobbyIds = new Map();
    this.playerGameIds = new Map();
  }

  registerConnection(socket) {
    this.connections.set(socket.id, socket);
    return socket;
  }

  createPlayer(socket, displayName = null) {
    const player = new Player(socket, displayName);
    this.players.set(player.id, player);
    return player;
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
    const adjectiveLookup = new Set(SILLY_ADJECTIVES.map((word) => word.toLowerCase()));
    const nounLookup = new Set(SILLY_NOUNS.map((word) => word.toLowerCase()));

    Array.from(lobby.players.values()).forEach((player) => {
      const displayName = player && typeof player.displayName === 'string' ? player.displayName : '';
      const normalizedName = displayName.trim().toLowerCase();
      if (!normalizedName) {
        return;
      }

      usedFullNames.add(normalizedName);

      const tokens = normalizedName.split(/\s+/).filter(Boolean);
      tokens.forEach((token) => {
        if (adjectiveLookup.has(token)) {
          usedAdjectives.add(token);
        }

        if (nounLookup.has(token)) {
          usedNouns.add(token);
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

    if (!lobby.addPlayer(player)) {
      return { success: false, message: 'Unable to join the lobby.' };
    }

    this.playerLobbyIds.set(socketId, lobby.id);
    player.socket.join(lobby.getRoomName());

    this.io.to(player.socket.id).emit('lobby:joined', {
      lobbyId: lobby.id,
      playerId: player.id,
      username: player.displayName
    });

    this.io.to(player.socket.id).emit('lobby:update', lobby.getPublicState());

    this.broadcastLobbyPreviews();
    return { success: true, lobby };
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
      player.socket.leave(lobby.getRoomName());
      player.socket.join(game.getRoomName());
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
      const game = this.games.get(player.gameId);
      if (game) {
        player.connected = false;
        player.socket = null;
        game.handlePlayerDisconnect(player.id);
      }
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

    return this.handleAirportPurchaseRequest(socketId, airportId);
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

    return this.handleAirportListingRequest(socketId, airportId, askingPrice);
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

    return this.handleAirportListedPurchaseRequest(socketId, airportId);
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

    return this.handleAirportSellToGameRequest(socketId, airportId);
  }

  handleAircraftPurchaseRequest(socketId, aircraftCatalogId) {
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

    return game.purchaseAircraftFromGame(player.id, aircraftCatalogId);
  }

  handleAircraftPurchaseSocketRequest(socketId, payload) {
    const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const aircraftCatalogId = requestPayload ? requestPayload.aircraftCatalogId : undefined;

    if (typeof aircraftCatalogId !== 'string' || aircraftCatalogId.trim().length === 0) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft was not found.'
      };
    }

    return this.handleAircraftPurchaseRequest(socketId, aircraftCatalogId);
  }

  shutdown() {
    this.lobbies.forEach((lobby) => {
      if (lobby.countdownInterval) {
        clearInterval(lobby.countdownInterval);
        lobby.countdownInterval = null;
      }
    });

    this.games.forEach((game) => {
      if (game && typeof game.dispose === 'function') {
        game.dispose();
      }
    });
  }
}

module.exports = GameManager;

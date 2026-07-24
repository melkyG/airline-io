const { uniqueNamesGenerator, adjectives, animals } = require('unique-names-generator');
const Player = require('./Player');
const Lobby = require('./Lobby');
const Game = require('./Game');
const { createGame } = require('./gameFactory');

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

  generateFunnyUsername() {
    const sillyAdjectives = ['Silly', 'Goofy', 'Clumsy', 'Sleepy', 'Wobbly', 'Dizzy', 'Muddy', 'Bouncy'];
    const sillyNouns = ['Goose', 'Noodle', 'Pancake', 'Penguin', 'Turnip', 'Muffin', 'Bean', 'Goblin'];
    const adjective = sillyAdjectives[Math.floor(Math.random() * sillyAdjectives.length)];
    const noun = sillyNouns[Math.floor(Math.random() * sillyNouns.length)];
    return `${adjective} ${noun}`;
  }

  normalizeUsername(username) {
    const trimmed = (username || '').trim();
    const sanitized = trimmed.replace(/[^A-Za-z0-9 _-]/g, '');
    const cleaned = sanitized.slice(0, 25);
    return cleaned || this.generateFunnyUsername();
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

    const usernameTaken = Array.from(lobby.players.values()).some((existingPlayer) => {
      return existingPlayer.displayName.trim().toLowerCase() === normalizedUsername.trim().toLowerCase();
    });

    if (usernameTaken) {
      return { success: false, message: 'That username is already being used in this lobby.' };
    }

    let player = this.players.get(socketId);
    if (!player) {
      player = this.createPlayer(socket, normalizedUsername);
      this.connections.delete(socketId);
    } else {
      player.setDisplayName(normalizedUsername);
    }

    if (!lobby.addPlayer(player)) {
      return { success: false, message: 'Unable to join the lobby.' };
    }

    this.playerLobbyIds.set(socketId, lobby.id);
    player.socket.join(lobby.getRoomName());

    this.io.to(player.socket.id).emit('lobby:joined', {
      lobbyId: lobby.id,
      playerId: player.id
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

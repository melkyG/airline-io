class Lobby {
  constructor(id, manager) {
    this.id = id;
    this.status = 'waiting';
    this.maxPlayers = 5;
    this.players = new Map();
    this.countdownRemaining = null;
    this.countdownInterval = null;
    this.createdAt = Date.now();
    this.manager = manager;
  }

  isJoinable() {
    return this.status === 'waiting' && this.players.size < this.maxPlayers;
  }

  addPlayer(player) {
    if (!this.isJoinable()) {
      return false;
    }

    if (this.players.has(player.id)) {
      return false;
    }

    player.lobbyId = this.id;
    this.players.set(player.id, player);

    this.broadcastState();
    this.manager.broadcastLobbyPreviews();

    if (this.isReadyToStart()) {
      this.startCountdown();
    }

    return true;
  }

  removePlayer(playerId, isDisconnect = false) {
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }

    this.players.delete(playerId);
    player.lobbyId = null;
    player.connected = isDisconnect ? false : true;

    if (player.socket && player.socket.connected) {
      player.socket.leave(this.getRoomName());
    }

    if (this.countdownInterval) {
      this.cancelCountdown();
    }

    this.broadcastState();
    this.manager.broadcastLobbyPreviews();

    if (this.players.size === 0) {
      this.manager.removeLobby(this.id);
    }

    return true;
  }

  startCountdown() {
    if (this.countdownInterval || !this.isReadyToStart()) {
      return;
    }

    this.status = 'countdown';
    this.countdownRemaining = 5;
    this.broadcastState();
    this.broadcastCountdown(this.countdownRemaining);

    this.countdownInterval = setInterval(() => {
      this.countdownRemaining -= 1;

      if (this.countdownRemaining > 0) {
        this.broadcastCountdown(this.countdownRemaining);
        return;
      }

      clearInterval(this.countdownInterval);
      this.countdownInterval = null;

      if (this.isReadyToStart()) {
        this.manager.convertLobbyToGame(this.id);
      } else {
        this.status = 'waiting';
        this.countdownRemaining = null;
        this.broadcastState();
        this.manager.broadcastLobbyPreviews();
      }
    }, 1000);
  }

  cancelCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.status = 'waiting';
    this.countdownRemaining = null;
    this.broadcastState();
    this.manager.broadcastLobbyPreviews();
    this.manager.io.to(this.getRoomName()).emit('lobby:countdown-cancelled', {
      lobbyId: this.id,
      message: 'Countdown cancelled.'
    });
  }

  broadcastState() {
    this.manager.io.to(this.getRoomName()).emit('lobby:update', this.getPublicState());
  }

  broadcastCountdown(secondsRemaining) {
    this.manager.io.to(this.getRoomName()).emit('lobby:countdown', {
      lobbyId: this.id,
      secondsRemaining
    });
  }

  getRoomName() {
    return `lobby:${this.id}`;
  }

  getPublicState() {
    return {
      lobbyId: this.id,
      status: this.status,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      players: Array.from(this.players.values()).map((player) => player.getPublicState()),
      countdown: this.countdownRemaining
    };
  }

  getPlayerCount() {
    return this.players.size;
  }

  isReadyToStart() {
    return this.players.size === this.maxPlayers;
  }
}

module.exports = Lobby;

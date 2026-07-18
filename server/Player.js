class Player {
  constructor(socket, displayName = null) {
    this.id = socket.id;
    this.displayName = displayName || `Player ${socket.id.slice(0, 4)}`;
    this.joinedAt = Date.now();
    this.connected = true;
    this.score = 0;
    this.socket = socket;
    this.lobbyId = null;
    this.gameId = null;
  }

  setDisplayName(name) {
    this.displayName = name;
  }

  getPublicState() {
    return {
      id: this.id,
      displayName: this.displayName,
      connected: this.connected
    };
  }
}

module.exports = Player;

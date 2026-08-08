class Player {
  constructor(socketOrOptions, displayName = null) {
    const options =
      socketOrOptions && typeof socketOrOptions === 'object' && Object.prototype.hasOwnProperty.call(socketOrOptions, 'socket')
        ? socketOrOptions
        : {
            socket: socketOrOptions,
            displayName,
            isBot: false
          };

    const socket = options.socket || null;
    const providedId = options.id != null ? String(options.id) : null;
    const fallbackSocketId = socket && socket.id != null ? String(socket.id) : null;

    this.id = providedId || fallbackSocketId || `player-${Date.now().toString(36)}`;
    this.displayName = options.displayName || `Player ${this.id.slice(0, 4)}`;
    this.joinedAt = Date.now();
    this.connected = options.connected == null ? true : Boolean(options.connected);
    this.colorId = options.colorId || null;
    this.colorHex = options.colorHex || null;
    this.socket = socket;
    this.lobbyId = null;
    this.gameId = null;
    this.isBot = Boolean(options.isBot);
  }

  setDisplayName(name) {
    this.displayName = name;
  }

  getPublicState() {
    return {
      id: this.id,
      displayName: this.displayName,
      connected: this.connected,
      isBot: this.isBot,
      colorId: this.colorId,
      colorHex: this.colorHex
    };
  }
}

module.exports = Player;

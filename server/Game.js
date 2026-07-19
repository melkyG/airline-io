class Game {
  constructor(initialState, manager) {
    this.id = initialState.id;
    this.status = initialState.status;
    this.players = new Map();
    this.createdAt = initialState.createdAt;
    this.authoritativeState = initialState;
    this.gameState = {
      mapPlaceholder: 'Map Placeholder'
    };
    this.manager = manager;
  }

  initialize() {
    Array.from(this.players.values()).forEach((player) => {
      player.gameId = this.id;
      player.lobbyId = null;
    });

    this.broadcastState();
  }

  getPublicState() {
    return {
      game: {
        ...this.authoritativeState,
        players: this.authoritativeState.players.map((player) => ({ ...player })),
        airports: this.authoritativeState.airports.map((airport) => ({ ...airport }))
      }
    };
  }

  broadcastState() {
    this.manager.io.to(this.getRoomName()).emit('game:started', this.getPublicState());
  }

  getRoomName() {
    return `game:${this.id}`;
  }

  handlePlayerDisconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    player.connected = false;
    this.broadcastState();
  }
}

module.exports = Game;

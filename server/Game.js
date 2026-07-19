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

  buildLeaderboard() {
    return Array.from(this.players.values())
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player, index) => ({
        playerId: player.id,
        displayName: player.displayName,
        score: player.score,
        connected: player.connected,
        rank: index + 1
      }));
  }

  getPublicState() {
    return {
      gameId: this.id,
      status: this.status,
      mapPlaceholder: this.gameState.mapPlaceholder,
      leaderboard: this.buildLeaderboard()
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

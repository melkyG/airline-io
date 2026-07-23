class Game {
  constructor(initialState, manager) {
    this.id = initialState.id;
    this.status = initialState.status;
    this.players = new Map();
    this.createdAt = initialState.createdAt;
    this.authoritativeState = {
      ...initialState,
      status: initialState.status
    };
    this.endTimeoutId = null;
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

    this.scheduleExpirationTimeout();

    if (!this.checkWinConditions()) {
      this.broadcastState();
    }
  }

  scheduleExpirationTimeout() {
    this.clearExpirationTimeout();

    if (this.status !== 'active' || !Number.isFinite(this.authoritativeState.endsAt)) {
      return;
    }

    const delayMs = Math.max(0, this.authoritativeState.endsAt - Date.now());
    this.endTimeoutId = setTimeout(() => {
      this.checkWinConditions();
    }, delayMs);
  }

  clearExpirationTimeout() {
    if (!this.endTimeoutId) {
      return;
    }

    clearTimeout(this.endTimeoutId);
    this.endTimeoutId = null;
  }

  endGame(reason) {
    if (this.status !== 'active') {
      return false;
    }

    this.status = 'ended';
    this.authoritativeState.status = 'ended';
    this.authoritativeState.endReason = reason;
    this.authoritativeState.endedAt = Date.now();
    this.generateResults();
    this.clearExpirationTimeout();
    this.broadcastState();
    return true;
  }

  createCoinFlipValue(bitCount = 16) {
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
      value = (value << 1) | (Math.random() < 0.5 ? 0 : 1);
    }

    return value;
  }

  generateResults() {
    if (this.authoritativeState.results) {
      return this.authoritativeState.results;
    }

    const sourcePlayers = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const rankedPlayers = sourcePlayers
      .map((player) => {
        const score = Number.isFinite(player.score) ? player.score : 0;
        const capital = Number.isFinite(player.capital) ? player.capital : 0;
        return {
          id: player.id,
          username: player.username,
          score,
          capital,
          tieBreaker: this.createCoinFlipValue()
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (right.capital !== left.capital) {
          return right.capital - left.capital;
        }

        if (right.tieBreaker !== left.tieBreaker) {
          return right.tieBreaker - left.tieBreaker;
        }

        return String(left.id).localeCompare(String(right.id));
      });

    const standings = rankedPlayers.map((player, index) => ({
      rank: index + 1,
      id: player.id,
      username: player.username,
      score: player.score,
      capital: player.capital
    }));

    const winner = standings.length > 0 ? { ...standings[0] } : null;
    const results = {
      winner,
      standings,
      generatedAt: Date.now()
    };

    this.authoritativeState.results = results;
    return results;
  }

  checkWinConditions() {
    if (this.status !== 'active') {
      return false;
    }

    const scoreToWin = this.authoritativeState.scoreToWin;
    if (Number.isFinite(scoreToWin) && scoreToWin > 0) {
      const scoreReached = this.authoritativeState.players.some((player) => {
        const playerScore = Number.isFinite(player.score) ? player.score : 0;
        return playerScore >= scoreToWin;
      });

      if (scoreReached) {
        return this.endGame('score');
      }
    }

    if (Number.isFinite(this.authoritativeState.endsAt) && Date.now() >= this.authoritativeState.endsAt) {
      return this.endGame('time');
    }

    return false;
  }

  evaluateWinConditions() {
    return this.checkWinConditions();
  }

  addScore(playerId, amount) {
    if (this.status !== 'active') {
      return false;
    }

    const delta = Number.isFinite(amount) ? amount : 0;
    if (delta === 0) {
      return false;
    }

    const targetPlayer = this.authoritativeState.players.find((player) => player.id === playerId);
    if (!targetPlayer) {
      return false;
    }

    const currentScore = Number.isFinite(targetPlayer.score) ? targetPlayer.score : 0;
    targetPlayer.score = currentScore + delta;

    const runtimePlayer = this.players.get(playerId);
    if (runtimePlayer) {
      const runtimeScore = Number.isFinite(runtimePlayer.score) ? runtimePlayer.score : 0;
      runtimePlayer.score = runtimeScore + delta;
    }

    const ended = this.checkWinConditions();
    if (!ended) {
      this.broadcastState();
    }

    return true;
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

  dispose() {
    this.clearExpirationTimeout();
  }
}

module.exports = Game;

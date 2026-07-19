const { randomUUID } = require('node:crypto');

const STARTING_CAPITAL = 1000000;

function createGame(lobbyPlayers) {
  const players = Array.from(lobbyPlayers || []).map((player) => ({
    id: player.id,
    username: player.displayName,
    capital: STARTING_CAPITAL
  }));

  return {
    id: `game-${randomUUID()}`,
    status: 'active',
    createdAt: Date.now(),
    players,
    airports: []
  };
}

module.exports = {
  STARTING_CAPITAL,
  createGame
};

const { randomUUID } = require('node:crypto');

const STARTING_CAPITAL = 1000000;
const STARTING_SCORE = 0;
const GAME_DURATION_MS = 30 * 60 * 1000;
const SCORE_TO_WIN = 1000;

function createGame(lobbyPlayers) {
  const startedAt = Date.now();
  const players = Array.from(lobbyPlayers || []).map((player) => ({
    id: player.id,
    username: player.displayName,
    capital: STARTING_CAPITAL,
    score: STARTING_SCORE
  }));

  return {
    id: `game-${randomUUID()}`,
    status: 'active',
    createdAt: startedAt,
    startedAt,
    endsAt: startedAt + GAME_DURATION_MS,
    durationMs: GAME_DURATION_MS,
    scoreToWin: SCORE_TO_WIN,
    players,
    airports: []
  };
}

module.exports = {
  STARTING_CAPITAL,
  STARTING_SCORE,
  GAME_DURATION_MS,
  SCORE_TO_WIN,
  createGame
};

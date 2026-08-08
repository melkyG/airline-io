const { calculateNetWorthByPlayer } = require('./netWorth');

const NET_WORTH_SCORE_BASELINE = 1_000_000;
const NET_WORTH_SCORE_TARGET = 100_000_000_000;
const NET_WORTH_SCORE_TARGET_POINTS = 500;
const NET_WORTH_SCORE_RANGE = NET_WORTH_SCORE_TARGET - NET_WORTH_SCORE_BASELINE;

function getAuthoritativePlayers(gameState) {
  return gameState && Array.isArray(gameState.players) ? gameState.players : [];
}

function calculateNetWorthScore(netWorth) {
  const normalizedNetWorth = Number(netWorth);
  if (!Number.isFinite(normalizedNetWorth) || normalizedNetWorth <= NET_WORTH_SCORE_BASELINE) {
    return 0;
  }

  return (
    NET_WORTH_SCORE_TARGET_POINTS *
    (normalizedNetWorth - NET_WORTH_SCORE_BASELINE) /
    NET_WORTH_SCORE_RANGE
  );
}

function calculateDerivedGameplayScore(gameState, playerId) {
  const netWorthByPlayerId = calculateNetWorthByPlayer(gameState);
  const playerNetWorth = netWorthByPlayerId.has(playerId) ? netWorthByPlayerId.get(playerId) : 0;
  return calculateNetWorthScore(playerNetWorth);
}

function calculatePlayerScore(gameState, playerId) {
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) {
    return 0;
  }

  const players = getAuthoritativePlayers(gameState);
  const player = players.find((candidate) => String(candidate && candidate.id) === normalizedPlayerId);
  if (!player) {
    return 0;
  }

  const debugScoreOffset = Number.isFinite(player.debugScoreOffset) ? player.debugScoreOffset : 0;
  return calculateDerivedGameplayScore(gameState, normalizedPlayerId) + debugScoreOffset;
}

function calculateScoreByPlayer(gameState) {
  const scoresByPlayerId = new Map();
  const players = getAuthoritativePlayers(gameState);

  players.forEach((player) => {
    const playerId = String(player && player.id ? player.id : '').trim();
    if (!playerId) {
      return;
    }

    scoresByPlayerId.set(playerId, calculatePlayerScore(gameState, playerId));
  });

  return scoresByPlayerId;
}

module.exports = {
  NET_WORTH_SCORE_BASELINE,
  NET_WORTH_SCORE_TARGET,
  NET_WORTH_SCORE_TARGET_POINTS,
  calculateNetWorthScore,
  calculatePlayerScore,
  calculateScoreByPlayer
};
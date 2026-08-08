const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NET_WORTH_SCORE_BASELINE,
  NET_WORTH_SCORE_TARGET,
  NET_WORTH_SCORE_TARGET_POINTS,
  calculatePlayerScore,
  calculateNetWorthScore
} = require('../economy/score');

function expectedLinearNetWorthScore(netWorth) {
  if (!Number.isFinite(netWorth) || netWorth <= NET_WORTH_SCORE_BASELINE) {
    return 0;
  }

  return (
    NET_WORTH_SCORE_TARGET_POINTS *
    (netWorth - NET_WORTH_SCORE_BASELINE) /
    (NET_WORTH_SCORE_TARGET - NET_WORTH_SCORE_BASELINE)
  );
}

function createGameStateForCapital(capital, debugScoreOffset = 0) {
  return {
    players: [
      {
        id: 'p1',
        capital,
        debugScoreOffset
      }
    ],
    airports: [],
    ownedAircraft: []
  };
}

test('net worth score is 0 at exactly the $1M baseline', () => {
  const score = calculateNetWorthScore(1_000_000);
  assert.equal(score, 0);
});

test('net worth score is 0 below the $1M baseline', () => {
  const score = calculateNetWorthScore(500_000);
  assert.equal(score, 0);
});

test('net worth score is 500 at $100B anchor', () => {
  const score = calculateNetWorthScore(100_000_000_000);
  assert.equal(score, 500);
});

test('net worth score matches deterministic linear formula at an intermediate value', () => {
  const netWorth = 50_000_000_000;
  const expected = expectedLinearNetWorthScore(netWorth);
  const actual = calculateNetWorthScore(netWorth);

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('net worth score increases monotonically as net worth increases', () => {
  const lower = calculateNetWorthScore(1_000_000_000);
  const middle = calculateNetWorthScore(10_000_000_000);
  const higher = calculateNetWorthScore(50_000_000_000);

  assert.ok(lower > 0);
  assert.ok(middle > lower);
  assert.ok(higher > middle);
});

test('calculatePlayerScore uses net-worth gameplay score plus debug offset', () => {
  const gameState = createGameStateForCapital(1_000_000_000, 500);
  const expected = expectedLinearNetWorthScore(1_000_000_000) + 500;
  const actual = calculatePlayerScore(gameState, 'p1');

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('calculatePlayerScore ignores legacy stored player.score field', () => {
  const gameState = {
    players: [
      {
        id: 'p1',
        capital: 1_000_000,
        score: 999999,
        debugScoreOffset: 0
      }
    ],
    airports: [],
    ownedAircraft: []
  };

  assert.equal(calculatePlayerScore(gameState, 'p1'), 0);
});

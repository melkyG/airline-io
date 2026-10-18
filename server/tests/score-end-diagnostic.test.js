const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');
const { calculatePlayerScore } = require('../economy/score');

function createManager() {
  return {
    io: {
      to: () => ({
        emit: () => {},
        volatile: { emit: () => {} }
      })
    }
  };
}

function createBaseState(overrides = {}) {
  return {
    id: 'score-end-test',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 3_600_000,
    durationMs: 3_600_000,
    scoreToWin: 5,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 1,
    simulationEndedAtGameMs: null,
    players: [{ id: 'p1', username: 'Alice', capital: 0, debugScoreOffset: 0 }],
    airports: [],
    ownedAircraft: [],
    routes: [],
    flights: [],
    world: { countryProfitFactors: {} },
    ...overrides
  };
}

function captureLogs(fn) {
  const original = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return logs;
}

test('[SCORE-END] logged once with reconciled components at game end', () => {
  const game = new Game(createBaseState(), createManager());
  const logs = captureLogs(() => {
    game.addDebugScoreOffset('p1', 10);
  });

  const scoreLogs = logs.filter((line) => line.startsWith('[SCORE-END]'));
  assert.equal(scoreLogs.length, 1);

  const match = scoreLogs[0].match(
    /reason=([^\s]+) player=([^\s]+)\/([^\s]+) financial=([-\d.]+(?:e[+-]?\d+)?) airport=([-\d.]+(?:e[+-]?\d+)?) route=([-\d.]+(?:e[+-]?\d+)?) debug=([-\d.]+(?:e[+-]?\d+)?) total=([-\d.]+(?:e[+-]?\d+)?) threshold=([-\d.]+(?:e[+-]?\d+)?) aircraft=(\d+) routes=(\d+)/
  );
  assert.ok(match, `log format did not match: ${scoreLogs[0]}`);

  const [
    ,
    reason,
    playerId,
    username,
    financial,
    airport,
    route,
    debug,
    total,
    threshold,
    aircraft,
    routes
  ] = match;

  assert.equal(reason, 'score');
  assert.equal(playerId, 'p1');
  assert.equal(username, 'Alice');
  assert.equal(parseFloat(threshold), 5);
  assert.equal(parseFloat(debug), 10);
  assert.equal(parseInt(aircraft, 10), 0);
  assert.equal(parseInt(routes, 10), 0);
  assert.equal(parseFloat(total), calculatePlayerScore(game.authoritativeState, 'p1'));

  const componentSum =
    parseFloat(financial) +
    parseFloat(airport) +
    parseFloat(route) +
    parseFloat(debug);
  assert.ok(
    Math.abs(componentSum - parseFloat(total)) < 1e-9,
    `components reconcile: ${componentSum} vs ${total}`
  );
});

test('ordinary broadcasts and score recalculation do not emit [SCORE-END]', () => {
  const game = new Game(createBaseState({ scoreToWin: 1000 }), createManager());

  const logs = captureLogs(() => {
    calculatePlayerScore(game.authoritativeState, 'p1');
    game.broadcastState('OTHER');
  });

  assert.equal(logs.filter((line) => line.startsWith('[SCORE-END]')).length, 0);
});

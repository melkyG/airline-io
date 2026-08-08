const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');
const GameManager = require('../GameManager');

function createManagerWithEmitCapture() {
  const emitted = [];
  const manager = {
    io: {
      to(roomName) {
        return {
          emit(eventName, payload) {
            emitted.push({ roomName, eventName, payload });
          }
        };
      }
    }
  };

  return { manager, emitted };
}

function createActiveInitialState(overrides = {}) {
  return {
    id: 'game-simulation-clock',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
    airports: [],
    ownedAircraft: [],
    routes: [],
    ...overrides
  };
}

test('simulation clock anchors initialize when game starts', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createActiveInitialState(), manager);

  const beforeStartSnapshot = game.getSimulationClockSnapshot(5000);
  assert.equal(beforeStartSnapshot.simulationStartedAtRealMs, null);
  assert.equal(beforeStartSnapshot.simulationStartedAtGameMs, null);
  assert.equal(beforeStartSnapshot.simulationSpeedMultiplier, 10000);
  assert.equal(beforeStartSnapshot.simulationEndedAtGameMs, null);
  assert.equal(beforeStartSnapshot.simulationNowGameMs, null);

  game.initialize();

  assert.equal(Number.isFinite(game.authoritativeState.simulationStartedAtRealMs), true);
  assert.equal(Number.isFinite(game.authoritativeState.simulationStartedAtGameMs), true);
  assert.equal(game.authoritativeState.simulationSpeedMultiplier, 10000);
  assert.equal(game.authoritativeState.simulationEndedAtGameMs, null);
});

test('simulation helper math is deterministic and uses 10,000x speed', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createActiveInitialState({
    simulationStartedAtRealMs: 1000,
    simulationStartedAtGameMs: 5000,
    simulationSpeedMultiplier: 10000,
    simulationEndedAtGameMs: null
  }), manager);

  assert.equal(game.getSimulationTimeMs(1000), 5000);
  assert.equal(game.getSimulationTimeMs(1001), 15000);
  assert.equal(game.getSimulationTimeMs(2500), 15005000);
});

test('two games keep independent simulation clocks', () => {
  const { manager: managerA } = createManagerWithEmitCapture();
  const { manager: managerB } = createManagerWithEmitCapture();

  const gameA = new Game(createActiveInitialState({
    id: 'game-a',
    simulationStartedAtRealMs: 1000,
    simulationStartedAtGameMs: 10000,
    simulationSpeedMultiplier: 10000,
    simulationEndedAtGameMs: null
  }), managerA);

  const gameB = new Game(createActiveInitialState({
    id: 'game-b',
    simulationStartedAtRealMs: 2000,
    simulationStartedAtGameMs: 20000,
    simulationSpeedMultiplier: 10000,
    simulationEndedAtGameMs: null
  }), managerB);

  assert.equal(gameA.getSimulationTimeMs(3000), 20010000);
  assert.equal(gameB.getSimulationTimeMs(3000), 10020000);
  assert.notEqual(gameA.getSimulationTimeMs(3000), gameB.getSimulationTimeMs(3000));
});

test('simulation time freezes on end and repeated end calls preserve the frozen value', () => {
  const originalDateNow = Date.now;
  const { manager } = createManagerWithEmitCapture();

  try {
    Date.now = () => 2000;

    const game = new Game(createActiveInitialState({
      simulationStartedAtRealMs: 1000,
      simulationStartedAtGameMs: 5000,
      simulationSpeedMultiplier: 10000,
      simulationEndedAtGameMs: null
    }), manager);

    game.initialize();

    const expectedSimulationEndedAtGameMs = game.getSimulationTimeMs(2000);
    assert.equal(expectedSimulationEndedAtGameMs, 10005000);

    const ended = game.endGame('time');
    assert.equal(ended, true);
    assert.equal(game.authoritativeState.simulationEndedAtGameMs, expectedSimulationEndedAtGameMs);

    Date.now = () => 9000;
    assert.equal(game.getSimulationTimeMs(9000), expectedSimulationEndedAtGameMs);

    const secondEndAttempt = game.endGame('score');
    assert.equal(secondEndAttempt, false);
    assert.equal(game.authoritativeState.simulationEndedAtGameMs, expectedSimulationEndedAtGameMs);
  } finally {
    Date.now = originalDateNow;
  }
});

test('public snapshot includes simulationClock with simulationNowGameMs', () => {
  const originalDateNow = Date.now;
  const { manager } = createManagerWithEmitCapture();

  try {
    Date.now = () => 2000;

    const game = new Game(createActiveInitialState({
      simulationStartedAtRealMs: 1000,
      simulationStartedAtGameMs: 5000,
      simulationSpeedMultiplier: 10000,
      simulationEndedAtGameMs: null
    }), manager);

    const payload = game.getPublicState();
    assert.deepEqual(payload.game.simulationClock, {
      simulationStartedAtRealMs: 1000,
      simulationStartedAtGameMs: 5000,
      simulationSpeedMultiplier: 10000,
      simulationEndedAtGameMs: null,
      simulationNowGameMs: 10005000
    });
  } finally {
    Date.now = originalDateNow;
  }
});

test('simulation helper reads are pure and do not broadcast repeated game updates', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createActiveInitialState(), manager);

  game.initialize();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:started');

  game.getSimulationTimeMs();
  game.getSimulationClockSnapshot();
  game.getSimulationClockSnapshot();

  assert.equal(emitted.length, 1);
});

test('event log occurredAt stays on real system time in GameManager emission', () => {
  const originalDateNow = Date.now;
  const emitted = [];
  const io = {
    to(roomName) {
      return {
        emit(eventName, payload) {
          emitted.push({ roomName, eventName, payload });
        }
      };
    }
  };

  try {
    Date.now = () => 987654321;

    const manager = new GameManager(io);
    const emittedToPlayer = manager.emitGameEventToPlayer('socket-1', 'asset:transaction', { action: 'noop' });

    assert.equal(emittedToPlayer, true);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].eventName, 'game:event');
    assert.equal(emitted[0].payload.occurredAt, 987654321);
  } finally {
    Date.now = originalDateNow;
  }
});

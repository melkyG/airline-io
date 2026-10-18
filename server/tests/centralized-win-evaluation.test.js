const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');
const { createOwnedAircraftInstance } = require('../aircraft/ownership');

function createManagerWithEmitCapture() {
  const emitted = [];
  const manager = {
    io: {
      to(roomName) {
        return {
          emit(eventName, payload) {
            emitted.push({ roomName, eventName, payload });
          },
          volatile: {
            emit(eventName, payload) {
              emitted.push({ roomName, eventName, payload, volatile: true });
            }
          }
        };
      }
    }
  };
  return { manager, emitted };
}

function createBaseGameState(overrides = {}) {
  return {
    id: 'game-centralized-win',
    status: 'active',
    createdAt: Date.now(),
    startedAt: Date.now(),
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    players: [{ id: 'p1', username: 'Alice', capital: 1_000_000 }],
    airports: [],
    ownedAircraft: [],
    routes: [],
    flights: [],
    world: { countryProfitFactors: {} },
    ...overrides
  };
}

test('aircraft assignment raises Route Score across scoreToWin and ends the game', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const aircraft = createOwnedAircraftInstance({
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOMBARDIER_CRJ900'
  });
  const route = {
    routeId: 'route-1',
    ownerPlayerId: 'p1',
    originAirportId: 'ABJ',
    destinationAirportId: 'ACC',
    routeKey: 'ABJ-ACC',
    distanceKm: 200,
    assignedAircraftInstanceIds: [],
    reconfiguringModelCatalogIds: [],
    reconfigurationReferenceAircraftInstanceIds: {},
    pendingRemoval: false,
    modelEditLockedUntilRealMs: {}
  };

  const initialState = createBaseGameState({
    id: 'game-route-win',
    scoreToWin: 5,
    airports: [],
    ownedAircraft: [aircraft],
    routes: [route]
  });

  const game = new Game(initialState, manager);
  game.initialize();

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(game.status, 'active');

  const assignResult = game.assignAircraftToRoute('p1', route.routeId, aircraft.aircraftInstanceId);
  assert.equal(assignResult.success, true);

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].eventName, 'game:state');
  assert.equal(emitted[1].payload.game.status, 'ended');
});

test('airport purchase raises Airport Score across scoreToWin and ends the game', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = createBaseGameState({
    id: 'game-airport-win',
    scoreToWin: 15,
    players: [{ id: 'p1', username: 'Alice', capital: 100_000_000 }],
    airports: [{ airportId: 'ADD', ownerPlayerId: null, saleListing: null }]
  });

  const game = new Game(initialState, manager);
  game.initialize();

  assert.equal(emitted.length, 1);
  assert.equal(game.status, 'active');

  const purchaseResult = game.purchaseUnownedAirport('p1', 'ADD');
  assert.equal(purchaseResult.success, true);

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].eventName, 'game:state');
  assert.equal(emitted[1].payload.game.status, 'ended');
});

test('ordinary broadcast below scoreToWin stays active and emits one state', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = createBaseGameState({
    id: 'game-broadcast-active',
    scoreToWin: 1000
  });

  const game = new Game(initialState, manager);
  game.initialize();

  assert.equal(emitted.length, 1);
  assert.equal(game.status, 'active');

  game.broadcastState('OTHER');

  assert.equal(game.status, 'active');
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].eventName, 'game:state');
  assert.equal(emitted[1].payload.game.status, 'active');
});

test('centralized win check does not emit stale follow-up broadcasts after game ends', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const aircraft = createOwnedAircraftInstance({
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOMBARDIER_CRJ900'
  });
  const route = {
    routeId: 'route-stale',
    ownerPlayerId: 'p1',
    originAirportId: 'ABJ',
    destinationAirportId: 'ACC',
    routeKey: 'ABJ-ACC',
    distanceKm: 200,
    assignedAircraftInstanceIds: [],
    reconfiguringModelCatalogIds: [],
    reconfigurationReferenceAircraftInstanceIds: {},
    pendingRemoval: false,
    modelEditLockedUntilRealMs: {}
  };

  const initialState = createBaseGameState({
    id: 'game-stale-broadcast',
    scoreToWin: 5,
    airports: [
      { airportId: 'ABJ', ownerPlayerId: 'p1', saleListing: null },
      { airportId: 'ACC', ownerPlayerId: 'p1', saleListing: null }
    ],
    ownedAircraft: [aircraft],
    routes: [route]
  });

  const game = new Game(initialState, manager);
  game.initialize();
  game.assignAircraftToRoute('p1', route.routeId, aircraft.aircraftInstanceId);

  const endedAt = game.authoritativeState.endedAt;
  const emittedAfterWin = emitted.length;

  game.broadcastState('OTHER');

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endedAt, endedAt);
  assert.equal(emitted.length, emittedAfterWin);
});

test('flight/economy-derived score crosses scoreToWin despite FLIGHT_TICK broadcast throttling', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = createBaseGameState({
    id: 'game-flight-win',
    scoreToWin: 100,
    players: [{ id: 'p1', username: 'Alice', capital: 1_000_000 }]
  });

  const game = new Game(initialState, manager);
  game.initializeSimulationClock(Date.now());
  game.lastFlightStateBroadcastRealMs = Date.now();

  game.flightEngine = {
    processFlightSchedulerTick() {
      game.authoritativeState.players[0].capital = 100_000_000_000;
      return { changed: true };
    },
    getSimulationTimeMs(realNowMs) {
      return realNowMs;
    },
    countDueFlightTransitions() {
      return 0;
    },
    stopFlightScheduler() {}
  };

  const result = game.processFlightSchedulerTick(Date.now());

  assert.ok(result && typeof result === 'object');
  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.equal(emitted[0].payload.game.status, 'ended');
});

test('+500 debug score offset still ends the game via centralized score path', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = createBaseGameState({
    id: 'game-debug-win',
    scoreToWin: 500
  });

  const game = new Game(initialState, manager);
  game.initialize();

  assert.equal(emitted.length, 1);
  assert.equal(game.status, 'active');

  const updated = game.addDebugScoreOffset('p1', 500);
  assert.equal(updated, true);

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(emitted[1].eventName, 'game:state');
  assert.equal(emitted[1].payload.game.status, 'ended');
});

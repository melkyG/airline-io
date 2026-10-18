const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const GameManager = require('../GameManager');
const { canonicalRouteKey, calculateRouteDistanceKm } = require('../routes');
const { OWNED_AIRCRAFT_STATUS } = require('../aircraft/ownership');

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

function createGameState(overrides = {}) {
  return {
    id: 'game-route-1',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000 },
      { id: 'p2', username: 'Bob', capital: 1000000 }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      { airportId: 'JFK', ownerPlayerId: 'p1', saleListing: null }
    ],
    ownedAircraft: [],
    routes: [],
    flights: [],
    ...overrides
  };
}

test('createRoute creates a canonical route with authoritative distance and broadcasts once', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  const result = game.createRoute('p1', 'YYZ', 'JFK');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.ownerPlayerId, 'p1');
  assert.equal(result.originAirportId, 'YYZ');
  assert.equal(result.destinationAirportId, 'JFK');
  assert.equal(result.routeKey, canonicalRouteKey('YYZ', 'JFK'));
  assert.equal(result.distanceKm, calculateRouteDistanceKm({ lat: 43.6777, lng: -79.6248 }, { lat: 40.6413, lng: -73.7781 }));
  assert.deepEqual(result.assignedAircraftInstanceIds, []);
  assert.equal(game.authoritativeState.routes.length, 1);
  assert.equal(game.authoritativeState.routes[0].routeId, result.routeId);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.equal(emitted[0].payload.game.routes.length, 1);
});

test('createRoute validates player, airport ownership, duplicates, and invalid airports in order', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  const missingPlayerResult = game.createRoute('missing-player', 'YYZ', 'JFK');
  assert.equal(missingPlayerResult.success, false);
  assert.equal(missingPlayerResult.code, 'PLAYER_NOT_FOUND');

  const missingAirportResult = game.createRoute('p1', 'YYZ', 'MISSING');
  assert.equal(missingAirportResult.success, false);
  assert.equal(missingAirportResult.code, 'AIRPORT_NOT_FOUND');

  const sameAirportResult = game.createRoute('p1', 'YYZ', 'YYZ');
  assert.equal(sameAirportResult.success, false);
  assert.equal(sameAirportResult.code, 'SAME_AIRPORT');

  const notOwnedGame = new Game(
    createGameState({
      airports: [
        { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
        { airportId: 'JFK', ownerPlayerId: 'p2', saleListing: null }
      ]
    }),
    manager
  );
  const notOwnedResult = notOwnedGame.createRoute('p1', 'YYZ', 'JFK');
  assert.equal(notOwnedResult.success, false);
  assert.equal(notOwnedResult.code, 'AIRPORT_NOT_OWNED');

  const successResult = game.createRoute('p1', 'YYZ', 'JFK');
  assert.equal(successResult.success, true);

  const duplicateResult = game.createRoute('p1', 'JFK', 'YYZ');
  assert.equal(duplicateResult.success, false);
  assert.equal(duplicateResult.code, 'ROUTE_ALREADY_EXISTS');

  assert.equal(emitted.length, 1);
});

test('removeRoute removes an owned empty route and broadcasts once', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  const createdRoute = game.createRoute('p1', 'YYZ', 'JFK');
  assert.equal(createdRoute.success, true);

  emitted.length = 0;

  const result = game.removeRoute('p1', createdRoute.routeId);

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.routeId, createdRoute.routeId);
  assert.equal(result.ownerPlayerId, 'p1');
  assert.deepEqual(result.unassignedAircraftInstanceIds, []);
  assert.deepEqual(game.authoritativeState.routes, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.deepEqual(emitted[0].payload.game.routes, []);
});

test('removeRoute unassigns one aircraft before deleting route and broadcasts once', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: canonicalRouteKey('YYZ', 'JFK'),
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-1']
        }
      ],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
          assignedRouteId: 'route-1'
        }
      ]
    }),
    manager
  );

  const result = game.removeRoute('p1', 'route-1');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.routeId, 'route-1');
  assert.equal(result.ownerPlayerId, 'p1');
  assert.deepEqual(result.unassignedAircraftInstanceIds, ['acft-1']);
  assert.deepEqual(game.authoritativeState.routes, []);
  assert.equal(game.authoritativeState.ownedAircraft[0].status, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(game.authoritativeState.ownedAircraft[0].assignedRouteId, null);
  assert.deepEqual(game.authoritativeState.flights, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.deepEqual(emitted[0].payload.game.routes, []);
  assert.equal(emitted[0].payload.game.ownedAircraft[0].assignedRouteId, null);
  assert.deepEqual(emitted[0].payload.game.flights, []);
});

test('removeRoute unassigns multiple aircraft before deleting route and broadcasts once', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: canonicalRouteKey('YYZ', 'JFK'),
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-1', 'acft-2']
        }
      ],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        },
        {
          flightId: 'flight-2',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-2',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
          assignedRouteId: 'route-1'
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
          assignedRouteId: 'route-1'
        }
      ]
    }),
    manager
  );

  const result = game.removeRoute('p1', 'route-1');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.deepEqual(result.unassignedAircraftInstanceIds, ['acft-1', 'acft-2']);
  assert.deepEqual(game.authoritativeState.routes, []);
  assert.equal(game.authoritativeState.ownedAircraft[0].status, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(game.authoritativeState.ownedAircraft[1].status, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(game.authoritativeState.ownedAircraft[0].assignedRouteId, null);
  assert.equal(game.authoritativeState.ownedAircraft[1].assignedRouteId, null);
  assert.deepEqual(game.authoritativeState.flights, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.deepEqual(emitted[0].payload.game.routes, []);
  assert.equal(
    emitted[0].payload.game.ownedAircraft.some((aircraft) => aircraft.assignedRouteId === 'route-1'),
    false
  );
});

test('removeRoute validates missing routes, ownership, and player identity', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  const missingPlayerResult = game.removeRoute('missing-player', 'route-1');
  assert.equal(missingPlayerResult.success, false);
  assert.equal(missingPlayerResult.code, 'PLAYER_NOT_FOUND');

  const missingRouteResult = game.removeRoute('p1', 'route-missing');
  assert.equal(missingRouteResult.success, false);
  assert.equal(missingRouteResult.code, 'ROUTE_NOT_FOUND');

  const createdRoute = game.createRoute('p1', 'YYZ', 'JFK');
  assert.equal(createdRoute.success, true);

  const notOwnerResult = game.removeRoute('p2', createdRoute.routeId);
  assert.equal(notOwnerResult.success, false);
  assert.equal(notOwnerResult.code, 'NOT_ROUTE_OWNER');
});

test('removeRoute fails safely when assigned aircraft references are stale and leaves state unchanged', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: canonicalRouteKey('YYZ', 'JFK'),
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-missing']
        }
      ],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-missing',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
          assignedRouteId: 'route-1'
        }
      ]
    }),
    manager
  );

  const before = JSON.stringify(game.authoritativeState);
  const result = game.removeRoute('p1', 'route-1');

  assert.equal(result.success, false);
  assert.equal(result.code, 'ASSIGNED_AIRCRAFT_NOT_FOUND');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('removeRoute fails safely on route-aircraft mismatch and leaves state unchanged', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: canonicalRouteKey('YYZ', 'JFK'),
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-1']
        }
      ],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
          assignedRouteId: 'route-other'
        }
      ]
    }),
    manager
  );

  const before = JSON.stringify(game.authoritativeState);
  const result = game.removeRoute('p1', 'route-1');

  assert.equal(result.success, false);
  assert.equal(result.code, 'ASSIGNMENT_MISMATCH');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager route socket request handlers validate payloads and delegate without emitting game events', () => {
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

  const manager = new GameManager(io);
  manager.players.set('socket-1', {
    id: 'socket-1',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-1', 'game-1');

  const game = new Game(
    createGameState({
      players: [
        { id: 'socket-1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 1000000 }
      ],
      airports: [
        { airportId: 'YYZ', ownerPlayerId: 'socket-1', saleListing: null },
        { airportId: 'JFK', ownerPlayerId: 'socket-1', saleListing: null },
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const malformedPayloads = [
    null,
    {},
    { originAirportId: 'YYZ' },
    { destinationAirportId: 'JFK' },
    { originAirportId: 42, destinationAirportId: 'JFK' },
    { originAirportId: 'YYZ', destinationAirportId: [] }
  ];

  malformedPayloads.forEach((payload) => {
    const result = manager.handleRouteCreateSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  const createResult = manager.handleRouteCreateSocketRequest('socket-1', {
    originAirportId: 'YYZ',
    destinationAirportId: 'JFK'
  });

  assert.equal(createResult.success, true);
  assert.equal(createResult.code, 'OK');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 0);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);

  const removeMalformedPayloads = [null, {}, { routeId: 42 }, { routeId: '' }];
  removeMalformedPayloads.forEach((payload) => {
    const result = manager.handleRouteRemoveSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  const removeResult = manager.handleRouteRemoveSocketRequest('socket-1', {
    routeId: createResult.routeId
  });

  assert.equal(removeResult.success, true);
  assert.equal(removeResult.code, 'OK');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 0);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 2);
});

test('assignAircraftToRoute assigns an available owned aircraft atomically and broadcasts once', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
          assignedRouteId: null
        }
      ]
    }),
    manager
  );

  const routeResult = game.createRoute('p1', 'YYZ', 'JFK');
  assert.equal(routeResult.success, true);

  emitted.length = 0;

  const result = game.assignAircraftToRoute('p1', routeResult.routeId, 'acft-1');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.routeId, routeResult.routeId);
  assert.equal(result.aircraftInstanceId, 'acft-1');
  assert.equal(result.aircraftStatus, OWNED_AIRCRAFT_STATUS.ASSIGNED);
  assert.equal(result.assignedRouteId, routeResult.routeId);
  assert.deepEqual(result.assignedAircraftInstanceIds, ['acft-1']);

  assert.equal(game.authoritativeState.ownedAircraft[0].status, OWNED_AIRCRAFT_STATUS.ASSIGNED);
  assert.equal(game.authoritativeState.ownedAircraft[0].assignedRouteId, routeResult.routeId);
  assert.deepEqual(game.authoritativeState.routes[0].assignedAircraftInstanceIds, ['acft-1']);
  assert.equal(game.authoritativeState.flights.length, 1);
  assert.equal(game.authoritativeState.flights[0].ownerPlayerId, 'p1');
  assert.equal(game.authoritativeState.flights[0].routeId, routeResult.routeId);
  assert.equal(game.authoritativeState.flights[0].aircraftInstanceId, 'acft-1');
  assert.equal(game.authoritativeState.flights[0].originAirportId, 'YYZ');
  assert.equal(game.authoritativeState.flights[0].destinationAirportId, 'JFK');
  assert.equal(game.authoritativeState.flights[0].direction, 'outbound');
  assert.equal(game.authoritativeState.flights[0].status, 'ready');
  assert.equal(typeof game.authoritativeState.flights[0].flightId, 'string');
  assert.ok(game.authoritativeState.flights[0].flightId.startsWith('flight-'));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.equal(emitted[0].payload.game.flights.length, 1);
});

test('Airbus A320 assignment accepts a 5,700 km route and rejects a longer route', () => {
  const { manager } = createManagerWithEmitCapture();
  const createA320RouteGame = (distanceKm) => new Game(
    createGameState({
      routes: [{
        routeId: 'route-a320',
        ownerPlayerId: 'p1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: canonicalRouteKey('YYZ', 'JFK'),
        distanceKm,
        assignedAircraftInstanceIds: []
      }],
      ownedAircraft: [{
        aircraftInstanceId: 'acft-a320',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'AIRBUS_A320',
        acquisitionPrice: 280000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      }]
    }),
    manager
  );

  const atRangeGame = createA320RouteGame(5700);
  const atRangeResult = atRangeGame.assignAircraftToRoute('p1', 'route-a320', 'acft-a320');
  assert.equal(atRangeResult.success, true);
  assert.equal(atRangeGame.authoritativeState.flights[0].aircraftInstanceId, 'acft-a320');

  const beyondRangeGame = createA320RouteGame(5701);
  const beyondRangeResult = beyondRangeGame.assignAircraftToRoute('p1', 'route-a320', 'acft-a320');
  assert.equal(beyondRangeResult.success, false);
  assert.equal(beyondRangeResult.code, 'AIRCRAFT_RANGE_INSUFFICIENT');
});

test('assignAircraftToRoute validates player/route/aircraft existence, ownership, availability, assignment, and range with no mutation on failure', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const baseState = createGameState({
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000 },
      { id: 'p2', username: 'Bob', capital: 1000000 }
    ],
    routes: [
      {
        routeId: 'route-1',
        ownerPlayerId: 'p1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: canonicalRouteKey('YYZ', 'JFK'),
        distanceKm: 550,
        assignedAircraftInstanceIds: []
      },
      {
        routeId: 'route-long',
        ownerPlayerId: 'p1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: `${canonicalRouteKey('YYZ', 'JFK')}::long`,
        distanceKm: 7000,
        assignedAircraftInstanceIds: []
      },
      {
        routeId: 'route-2',
        ownerPlayerId: 'p2',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: `${canonicalRouteKey('YYZ', 'JFK')}::p2`,
        distanceKm: 550,
        assignedAircraftInstanceIds: []
      }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-ok',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      },
      {
        aircraftInstanceId: 'acft-busy-status',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.MAINTENANCE,
        assignedRouteId: null
      },
      {
        aircraftInstanceId: 'acft-busy-route',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: 'route-other'
      },
      {
        aircraftInstanceId: 'acft-foreign',
        ownerPlayerId: 'p2',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      },
      {
        aircraftInstanceId: 'acft-short-range',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_737',
        acquisitionPrice: 220000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      }
    ]
  });

  const game = new Game(baseState, manager);
  const before = JSON.stringify(game.authoritativeState);

  const checks = [
    { result: game.assignAircraftToRoute('missing', 'route-1', 'acft-ok'), code: 'PLAYER_NOT_FOUND' },
    { result: game.assignAircraftToRoute('p1', 'route-missing', 'acft-ok'), code: 'ROUTE_NOT_FOUND' },
    { result: game.assignAircraftToRoute('p1', 'route-1', 'acft-missing'), code: 'AIRCRAFT_NOT_FOUND' },
    { result: game.assignAircraftToRoute('p1', 'route-2', 'acft-ok'), code: 'NOT_ROUTE_OWNER' },
    { result: game.assignAircraftToRoute('p1', 'route-1', 'acft-foreign'), code: 'NOT_AIRCRAFT_OWNER' },
    { result: game.assignAircraftToRoute('p1', 'route-1', 'acft-busy-status'), code: 'AIRCRAFT_NOT_AVAILABLE' },
    { result: game.assignAircraftToRoute('p1', 'route-1', 'acft-busy-route'), code: 'AIRCRAFT_ALREADY_ASSIGNED' },
    { result: game.assignAircraftToRoute('p1', 'route-long', 'acft-short-range'), code: 'AIRCRAFT_RANGE_INSUFFICIENT' }
  ];

  checks.forEach(({ result, code }) => {
    assert.equal(result.success, false);
    assert.equal(result.code, code);
  });

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('unassignAircraftFromRoute restores aircraft availability and route list atomically with one broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: canonicalRouteKey('YYZ', 'JFK'),
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-1']
        }
      ],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
          assignedRouteId: 'route-1'
        }
      ]
    }),
    manager
  );

  const result = game.unassignAircraftFromRoute('p1', 'acft-1');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.routeId, 'route-1');
  assert.equal(result.aircraftInstanceId, 'acft-1');
  assert.equal(result.aircraftStatus, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(result.assignedRouteId, null);
  assert.deepEqual(result.assignedAircraftInstanceIds, []);

  assert.equal(game.authoritativeState.ownedAircraft[0].status, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(game.authoritativeState.ownedAircraft[0].assignedRouteId, null);
  assert.deepEqual(game.authoritativeState.routes[0].assignedAircraftInstanceIds, []);
  assert.deepEqual(game.authoritativeState.flights, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.deepEqual(emitted[0].payload.game.flights, []);
});

test('unassignAircraftFromRoute validates ownership and assignment preconditions with no mutation on failure', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const baseState = createGameState({
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000 },
      { id: 'p2', username: 'Bob', capital: 1000000 }
    ],
    routes: [
      {
        routeId: 'route-owned',
        ownerPlayerId: 'p1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: canonicalRouteKey('YYZ', 'JFK'),
        distanceKm: 550,
        assignedAircraftInstanceIds: []
      },
      {
        routeId: 'route-other-owner',
        ownerPlayerId: 'p2',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: `${canonicalRouteKey('YYZ', 'JFK')}::other`,
        distanceKm: 550,
        assignedAircraftInstanceIds: ['acft-other-route']
      }
    ],
    flights: [
      {
        flightId: 'flight-other-route',
        ownerPlayerId: 'p2',
        routeId: 'route-other-owner',
        aircraftInstanceId: 'acft-foreign-owner',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        direction: 'outbound',
        status: 'ready',
        departedAtSimulationMs: null,
        arrivesAtSimulationMs: null,
        nextTransitionAtSimulationMs: null
      },
      {
        flightId: 'flight-missing-link',
        ownerPlayerId: 'p1',
        routeId: 'route-owned',
        aircraftInstanceId: 'acft-missing-link',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        direction: 'outbound',
        status: 'ready',
        departedAtSimulationMs: null,
        arrivesAtSimulationMs: null,
        nextTransitionAtSimulationMs: null
      },
      {
        flightId: 'flight-other-route-owned',
        ownerPlayerId: 'p2',
        routeId: 'route-other-owner',
        aircraftInstanceId: 'acft-other-route',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        direction: 'outbound',
        status: 'ready',
        departedAtSimulationMs: null,
        arrivesAtSimulationMs: null,
        nextTransitionAtSimulationMs: null
      },
      {
        flightId: 'flight-route-missing',
        ownerPlayerId: 'p1',
        routeId: 'route-missing',
        aircraftInstanceId: 'acft-route-missing',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        direction: 'outbound',
        status: 'ready',
        departedAtSimulationMs: null,
        arrivesAtSimulationMs: null,
        nextTransitionAtSimulationMs: null
      }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-unassigned',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      },
      {
        aircraftInstanceId: 'acft-foreign-owner',
        ownerPlayerId: 'p2',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
        assignedRouteId: 'route-other-owner'
      },
      {
        aircraftInstanceId: 'acft-missing-link',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
        assignedRouteId: 'route-owned'
      },
      {
        aircraftInstanceId: 'acft-other-route',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
        assignedRouteId: 'route-other-owner'
      },
      {
        aircraftInstanceId: 'acft-route-missing',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
        assignedRouteId: 'route-missing'
      }
    ]
  });

  const game = new Game(baseState, manager);
  const before = JSON.stringify(game.authoritativeState);

  const checks = [
    { result: game.unassignAircraftFromRoute('missing', 'acft-unassigned'), code: 'PLAYER_NOT_FOUND' },
    { result: game.unassignAircraftFromRoute('p1', 'acft-missing'), code: 'AIRCRAFT_NOT_FOUND' },
    { result: game.unassignAircraftFromRoute('p1', 'acft-foreign-owner'), code: 'NOT_AIRCRAFT_OWNER' },
    { result: game.unassignAircraftFromRoute('p1', 'acft-unassigned'), code: 'AIRCRAFT_NOT_ASSIGNED' },
    { result: game.unassignAircraftFromRoute('p1', 'acft-route-missing'), code: 'ROUTE_NOT_FOUND' },
    { result: game.unassignAircraftFromRoute('p1', 'acft-other-route'), code: 'NOT_ROUTE_OWNER' },
    { result: game.unassignAircraftFromRoute('p1', 'acft-missing-link'), code: 'ASSIGNMENT_NOT_FOUND' }
  ];

  checks.forEach(({ result, code }) => {
    assert.equal(result.success, false);
    assert.equal(result.code, code);
  });

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager route-aircraft socket handlers validate payloads and delegate without game:event emissions', () => {
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

  const manager = new GameManager(io);
  manager.players.set('socket-1', {
    id: 'socket-1',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-1', 'game-1');

  const game = new Game(
    createGameState({
      players: [
        { id: 'socket-1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 1000000 }
      ],
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'socket-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: canonicalRouteKey('YYZ', 'JFK'),
          distanceKm: 550,
          assignedAircraftInstanceIds: []
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'socket-1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
          assignedRouteId: null
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const malformedAssignPayloads = [
    null,
    {},
    { routeId: 'route-1' },
    { aircraftInstanceId: 'acft-1' },
    { routeId: 42, aircraftInstanceId: 'acft-1' },
    { routeId: 'route-1', aircraftInstanceId: [] }
  ];

  malformedAssignPayloads.forEach((payload) => {
    const result = manager.handleRouteAircraftAssignSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  const assignResult = manager.handleRouteAircraftAssignSocketRequest('socket-1', {
    routeId: 'route-1',
    aircraftInstanceId: 'acft-1'
  });

  assert.equal(assignResult.success, true);
  assert.equal(assignResult.code, 'OK');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 0);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);

  const malformedUnassignPayloads = [null, {}, { aircraftInstanceId: 1 }, { aircraftInstanceId: '' }];
  malformedUnassignPayloads.forEach((payload) => {
    const result = manager.handleRouteAircraftUnassignSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  const unassignResult = manager.handleRouteAircraftUnassignSocketRequest('socket-1', {
    aircraftInstanceId: 'acft-1'
  });

  assert.equal(unassignResult.success, true);
  assert.equal(unassignResult.code, 'OK');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 0);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 2);
});

function createOwnedAirportStates(airportIds, ownerPlayerId = 'p1') {
  return airportIds.map((airportId) => ({
    airportId,
    ownerPlayerId,
    saleListing: null
  }));
}

function createSeededRoute(routeId, ownerPlayerId, originAirportId, destinationAirportId, overrides = {}) {
  return {
    routeId,
    ownerPlayerId,
    originAirportId,
    destinationAirportId,
    routeKey: `seeded-${routeId}`,
    distanceKm: 550,
    assignedAircraftInstanceIds: [],
    pendingRemoval: false,
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

test('createRoute enforces Cheap route capacity, consumes slots at both endpoints, and blocks when either endpoint is full', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'GOH', 'JFK', 'LAX', 'SIN', 'HND'])
    }),
    manager
  );

  assert.equal(game.createRoute('p1', 'JFK', 'YZF').success, true);
  assert.equal(game.createRoute('p1', 'YZF', 'LAX').success, true);
  assert.equal(game.createRoute('p1', 'YZF', 'SIN').success, true);

  const emittedBeforeReject = emitted.length;
  const stateBeforeReject = JSON.stringify(game.authoritativeState);
  const logs = captureLogs(() => {
    const rejected = game.createRoute('p1', 'YZF', 'HND');
    assert.equal(rejected.success, false);
    assert.equal(rejected.code, 'AIRPORT_ROUTE_CAPACITY_REACHED');
  });

  assert.equal(JSON.stringify(game.authoritativeState), stateBeforeReject);
  assert.equal(emitted.length, emittedBeforeReject);
  assert.equal(game.authoritativeState.routes.length, 3);

  const capacityLogs = logs.filter((line) => line.startsWith('[CAPACITY]'));
  assert.equal(capacityLogs.length, 1);
  assert.equal(capacityLogs[0], '[CAPACITY] Route creation blocked: YZF (Cheap) — 3/3 routes');

  const destinationBlocked = game.createRoute('p1', 'HND', 'YZF');
  assert.equal(destinationBlocked.success, false);
  assert.equal(destinationBlocked.code, 'AIRPORT_ROUTE_CAPACITY_REACHED');
  assert.equal(game.authoritativeState.routes.length, 3);

  assert.equal(game.createRoute('p1', 'GOH', 'JFK').success, true);
  assert.equal(game.createRoute('p1', 'GOH', 'LAX').success, true);
  assert.equal(game.createRoute('p1', 'GOH', 'SIN').success, true);
  const gohRejected = game.createRoute('p1', 'HND', 'GOH');
  assert.equal(gohRejected.success, false);
  assert.equal(gohRejected.code, 'AIRPORT_ROUTE_CAPACITY_REACHED');

  assert.equal(game.createRoute('p1', 'JFK', 'LAX').success, true);
});

test('createRoute counts pending-removal routes and ignores other players\' routes at each endpoint', () => {
  const { manager } = createManagerWithEmitCapture();
  const pendingRemovalGame = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK', 'LAX', 'SIN', 'HND']),
      routes: [
        createSeededRoute('r1', 'p1', 'YZF', 'JFK', { pendingRemoval: true }),
        createSeededRoute('r2', 'p1', 'YZF', 'LAX', { pendingRemoval: true }),
        createSeededRoute('r3', 'p1', 'YZF', 'SIN', { pendingRemoval: true })
      ]
    }),
    manager
  );

  const blocked = pendingRemovalGame.createRoute('p1', 'YZF', 'HND');
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, 'AIRPORT_ROUTE_CAPACITY_REACHED');
  assert.equal(pendingRemovalGame.authoritativeState.routes.length, 3);

  const otherPlayerGame = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK', 'LAX', 'SIN', 'HND', 'DXB']),
      routes: [
        createSeededRoute('r4', 'p2', 'YZF', 'JFK'),
        createSeededRoute('r5', 'p2', 'YZF', 'LAX'),
        createSeededRoute('r6', 'p2', 'YZF', 'SIN')
      ]
    }),
    manager
  );

  assert.equal(otherPlayerGame.createRoute('p1', 'YZF', 'JFK').success, true);
  assert.equal(otherPlayerGame.createRoute('p1', 'YZF', 'LAX').success, true);
  assert.equal(otherPlayerGame.createRoute('p1', 'YZF', 'SIN').success, true);
  const blockedAtLimit = otherPlayerGame.createRoute('p1', 'YZF', 'HND');
  assert.equal(blockedAtLimit.success, false);
  assert.equal(blockedAtLimit.code, 'AIRPORT_ROUTE_CAPACITY_REACHED');
  assert.equal(otherPlayerGame.authoritativeState.routes.length, 6);
});

test('createRoute applies each airport class limit (Standard airports allow 5 routes)', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['ACC', 'JFK', 'LAX', 'SIN', 'HND', 'DXB', 'ATL'])
    }),
    manager
  );

  ['JFK', 'LAX', 'SIN', 'HND', 'DXB'].forEach((destination) => {
    assert.equal(game.createRoute('p1', 'ACC', destination).success, true);
  });

  const rejected = game.createRoute('p1', 'ACC', 'ATL');
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, 'AIRPORT_ROUTE_CAPACITY_REACHED');
  assert.equal(game.authoritativeState.routes.length, 5);
});

function createAvailableAircraft(aircraftInstanceId, ownerPlayerId = 'p1', overrides = {}) {
  return {
    aircraftInstanceId,
    ownerPlayerId,
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null,
    ...overrides
  };
}

function createRouteFlightRecord(flightId, aircraftInstanceId, routeId, overrides = {}) {
  return {
    flightId,
    ownerPlayerId: 'p1',
    routeId,
    aircraftInstanceId,
    originAirportId: 'YYZ',
    destinationAirportId: 'JFK',
    direction: 'outbound',
    status: 'ready',
    departedAtSimulationMs: null,
    arrivesAtSimulationMs: null,
    nextTransitionAtSimulationMs: null,
    ...overrides
  };
}

test('assignAircraftToRoute enforces per-route aircraft capacity at the lower-capacity endpoint regardless of direction', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const ownedAircraft = [];
  for (let i = 1; i <= 11; i += 1) {
    ownedAircraft.push(createAvailableAircraft(`acft-${i}`));
  }
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK']),
      ownedAircraft
    }),
    manager
  );

  const routeResult = game.createRoute('p1', 'YZF', 'JFK');
  assert.equal(routeResult.success, true);

  for (let i = 1; i <= 10; i += 1) {
    const assignResult = game.assignAircraftToRoute('p1', routeResult.routeId, `acft-${i}`);
    assert.equal(assignResult.success, true);
  }

  const emittedBeforeReject = emitted.length;
  const stateBeforeReject = JSON.stringify(game.authoritativeState);
  const logs = captureLogs(() => {
    const rejected = game.assignAircraftToRoute('p1', routeResult.routeId, 'acft-11');
    assert.equal(rejected.success, false);
    assert.equal(rejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');
  });

  assert.equal(JSON.stringify(game.authoritativeState), stateBeforeReject);
  assert.equal(emitted.length, emittedBeforeReject);
  assert.equal(game.authoritativeState.routes[0].assignedAircraftInstanceIds.length, 10);

  const capacityLogs = logs.filter((line) => line.startsWith('[CAPACITY]'));
  assert.equal(capacityLogs.length, 1);
  assert.equal(
    capacityLogs[0],
    `[CAPACITY] Aircraft assignment blocked: route ${routeResult.routeId} — 10/10 aircraft`
  );

  const reversedGame = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK']),
      ownedAircraft: [createAvailableAircraft('acft-extra')]
    }),
    manager
  );
  const reversedRoute = reversedGame.createRoute('p1', 'JFK', 'YZF');
  assert.equal(reversedRoute.success, true);
  const authoritativeRoute = reversedGame.authoritativeState.routes.find(
    (route) => route.routeId === reversedRoute.routeId
  );
  authoritativeRoute.assignedAircraftInstanceIds = Array.from({ length: 10 }, (_, i) => `seeded-${i}`);
  const reversedRejected = reversedGame.assignAircraftToRoute('p1', reversedRoute.routeId, 'acft-extra');
  assert.equal(reversedRejected.success, false);
  assert.equal(reversedRejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');
});

test('assignAircraftToRoute uses each endpoint class limit (Standard ↔ Major = 25, Hub ↔ Elite = 200)', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['ACC', 'AKL', 'ORD', 'JFK']),
      routes: [
        createSeededRoute('route-standard-major', 'p1', 'ACC', 'AKL', {
          assignedAircraftInstanceIds: Array.from({ length: 25 }, (_, i) => `seeded-${i}`)
        }),
        createSeededRoute('route-hub-elite', 'p1', 'ORD', 'JFK', {
          assignedAircraftInstanceIds: Array.from({ length: 200 }, (_, i) => `seeded-${i}`)
        })
      ],
      ownedAircraft: [createAvailableAircraft('acft-1'), createAvailableAircraft('acft-2')]
    }),
    manager
  );

  const standardMajorRejected = game.assignAircraftToRoute('p1', 'route-standard-major', 'acft-1');
  assert.equal(standardMajorRejected.success, false);
  assert.equal(standardMajorRejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');

  const hubEliteRejected = game.assignAircraftToRoute('p1', 'route-hub-elite', 'acft-2');
  assert.equal(hubEliteRejected.success, false);
  assert.equal(hubEliteRejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');
});

test('assignAircraftToRoute counts flying, turnaround, pending-unassign, and pending-sale aircraft toward capacity', () => {
  const { manager } = createManagerWithEmitCapture();
  const assignedIds = Array.from({ length: 10 }, (_, i) => `acft-occupied-${i}`);
  const ownedAircraft = assignedIds.map((aircraftInstanceId, index) => {
    return createAvailableAircraft(aircraftInstanceId, 'p1', {
      status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
      assignedRouteId: 'route-1',
      pendingRouteExitAction: index === 2 ? 'unassign' : index === 3 ? 'sell' : undefined,
      pendingSaleRefund: index === 3 ? 240000 : undefined
    });
  });
  ownedAircraft.push(createAvailableAircraft('acft-new'));

  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK']),
      routes: [
        createSeededRoute('route-1', 'p1', 'YZF', 'JFK', {
          assignedAircraftInstanceIds: assignedIds
        })
      ],
      flights: assignedIds.map((aircraftInstanceId, index) => {
        return createRouteFlightRecord(`flight-${index}`, aircraftInstanceId, 'route-1', {
          status: index === 0 ? 'in-flight' : index === 1 ? 'turnaround' : 'ready'
        });
      }),
      ownedAircraft
    }),
    manager
  );

  const rejected = game.assignAircraftToRoute('p1', 'route-1', 'acft-new');
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');
  assert.equal(game.authoritativeState.routes[0].assignedAircraftInstanceIds.length, 10);
});

test('assignAircraftToRoute rejects pending-removal routes and fails closed on missing endpoints', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK']),
      routes: [
        createSeededRoute('route-pending', 'p1', 'YZF', 'JFK', { pendingRemoval: true }),
        createSeededRoute('route-missing-endpoint', 'p1', 'MISSING_AIRPORT', 'JFK')
      ],
      ownedAircraft: [createAvailableAircraft('acft-1'), createAvailableAircraft('acft-2')]
    }),
    manager
  );

  const pendingResult = game.assignAircraftToRoute('p1', 'route-pending', 'acft-1');
  assert.equal(pendingResult.success, false);
  assert.equal(pendingResult.code, 'ROUTE_REMOVAL_PENDING');

  const missingEndpointResult = game.assignAircraftToRoute('p1', 'route-missing-endpoint', 'acft-2');
  assert.equal(missingEndpointResult.success, false);
  assert.equal(missingEndpointResult.code, 'AIRPORT_NOT_FOUND');
});

test('assignAircraftToRouteBulk accepts a batch that exactly fills capacity and rejects one aircraft over', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const ownedAircraft = [];
  for (let i = 1; i <= 11; i += 1) {
    ownedAircraft.push(createAvailableAircraft(`acft-${i}`));
  }
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK']),
      ownedAircraft
    }),
    manager
  );

  const routeResult = game.createRoute('p1', 'YZF', 'JFK');
  assert.equal(routeResult.success, true);

  const fillResult = game.assignAircraftToRouteBulk(
    'p1',
    routeResult.routeId,
    Array.from({ length: 10 }, (_, i) => `acft-${i + 1}`)
  );
  assert.equal(fillResult.success, true);
  assert.equal(fillResult.assignedCount, 10);
  assert.equal(game.authoritativeState.routes[0].assignedAircraftInstanceIds.length, 10);

  const emittedBeforeReject = emitted.length;
  const stateBeforeReject = JSON.stringify(game.authoritativeState);
  const logs = captureLogs(() => {
    const rejected = game.assignAircraftToRouteBulk('p1', routeResult.routeId, ['acft-11']);
    assert.equal(rejected.success, false);
    assert.equal(rejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');
  });

  assert.equal(JSON.stringify(game.authoritativeState), stateBeforeReject);
  assert.equal(emitted.length, emittedBeforeReject);
  const capacityLogs = logs.filter((line) => line.startsWith('[CAPACITY]'));
  assert.equal(capacityLogs.length, 1);
  assert.equal(
    capacityLogs[0],
    `[CAPACITY] Bulk aircraft assignment blocked: route ${routeResult.routeId} — 10/10 aircraft, 1 requested`
  );
});

test('assignAircraftToRouteBulk counts existing allocations together with requested aircraft', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const ownedAircraft = [];
  for (let i = 1; i <= 4; i += 1) {
    ownedAircraft.push(createAvailableAircraft(`acft-${i}`));
  }
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK']),
      ownedAircraft
    }),
    manager
  );

  const routeResult = game.createRoute('p1', 'YZF', 'JFK');
  assert.equal(routeResult.success, true);
  const authoritativeRoute = game.authoritativeState.routes.find(
    (route) => route.routeId === routeResult.routeId
  );
  authoritativeRoute.assignedAircraftInstanceIds = Array.from({ length: 8 }, (_, i) => `occupied-${i}`);

  const rejected = game.assignAircraftToRouteBulk('p1', routeResult.routeId, [
    'acft-1',
    'acft-2',
    'acft-3'
  ]);
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');
  assert.equal(emitted.length, 1);

  const accepted = game.assignAircraftToRouteBulk('p1', routeResult.routeId, ['acft-1', 'acft-2']);
  assert.equal(accepted.success, true);
  assert.equal(authoritativeRoute.assignedAircraftInstanceIds.length, 10);
});

test('assignAircraftToRouteBulk enforces the lower-capacity endpoint (Standard ↔ Major = 25)', () => {
  const { manager } = createManagerWithEmitCapture();
  const ownedAircraft = Array.from({ length: 26 }, (_, i) => createAvailableAircraft(`acft-${i}`));
  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['ACC', 'AKL']),
      routes: [createSeededRoute('route-1', 'p1', 'ACC', 'AKL')],
      ownedAircraft
    }),
    manager
  );

  const fillResult = game.assignAircraftToRouteBulk(
    'p1',
    'route-1',
    Array.from({ length: 25 }, (_, i) => `acft-${i}`)
  );
  assert.equal(fillResult.success, true);
  assert.equal(fillResult.assignedCount, 25);

  const rejected = game.assignAircraftToRouteBulk('p1', 'route-1', ['acft-25']);
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');
});

test('assignAircraftToRouteBulk counts flying and pending-exit aircraft and fails closed on missing endpoints', () => {
  const { manager } = createManagerWithEmitCapture();
  const occupiedIds = Array.from({ length: 10 }, (_, i) => `occupied-${i}`);
  const ownedAircraft = occupiedIds.map((aircraftInstanceId, index) => {
    return createAvailableAircraft(aircraftInstanceId, 'p1', {
      status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
      assignedRouteId: 'route-1',
      pendingRouteExitAction: index === 0 ? 'unassign' : undefined
    });
  });
  ownedAircraft.push(createAvailableAircraft('acft-new'), createAvailableAircraft('acft-extra'));

  const game = new Game(
    createGameState({
      airports: createOwnedAirportStates(['YZF', 'JFK']),
      routes: [
        createSeededRoute('route-1', 'p1', 'YZF', 'JFK', {
          assignedAircraftInstanceIds: occupiedIds
        }),
        createSeededRoute('route-missing-endpoint', 'p1', 'MISSING_AIRPORT', 'JFK')
      ],
      flights: occupiedIds.map((aircraftInstanceId, index) => {
        return createRouteFlightRecord(`flight-${index}`, aircraftInstanceId, 'route-1', {
          status: index === 1 ? 'in-flight' : 'ready'
        });
      }),
      ownedAircraft
    }),
    manager
  );

  const occupiedRejected = game.assignAircraftToRouteBulk('p1', 'route-1', ['acft-new']);
  assert.equal(occupiedRejected.success, false);
  assert.equal(occupiedRejected.code, 'ROUTE_AIRCRAFT_CAPACITY_REACHED');

  const duplicateRejected = game.assignAircraftToRouteBulk('p1', 'route-1', ['acft-new', 'acft-new']);
  assert.equal(duplicateRejected.success, false);
  assert.equal(duplicateRejected.code, 'DUPLICATE_AIRCRAFT_IDS');

  const missingEndpointResult = game.assignAircraftToRouteBulk('p1', 'route-missing-endpoint', [
    'acft-new'
  ]);
  assert.equal(missingEndpointResult.success, false);
  assert.equal(missingEndpointResult.code, 'AIRPORT_NOT_FOUND');
});
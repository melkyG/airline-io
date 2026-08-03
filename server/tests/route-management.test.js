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
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
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
        { id: 'socket-1', username: 'Alice', capital: 1000000, score: 0 },
        { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
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

test('assignAircraftToRoute validates player/route/aircraft existence, ownership, availability, assignment, and range with no mutation on failure', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const baseState = createGameState({
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
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
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
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
        { id: 'socket-1', username: 'Alice', capital: 1000000, score: 0 },
        { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
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
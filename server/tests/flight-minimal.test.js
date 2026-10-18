const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
global.window = global;
require('../../client/map.js');

const Game = require('../Game');
const { AIRCRAFT_CATALOG, AIRCRAFT_CATALOG_BY_ID } = require('../aircraft/catalog');
const {
  calculateFlightDurationSimulationMs,
  calculateAircraftTurnaroundSimulationMs
} = require('../flights/rules');

const clientProjection = global.__airlineFlightProjection;

function createManagerWithEmitCapture() {
  const emitted = [];
  const manager = {
    io: {
      to(roomName) {
        const room = {
          emit(eventName, payload) {
            emitted.push({ roomName, eventName, payload });
          }
        };
        room.volatile = room;
        return room;
      }
    }
  };

  return { manager, emitted };
}

function createBaseState(overrides = {}) {
  return {
    id: 'game-flight-minimal',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 10000,
    simulationEndedAtGameMs: null,
    players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      { airportId: 'JFK', ownerPlayerId: 'p1', saleListing: null }
    ],
    routes: [
      {
        routeId: 'route-1',
        ownerPlayerId: 'p1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: 'JFK::YYZ',
        distanceKm: 900,
        assignedAircraftInstanceIds: ['acft-1']
      }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: 'assigned',
        assignedRouteId: 'route-1'
      }
    ],
    flights: [],
    ...overrides
  };
}

function createClientGame(routeOverrides = {}) {
  return {
    routes: [
      {
        routeId: 'route-1',
        ownerPlayerId: 'p1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        distanceKm: 900,
        ...routeOverrides
      }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747'
      }
    ],
    aircraftCatalog: AIRCRAFT_CATALOG
  };
}

function flightDurationMs() {
  return clientProjection.calculateClientFlightDurationSimulationMs(900, 900);
}

function turnaroundMs() {
  return clientProjection.calculateClientTurnaroundSimulationMs(900, 900);
}

function createPublicFlight(lastOutbound) {
  return {
    aircraftInstanceId: 'acft-1',
    routeId: 'route-1',
    lastOutboundDepartedAtSimulationMs: lastOutbound
  };
}

test('authoritative createReadyFlightRecord still returns full flight record', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);
  const route = game.authoritativeState.routes[0];
  const aircraft = game.authoritativeState.ownedAircraft[0];

  const record = game.createReadyFlightRecord(route, aircraft);

  assert.equal(record.ownerPlayerId, 'p1');
  assert.equal(record.routeId, 'route-1');
  assert.equal(record.aircraftInstanceId, 'acft-1');
  assert.equal(record.originAirportId, 'YYZ');
  assert.equal(record.destinationAirportId, 'JFK');
  assert.equal(record.direction, 'outbound');
  assert.equal(record.status, 'ready');
  assert.equal(record.lastOutboundDepartedAtSimulationMs, null);
  assert.ok(String(record.flightId).startsWith('flight-'));
});

test('createPublicFlightSnapshot returns exactly the three minimal fields', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  game.authoritativeState.flights = [
    game.createReadyFlightRecord(game.authoritativeState.routes[0], game.authoritativeState.ownedAircraft[0])
  ];

  const publicFlights = game.createPublicFlightSnapshot();

  assert.equal(publicFlights.length, 1);
  const publicFlight = publicFlights[0];
  assert.equal(Object.keys(publicFlight).length, 3);
  assert.equal(Object.keys(publicFlight).sort().join(','), 'aircraftInstanceId,lastOutboundDepartedAtSimulationMs,routeId');
  assert.equal(publicFlight.aircraftInstanceId, 'acft-1');
  assert.equal(publicFlight.routeId, 'route-1');
  assert.equal(publicFlight.lastOutboundDepartedAtSimulationMs, null);
});

test('createPublicFlightSnapshot does not mutate authoritative records', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  const authoritativeFlight = game.createReadyFlightRecord(game.authoritativeState.routes[0], game.authoritativeState.ownedAircraft[0]);
  game.authoritativeState.flights = [authoritativeFlight];

  const publicFlights = game.createPublicFlightSnapshot();

  assert.ok(publicFlights[0] !== authoritativeFlight);
  assert.ok(Object.keys(authoritativeFlight).length >= 11);
  assert.ok('flightId' in authoritativeFlight);
});

test('getPublicState flights contain only the three minimal fields after a scheduler tick', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  game.authoritativeState.flights = [
    game.createReadyFlightRecord(game.authoritativeState.routes[0], game.authoritativeState.ownedAircraft[0])
  ];

  game.processFlightSchedulerTick(1000);

  const publicState = game.getPublicState();
  const publicFlights = publicState.game.flights;

  assert.equal(publicFlights.length, 1);
  assert.equal(Object.keys(publicFlights[0]).length, 3);
  assert.equal(publicFlights[0].aircraftInstanceId, 'acft-1');
  assert.equal(publicFlights[0].routeId, 'route-1');
  assert.equal(Number.isFinite(publicFlights[0].lastOutboundDepartedAtSimulationMs), true);
});

test('client getProjectedInFlightLeg returns null for lastOutbound === null', () => {
  const game = createClientGame();
  const flight = createPublicFlight(null);
  const simNow = 5000;
  const result = clientProjection.getProjectedInFlightLeg(flight, game, simNow);
  assert.equal(result, null);
});

test('client getProjectedInFlightLeg projects outbound in-flight leg', () => {
  const game = createClientGame();
  const F = flightDurationMs();
  const lastOutbound = 5000;
  const simNow = lastOutbound + F / 2;
  const result = clientProjection.getProjectedInFlightLeg(createPublicFlight(lastOutbound), game, simNow);

  assert.notEqual(result, null);
  assert.equal(result.aircraftInstanceId, 'acft-1');
  assert.equal(result.direction, 'outbound');
  assert.equal(result.originAirportId, 'YYZ');
  assert.equal(result.destinationAirportId, 'JFK');
  assert.equal(result.departedAtSimulationMs, lastOutbound);
  assert.equal(result.arrivesAtSimulationMs, lastOutbound + F);
});

test('client getProjectedInFlightLeg returns null during outbound turnaround', () => {
  const game = createClientGame();
  const F = flightDurationMs();
  const T = turnaroundMs();
  const lastOutbound = 5000;
  const simNow = lastOutbound + F + T / 2;
  const result = clientProjection.getProjectedInFlightLeg(createPublicFlight(lastOutbound), game, simNow);
  assert.equal(result, null);
});

test('client getProjectedInFlightLeg projects inbound in-flight leg', () => {
  const game = createClientGame();
  const F = flightDurationMs();
  const T = turnaroundMs();
  const lastOutbound = 5000;
  const simNow = lastOutbound + F + T + F / 2;
  const result = clientProjection.getProjectedInFlightLeg(createPublicFlight(lastOutbound), game, simNow);

  assert.notEqual(result, null);
  assert.equal(result.aircraftInstanceId, 'acft-1');
  assert.equal(result.direction, 'inbound');
  assert.equal(result.originAirportId, 'JFK');
  assert.equal(result.destinationAirportId, 'YYZ');
  assert.equal(result.departedAtSimulationMs, lastOutbound + F + T);
  assert.equal(result.arrivesAtSimulationMs, lastOutbound + (2 * F) + T);
});

test('client getProjectedInFlightLeg returns null during inbound turnaround', () => {
  const game = createClientGame();
  const F = flightDurationMs();
  const T = turnaroundMs();
  const lastOutbound = 5000;
  const simNow = lastOutbound + (2 * F) + T + T / 2;
  const result = clientProjection.getProjectedInFlightLeg(createPublicFlight(lastOutbound), game, simNow);
  assert.equal(result, null);
});

test('client getProjectedInFlightLeg does not project a reconfiguring aircraft past its current round trip', () => {
  const game = createClientGame({
    reconfiguringModelCatalogIds: ['BOEING_747']
  });
  const F = flightDurationMs();
  const T = turnaroundMs();
  const lastOutbound = 5000;
  const fullRoundTrip = (2 * F) + (2 * T);

  const withinCurrentRoundTrip = clientProjection.getProjectedInFlightLeg(
    createPublicFlight(lastOutbound),
    game,
    lastOutbound + F + T + F / 2
  );
  assert.notEqual(withinCurrentRoundTrip, null);
  assert.equal(withinCurrentRoundTrip.direction, 'inbound');

  const afterCurrentRoundTrip = clientProjection.getProjectedInFlightLeg(
    createPublicFlight(lastOutbound),
    game,
    lastOutbound + fullRoundTrip + 1000
  );
  assert.equal(afterCurrentRoundTrip, null);
});

test('client getProjectedInFlightLeg continues non-reconfiguring cycles into the future', () => {
  const game = createClientGame();
  const F = flightDurationMs();
  const T = turnaroundMs();
  const lastOutbound = 5000;
  const fullRoundTrip = (2 * F) + (2 * T);

  const simNow = lastOutbound + fullRoundTrip + F / 2;
  const result = clientProjection.getProjectedInFlightLeg(createPublicFlight(lastOutbound), game, simNow);

  assert.notEqual(result, null);
  assert.equal(result.direction, 'outbound');
  assert.equal(result.departedAtSimulationMs, lastOutbound + fullRoundTrip);
});

test('assignment adds a public flight and unassignment removes it', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  game.authoritativeState.ownedAircraft.push({
    aircraftInstanceId: 'acft-2',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_737',
    acquisitionPrice: 220000,
    status: 'available',
    assignedRouteId: null
  });

  const assignResult = game.assignAircraftToRoute('p1', 'route-1', 'acft-2');
  assert.equal(assignResult.success, true);
  assert.equal(game.authoritativeState.flights.length, 1);

  const publicAfterAssign = game.createPublicFlightSnapshot();
  assert.equal(publicAfterAssign.some((flight) => flight.aircraftInstanceId === 'acft-2'), true);

  const detachResult = game.detachAircraftFromAssignment('acft-2');
  assert.equal(detachResult.success, true);

  const publicAfterDetach = game.createPublicFlightSnapshot();
  assert.equal(publicAfterDetach.some((flight) => flight.aircraftInstanceId === 'acft-2'), false);
});

test('public flight record never contains a flightId', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  game.authoritativeState.flights = [
    game.createReadyFlightRecord(game.authoritativeState.routes[0], game.authoritativeState.ownedAircraft[0])
  ];

  const publicState = game.getPublicState();
  for (const flight of publicState.game.flights) {
    assert.equal('flightId' in flight, false);
    assert.equal('status' in flight, false);
    assert.equal('direction' in flight, false);
    assert.equal('ownerPlayerId' in flight, false);
    assert.equal('originAirportId' in flight, false);
    assert.equal('destinationAirportId' in flight, false);
    assert.equal('departedAtSimulationMs' in flight, false);
    assert.equal('arrivesAtSimulationMs' in flight, false);
    assert.equal('nextTransitionAtSimulationMs' in flight, false);
  }
});

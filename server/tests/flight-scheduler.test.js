const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const { AIRCRAFT_CATALOG_BY_ID } = require('../aircraft/catalog');
const {
  TURNAROUND_REFERENCE_DISTANCE_KM,
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  calculateAircraftTurnaroundSimulationMs,
  calculateFlightDurationSimulationMs
} = require('../flights/rules');
const { calculateFlightSettlement } = require('../economy/flightSettlement');

function expectedSettledRevenue(game, route, baseRevenuePerKm, simulationNowMs = 0) {
  const baseRevenue = calculateFlightSettlement({
    baseRevenuePerKm,
    routeDistanceKm: route.distanceKm
  }).finalRevenue;
  return (
    baseRevenue *
    game.resolveRouteCountryProfitFactor(route, simulationNowMs) *
    game.resolveRouteAirportValueFactor(route)
  );
}

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
    id: 'game-flight-scheduler',
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
    ...overrides
  };
}

test('flight rules calculate duration from distance and speed without minimum clamp', () => {
  const veryShortRouteDuration = calculateFlightDurationSimulationMs(50, 900);
  const expectedShortDuration = (50 / 900) * 60 * 60 * 1000;
  assert.equal(veryShortRouteDuration, expectedShortDuration);

  const longRouteDuration = calculateFlightDurationSimulationMs(9000, 900);
  assert.equal(longRouteDuration, 10 * 60 * 60 * 1000);

  assert.equal(calculateFlightDurationSimulationMs(1000, 0), null);
  assert.equal(calculateFlightDurationSimulationMs(-1, 900), null);
});

test('aircraft turnaround calculation uses linear baseline and scales with distance', () => {
  const boeing747Turnaround = calculateAircraftTurnaroundSimulationMs(900, TURNAROUND_REFERENCE_DISTANCE_KM);
  const expected747Turnaround = (900 * (333 / 900)) * 60 * 1000;
  assert.equal(boeing747Turnaround, expected747Turnaround);
  assert.equal(boeing747Turnaround, 333 * 60 * 1000);

  const boeing737Turnaround = calculateAircraftTurnaroundSimulationMs(840, TURNAROUND_REFERENCE_DISTANCE_KM);
  const expected737Turnaround = (840 * (333 / 900)) * 60 * 1000;
  assert.equal(boeing737Turnaround, expected737Turnaround);
  assert.equal(boeing737Turnaround, 310.8 * 60 * 1000);

  const shortTurnaround = calculateAircraftTurnaroundSimulationMs(900, 500);
  const expectedShortTurnaround = 49.86675 * 60 * 1000;
  assert.ok(Math.abs(shortTurnaround - expectedShortTurnaround) < 1);

  const oneKTurnaround = calculateAircraftTurnaroundSimulationMs(900, 1000);
  const expectedOneKTurnaround = 64.7685 * 60 * 1000;
  assert.ok(Math.abs(oneKTurnaround - expectedOneKTurnaround) < 1);

  const halfDistanceTurnaround = calculateAircraftTurnaroundSimulationMs(900, TURNAROUND_REFERENCE_DISTANCE_KM / 2);
  const expectedHalfTurnaround = 183.9825 * 60 * 1000;
  assert.ok(Math.abs(halfDistanceTurnaround - expectedHalfTurnaround) < 1);
});

test('aircraft turnaround calculation fails for invalid speed or distance', () => {
  assert.equal(calculateAircraftTurnaroundSimulationMs(0, TURNAROUND_REFERENCE_DISTANCE_KM), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs(-1, TURNAROUND_REFERENCE_DISTANCE_KM), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs(null, TURNAROUND_REFERENCE_DISTANCE_KM), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs(undefined, TURNAROUND_REFERENCE_DISTANCE_KM), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs('invalid', TURNAROUND_REFERENCE_DISTANCE_KM), null);

  assert.equal(calculateAircraftTurnaroundSimulationMs(900, 0), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs(900, -1), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs(900, null), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs(900, undefined), null);
  assert.equal(calculateAircraftTurnaroundSimulationMs(900, 'invalid'), null);
});

test('scheduler processes ready flight into in-flight outbound with authoritative timing', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);
  const initialCapital = game.authoritativeState.players[0].capital;

  const tickResult = game.processFlightSchedulerTick(1000);
  const flight = game.authoritativeState.flights[0];
  const expectedDuration = calculateFlightDurationSimulationMs(900, 900);

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 1);
  assert.equal(flight.status, 'in-flight');
  assert.equal(flight.direction, 'outbound');
  assert.equal(flight.departedAtSimulationMs, 10000000);
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 10000000);
  assert.equal(flight.arrivesAtSimulationMs, 10000000 + expectedDuration);
  assert.equal(flight.nextTransitionAtSimulationMs, flight.arrivesAtSimulationMs);
  assert.equal(game.authoritativeState.players[0].capital, initialCapital);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
});

test('scheduler transitions due in-flight arrival into turnaround and clears in-flight timing fields', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const tickResult = game.processFlightSchedulerTick(1);
  const flight = game.authoritativeState.flights[0];
  const owner = game.authoritativeState.players[0];
  const expectedRevenue = expectedSettledRevenue(
    game,
    game.authoritativeState.routes[0],
    AIRCRAFT_CATALOG_BY_ID.BOEING_747.baseRevenuePerKm
  );

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 1);
  assert.equal(flight.status, 'turnaround');
  assert.equal(flight.direction, 'outbound');
  assert.equal(flight.departedAtSimulationMs, null);
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 2000);
  assert.equal(flight.arrivesAtSimulationMs, null);
  const expectedTurnaround = calculateAircraftTurnaroundSimulationMs(900, game.authoritativeState.routes[0].distanceKm);
  assert.equal(flight.nextTransitionAtSimulationMs, 5000 + expectedTurnaround);
  assert.equal(owner.capital, 1000000 + expectedRevenue);
  assert.equal(emitted.length, 1);
});

test('scheduler completes turnaround by reversing direction and launching next leg immediately', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'turnaround',
          departedAtSimulationMs: null,
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const tickResult = game.processFlightSchedulerTick(1);
  const flight = game.authoritativeState.flights[0];
  const expectedDuration = calculateFlightDurationSimulationMs(900, 900);
  const initialCapital = game.authoritativeState.players[0].capital;

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 1);
  assert.equal(flight.status, 'in-flight');
  assert.equal(flight.direction, 'inbound');
  assert.equal(flight.originAirportId, 'JFK');
  assert.equal(flight.destinationAirportId, 'YYZ');
  assert.equal(flight.departedAtSimulationMs, 5000);
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 2000);
  assert.equal(flight.arrivesAtSimulationMs, 5000 + expectedDuration);
  assert.equal(flight.nextTransitionAtSimulationMs, flight.arrivesAtSimulationMs);
  assert.equal(game.authoritativeState.players[0].capital, initialCapital);
  assert.equal(emitted.length, 1);
});

test('outbound and return arrivals each settle exactly once while departure and turnaround do not', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const owner = game.authoritativeState.players[0];
  const expectedRevenuePerLeg = expectedSettledRevenue(
    game,
    game.authoritativeState.routes[0],
    AIRCRAFT_CATALOG_BY_ID.BOEING_747.baseRevenuePerKm
  );

  const tickArrivalOutbound = game.processFlightSchedulerTick(1);
  assert.equal(tickArrivalOutbound.success, true);
  assert.ok(Math.abs(owner.capital - (1000000 + expectedRevenuePerLeg)) < 1e-6);
  assert.equal(game.authoritativeState.flights[0].status, 'turnaround');

  const tickTurnaroundComplete = game.processFlightSchedulerTick(400);
  assert.equal(tickTurnaroundComplete.success, true);
  assert.ok(Math.abs(owner.capital - (1000000 + expectedRevenuePerLeg)) < 1e-6);
  assert.equal(game.authoritativeState.flights[0].status, 'in-flight');
  assert.equal(game.authoritativeState.flights[0].direction, 'inbound');

  const tickArrivalInbound = game.processFlightSchedulerTick(740);
  assert.equal(tickArrivalInbound.success, true);
  assert.ok(Math.abs(owner.capital - (1000000 + expectedRevenuePerLeg * 2)) < 1e-6);
  assert.equal(game.authoritativeState.flights[0].status, 'turnaround');

  // Broadcasts are throttled/coalesced: mutating ticks set a pending flag and the
  // state emits at most once per broadcast interval, so require >=1 game:state.
  assert.ok(emitted.length >= 1, `expected at least one emission, got ${emitted.length}`);
  assert.ok(emitted.every((entry) => entry.eventName === 'game:state'));
  const latest = emitted[emitted.length - 1].payload;
  assert.ok(latest && typeof latest === 'object');
  assert.ok(latest.game && typeof latest.game === 'object');
  assert.ok(Array.isArray(latest.game.players));
  assert.ok(Array.isArray(latest.game.flights));
});

test('multiple arriving flights in one tick each settle and still emit a single game:state broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 1000000 }
      ],
      airports: [
        { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
        { airportId: 'JFK', ownerPlayerId: 'p1', saleListing: null },
        { airportId: 'LAX', ownerPlayerId: 'p2', saleListing: null },
        { airportId: 'SFO', ownerPlayerId: 'p2', saleListing: null }
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
        },
        {
          routeId: 'route-2',
          ownerPlayerId: 'p2',
          originAirportId: 'LAX',
          destinationAirportId: 'SFO',
          routeKey: 'LAX::SFO',
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-2']
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
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p2',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'assigned',
          assignedRouteId: 'route-2'
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
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        },
        {
          flightId: 'flight-2',
          ownerPlayerId: 'p2',
          routeId: 'route-2',
          aircraftInstanceId: 'acft-2',
          originAirportId: 'LAX',
          destinationAirportId: 'SFO',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 2500,
          arrivesAtSimulationMs: 6000,
          nextTransitionAtSimulationMs: 6000
        }
      ]
    }),
    manager
  );

  const tickResult = game.processFlightSchedulerTick(1);
  const p1 = game.authoritativeState.players.find((player) => player.id === 'p1');
  const p2 = game.authoritativeState.players.find((player) => player.id === 'p2');
  const route1 = game.authoritativeState.routes.find((r) => r.routeId === 'route-1');
  const route2 = game.authoritativeState.routes.find((r) => r.routeId === 'route-2');
  const expectedP1Revenue = expectedSettledRevenue(
    game,
    route1,
    AIRCRAFT_CATALOG_BY_ID.BOEING_747.baseRevenuePerKm
  );
  const expectedP2Revenue = expectedSettledRevenue(
    game,
    route2,
    AIRCRAFT_CATALOG_BY_ID.BOEING_737.baseRevenuePerKm
  );

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 2);
  assert.equal(p1.capital, 1000000 + expectedP1Revenue);
  assert.equal(p2.capital, 1000000 + expectedP2Revenue);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
});

test('overdue in-flight arrival catch-up settles once for one completed leg', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const expectedRevenue = expectedSettledRevenue(
    game,
    game.authoritativeState.routes[0],
    AIRCRAFT_CATALOG_BY_ID.BOEING_747.baseRevenuePerKm
  );
  const tickResult = game.processFlightSchedulerTick(2);

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 1);
  assert.equal(game.authoritativeState.players[0].capital, 1000000 + expectedRevenue);
  assert.equal(game.authoritativeState.flights[0].status, 'turnaround');
  assert.equal(emitted.length, 1);
});

test('arrival transition fails atomically with missing owner and does not partially mutate', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      players: [],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const flightBefore = { ...game.authoritativeState.flights[0] };
  const tickResult = game.processFlightSchedulerTick(1);

  assert.equal(tickResult.success, false);
  assert.equal(tickResult.changed, false);
  assert.equal(tickResult.processedTransitions, 0);
  assert.equal(tickResult.error.code, 'PLAYER_NOT_FOUND');
  assert.deepEqual(game.authoritativeState.flights[0], flightBefore);
  assert.equal(emitted.length, 0);
});

test('arrival transition fails atomically with invalid route distance and does not partially mutate', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: null,
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
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const capitalBefore = game.authoritativeState.players[0].capital;
  const flightBefore = { ...game.authoritativeState.flights[0] };
  const tickResult = game.processFlightSchedulerTick(1);

  assert.equal(tickResult.success, false);
  assert.equal(tickResult.changed, false);
  assert.equal(tickResult.processedTransitions, 0);
  assert.equal(tickResult.error.code, 'FLIGHT_DURATION_INVALID');
  assert.equal(game.authoritativeState.players[0].capital, capitalBefore);
  assert.deepEqual(game.authoritativeState.flights[0], flightBefore);
  assert.equal(emitted.length, 0);
});

test('arrival transition fails atomically with invalid turnaround speed and does not partially mutate', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
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
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const capitalBefore = game.authoritativeState.players[0].capital;
  const flightBefore = { ...game.authoritativeState.flights[0] };

  const aircraft = game.authoritativeState.ownedAircraft[0];
  aircraft.aircraftCatalogId = 'INVALID_CATALOG_ID';

  const tickResult = game.processFlightSchedulerTick(5000);

  assert.equal(tickResult.success, false);
  assert.equal(tickResult.changed, false);
  assert.equal(tickResult.processedTransitions, 0);
  assert.equal(tickResult.error.code, 'AIRCRAFT_SPEED_INVALID');
  assert.equal(game.authoritativeState.players[0].capital, capitalBefore);
  assert.deepEqual(game.authoritativeState.flights[0], flightBefore);
  assert.equal(emitted.length, 0);
});

test('arrival transition fails atomically with invalid aircraft settlement data and does not partially mutate', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'UNKNOWN_AIRCRAFT',
          acquisitionPrice: 300000,
          status: 'assigned',
          assignedRouteId: 'route-1'
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
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const capitalBefore = game.authoritativeState.players[0].capital;
  const flightBefore = { ...game.authoritativeState.flights[0] };
  const tickResult = game.processFlightSchedulerTick(1);

  assert.equal(tickResult.success, false);
  assert.equal(tickResult.changed, false);
  assert.equal(tickResult.processedTransitions, 0);
  assert.equal(tickResult.error.code, 'AIRCRAFT_SPEED_INVALID');
  assert.equal(game.authoritativeState.players[0].capital, capitalBefore);
  assert.deepEqual(game.authoritativeState.flights[0], flightBefore);
  assert.equal(emitted.length, 0);
});

test('scheduler catch-up can process multiple overdue transitions for one flight in bounded loop', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
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
          nextTransitionAtSimulationMs: 0
        }
      ]
    }),
    manager
  );

  const tickResult = game.processFlightSchedulerTick(270000);
  const flight = game.authoritativeState.flights[0];

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.ok(tickResult.processedTransitions >= 4);
  assert.ok(['ready', 'in-flight', 'turnaround'].includes(flight.status));
  assert.ok(flight.nextTransitionAtSimulationMs > 40000000);
  assert.equal(flight.arrivesAtSimulationMs, null);
  assert.ok(Number.isFinite(flight.nextTransitionAtSimulationMs));
  assert.ok(flight.nextTransitionAtSimulationMs > 40000000);
  assert.equal(emitted.length, 1);
});

test('flight scheduler starts once for active games and stops on end and dispose', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createBaseState({ flights: [] }), manager);

  assert.equal(game.isFlightSchedulerRunning(), false);
  game.initialize();
  assert.equal(game.isFlightSchedulerRunning(), true);

  game.endGame('time');
  assert.equal(game.isFlightSchedulerRunning(), false);

  const game2 = new Game(createBaseState({ id: 'game-2', flights: [] }), manager);
  game2.initialize();
  assert.equal(game2.isFlightSchedulerRunning(), true);
  game2.dispose();
  assert.equal(game2.isFlightSchedulerRunning(), false);
});

test('lastOutboundDepartedAtSimulationMs is set on outbound departure and preserved through round trip', () => {
  const { manager } = createManagerWithEmitCapture();

  // Test 1: Outbound departure sets the field
  const game1 = new Game(createBaseState(), manager);
  game1.processFlightSchedulerTick(1000);
  let flight = game1.authoritativeState.flights[0];
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 10000000);

  // Test 2: Destination arrival preserves the field
  const game2 = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );
  game2.processFlightSchedulerTick(1);
  flight = game2.authoritativeState.flights[0];
  assert.equal(flight.status, 'turnaround');
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 2000);

  // Test 3: Destination turnaround complete, inbound departure preserves the field
  const game3 = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'turnaround',
          departedAtSimulationMs: null,
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );
  game3.processFlightSchedulerTick(1);
  flight = game3.authoritativeState.flights[0];
  assert.equal(flight.status, 'in-flight');
  assert.equal(flight.direction, 'inbound');
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 2000);

  // Test 4: Inbound flight preserves the field
  const game4 = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'JFK',
          destinationAirportId: 'YYZ',
          direction: 'inbound',
          status: 'in-flight',
          departedAtSimulationMs: 5000,
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 8000,
          nextTransitionAtSimulationMs: 8000
        }
      ]
    }),
    manager
  );
  flight = game4.authoritativeState.flights[0];
  assert.equal(flight.status, 'in-flight');
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 2000);

  // Test 5: Origin arrival preserves the field
  const game5 = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'JFK',
          destinationAirportId: 'YYZ',
          direction: 'inbound',
          status: 'in-flight',
          departedAtSimulationMs: 5000,
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 8000,
          nextTransitionAtSimulationMs: 8000
        }
      ]
    }),
    manager
  );
  game5.processFlightSchedulerTick(1);
  flight = game5.authoritativeState.flights[0];
  assert.equal(flight.status, 'turnaround');
  assert.equal(flight.direction, 'inbound');
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 2000);

  // Test 6: Origin turnaround preserves the field
  const game6 = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'inbound',
          status: 'turnaround',
          departedAtSimulationMs: null,
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: 10000
        }
      ]
    }),
    manager
  );
  flight = game6.authoritativeState.flights[0];
  assert.equal(flight.status, 'turnaround');
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 2000);

  // Test 7: Next outbound departure updates the field
  const game7 = new Game(
    createBaseState({
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
          lastOutboundDepartedAtSimulationMs: 2000,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ]
    }),
    manager
  );
  game7.processFlightSchedulerTick(1);
  flight = game7.authoritativeState.flights[0];
  assert.equal(flight.status, 'in-flight');
  assert.equal(flight.direction, 'outbound');
  assert.equal(flight.lastOutboundDepartedAtSimulationMs, 10000);
});

/* Local due queue focused tests */

test('local due queue processes transitions in dueAtSimulationMs order across multiple flights', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 900,
          assignedAircraftInstanceIds: ['acft-1', 'acft-2']
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
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'assigned',
          assignedRouteId: 'route-1'
        }
      ],
      flights: [
        {
          flightId: 'flight-late',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-2',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: 2000
        },
        {
          flightId: 'flight-early',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: 1000
        }
      ]
    }),
    manager
  );

  const order = [];
  const originalApply = game.flightEngine.applyFlightTransition.bind(game.flightEngine);
  game.flightEngine.applyFlightTransition = function (transition, simulationNowMs) {
    order.push(transition.flightId);
    return originalApply(transition, simulationNowMs);
  };

  const result = game.processFlightSchedulerTick(1);
  game.flightEngine.applyFlightTransition = originalApply;

  assert.equal(result.success, true);
  assert.equal(result.processedTransitions, 2);
  assert.deepStrictEqual(order, ['flight-early', 'flight-late']);
  const allInFlight = game.authoritativeState.flights.every((f) => f.status === 'in-flight');
  assert.equal(allInFlight, true);
});

test('local due queue preserves flightId tie-break for equal due timestamps', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 900,
          assignedAircraftInstanceIds: ['acft-1', 'acft-2']
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
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'assigned',
          assignedRouteId: 'route-1'
        }
      ],
      flights: [
        {
          flightId: 'flight-b',
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
          flightId: 'flight-a',
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
      ]
    }),
    manager
  );

  const order = [];
  const originalApply = game.flightEngine.applyFlightTransition.bind(game.flightEngine);
  game.flightEngine.applyFlightTransition = function (transition, simulationNowMs) {
    order.push(transition.flightId);
    return originalApply(transition, simulationNowMs);
  };

  game.processFlightSchedulerTick(1);
  game.flightEngine.applyFlightTransition = originalApply;

  assert.deepStrictEqual(order, ['flight-a', 'flight-b']);
});

test('reconfiguration-blocked ready flight remains ready with local due queue', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 900,
          assignedAircraftInstanceIds: ['acft-1'],
          reconfiguringModelCatalogIds: ['BOEING_747']
        }
      ]
    }),
    manager
  );

  const result = game.processFlightSchedulerTick(1);
  const flight = game.authoritativeState.flights[0];

  assert.equal(result.success, true);
  assert.equal(result.changed, false);
  assert.equal(result.processedTransitions, 0);
  assert.equal(flight.status, 'ready');
});

test('transition cap is enforced with local due queue', () => {
  const { manager } = createManagerWithEmitCapture();
  const flightCount = MAX_FLIGHT_TRANSITIONS_PER_TICK + 10;

  const assignedAircraftInstanceIds = [];
  const ownedAircraft = [];
  const flights = [];
  for (let i = 0; i < flightCount; i += 1) {
    const aircraftInstanceId = `acft-${i}`;
    assignedAircraftInstanceIds.push(aircraftInstanceId);
    ownedAircraft.push({
      aircraftInstanceId,
      ownerPlayerId: 'p1',
      aircraftCatalogId: 'BOEING_747',
      acquisitionPrice: 300000,
      status: 'assigned',
      assignedRouteId: 'route-1'
    });
    flights.push({
      flightId: `flight-${i}`,
      ownerPlayerId: 'p1',
      routeId: 'route-1',
      aircraftInstanceId,
      originAirportId: 'YYZ',
      destinationAirportId: 'JFK',
      direction: 'outbound',
      status: 'ready',
      departedAtSimulationMs: null,
      arrivesAtSimulationMs: null,
      nextTransitionAtSimulationMs: null
    });
  }

  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 900,
          assignedAircraftInstanceIds
        }
      ],
      ownedAircraft,
      flights
    }),
    manager
  );

  const result = game.processFlightSchedulerTick(1);

  assert.equal(result.success, true);
  assert.equal(result.transitionCapHit, true);
  assert.equal(result.processedTransitions, MAX_FLIGHT_TRANSITIONS_PER_TICK);
});

test('revenue settlement remains unchanged with local due queue', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'in-flight',
          departedAtSimulationMs: 0,
          arrivesAtSimulationMs: 0,
          lastOutboundDepartedAtSimulationMs: 0,
          nextTransitionAtSimulationMs: 0
        }
      ]
    }),
    manager
  );

  const player = game.authoritativeState.players[0];
  const beforeCapital = player.capital;
  const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID.BOEING_747;
  const route = game.authoritativeState.routes[0];
  const expectedRevenue = expectedSettledRevenue(game, route, aircraftDefinition.baseRevenuePerKm);

  const result = game.processFlightSchedulerTick(1);
  const flight = game.authoritativeState.flights[0];

  assert.equal(result.success, true);
  assert.equal(result.processedTransitions, 1);
  assert.equal(flight.status, 'turnaround');
  assert.ok(Math.abs(player.capital - (beforeCapital + expectedRevenue)) < 1e-9);
});

test('Airbus A320 scheduling uses its 830 km/h catalog speed', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      ownedAircraft: [{
        aircraftInstanceId: 'acft-1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'AIRBUS_A320',
        acquisitionPrice: 280000,
        status: 'assigned',
        assignedRouteId: 'route-1'
      }],
      flights: [{
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
        nextTransitionAtSimulationMs: 0
      }]
    }),
    manager
  );

  const result = game.processFlightSchedulerTick(1);

  assert.equal(result.success, true);
  assert.equal(game.authoritativeState.flights[0].status, 'in-flight');
  assert.equal(
    game.authoritativeState.flights[0].arrivesAtSimulationMs,
    calculateFlightDurationSimulationMs(900, 830)
  );
});

test('Airbus A320 flight settlement uses its $32 per km base revenue', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      ownedAircraft: [{
        aircraftInstanceId: 'acft-1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'AIRBUS_A320',
        acquisitionPrice: 280000,
        status: 'assigned',
        assignedRouteId: 'route-1'
      }],
      flights: [{
        flightId: 'flight-1',
        ownerPlayerId: 'p1',
        routeId: 'route-1',
        aircraftInstanceId: 'acft-1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        direction: 'outbound',
        status: 'in-flight',
        departedAtSimulationMs: 0,
        arrivesAtSimulationMs: 0,
        lastOutboundDepartedAtSimulationMs: 0,
        nextTransitionAtSimulationMs: 0
      }]
    }),
    manager
  );
  const player = game.authoritativeState.players[0];
  const beforeCapital = player.capital;
  const route = game.authoritativeState.routes[0];
  const expectedRevenue = expectedSettledRevenue(
    game,
    route,
    AIRCRAFT_CATALOG_BY_ID.AIRBUS_A320.baseRevenuePerKm
  );

  const result = game.processFlightSchedulerTick(1);

  assert.equal(result.success, true);
  assert.equal(game.authoritativeState.flights[0].status, 'turnaround');
  assert.ok(Math.abs(player.capital - (beforeCapital + expectedRevenue)) < 1e-9);
});

test('no due flight is skipped by the local due queue', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 900,
          assignedAircraftInstanceIds: ['acft-1', 'acft-2']
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
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'assigned',
          assignedRouteId: 'route-1'
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
      ]
    }),
    manager
  );

  const result = game.processFlightSchedulerTick(1);

  assert.equal(result.processedTransitions, 2);
  const allInFlight = game.authoritativeState.flights.every((f) => f.status === 'in-flight');
  assert.equal(allInFlight, true);
});

test('missing route is detected before transition with local lookup Maps', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'missing-route',
          aircraftInstanceId: 'acft-1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ]
    }),
    manager
  );

  const result = game.processFlightSchedulerTick(1);
  const flight = game.authoritativeState.flights[0];

  assert.equal(result.success, false);
  assert.equal(result.processedTransitions, 0);
  assert.equal(flight.status, 'ready');
});

test('missing aircraft assignment is detected before transition with local lookup Maps', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'missing-acft',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ]
    }),
    manager
  );

  const result = game.processFlightSchedulerTick(1);
  const flight = game.authoritativeState.flights[0];

  assert.equal(result.success, false);
  assert.equal(result.processedTransitions, 0);
  assert.equal(flight.status, 'ready');
});

test('more than 200 transitions can be processed in one tick within the time budget', () => {
  const { manager } = createManagerWithEmitCapture();
  const flightCount = 250;

  const assignedAircraftInstanceIds = [];
  const ownedAircraft = [];
  const flights = [];
  for (let i = 0; i < flightCount; i += 1) {
    const aircraftInstanceId = `acft-${i}`;
    assignedAircraftInstanceIds.push(aircraftInstanceId);
    ownedAircraft.push({
      aircraftInstanceId,
      ownerPlayerId: 'p1',
      aircraftCatalogId: 'BOEING_747',
      acquisitionPrice: 300000,
      status: 'assigned',
      assignedRouteId: 'route-1'
    });
    flights.push({
      flightId: `flight-${i}`,
      ownerPlayerId: 'p1',
      routeId: 'route-1',
      aircraftInstanceId,
      originAirportId: 'YYZ',
      destinationAirportId: 'JFK',
      direction: 'outbound',
      status: 'ready',
      departedAtSimulationMs: null,
      arrivesAtSimulationMs: null,
      nextTransitionAtSimulationMs: null
    });
  }

  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 900,
          assignedAircraftInstanceIds
        }
      ],
      ownedAircraft,
      flights
    }),
    manager
  );

  const result = game.processFlightSchedulerTick(1);

  assert.equal(result.success, true);
  assert.equal(result.transitionCapHit, false);
  assert.equal(result.timeCapHit, false);
  assert.ok(result.processedTransitions > 200);
  assert.equal(result.processedTransitions, flightCount);
});

test('processing time guard can stop before the 1000 transition cap', () => {
  const { manager } = createManagerWithEmitCapture();
  const flightCount = 1200;

  const assignedAircraftInstanceIds = [];
  const ownedAircraft = [];
  const flights = [];
  for (let i = 0; i < flightCount; i += 1) {
    const aircraftInstanceId = `acft-${i}`;
    assignedAircraftInstanceIds.push(aircraftInstanceId);
    ownedAircraft.push({
      aircraftInstanceId,
      ownerPlayerId: 'p1',
      aircraftCatalogId: 'BOEING_747',
      acquisitionPrice: 300000,
      status: 'assigned',
      assignedRouteId: 'route-1'
    });
    flights.push({
      flightId: `flight-${i}`,
      ownerPlayerId: 'p1',
      routeId: 'route-1',
      aircraftInstanceId,
      originAirportId: 'YYZ',
      destinationAirportId: 'JFK',
      direction: 'outbound',
      status: 'ready',
      departedAtSimulationMs: null,
      arrivesAtSimulationMs: null,
      nextTransitionAtSimulationMs: null
    });
  }

  const game = new Game(
    createBaseState({
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 900,
          assignedAircraftInstanceIds
        }
      ],
      ownedAircraft,
      flights
    }),
    manager
  );

  const originalDateNow = Date.now;
  let callCount = 0;
  const start = 1_000_000;
  Date.now = () => {
    callCount += 1;
    if (callCount > 5) {
      return start + 100;
    }
    return start;
  };

  try {
    const result = game.flightEngine.processFlightSchedulerTick(0);

    assert.equal(result.success, true);
    assert.equal(result.transitionCapHit, false);
    assert.equal(result.timeCapHit, true);
    assert.ok(result.processedTransitions > 0);
    assert.ok(result.processedTransitions < 1000);
  } finally {
    Date.now = originalDateNow;
  }
});

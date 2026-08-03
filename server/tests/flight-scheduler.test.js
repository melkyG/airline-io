const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const {
  MIN_FLIGHT_DURATION_SIMULATION_MS,
  TURNAROUND_DURATION_SIMULATION_MS,
  calculateFlightDurationSimulationMs
} = require('../flights/rules');

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
    players: [{ id: 'p1', username: 'Alice', capital: 1000000, score: 0 }],
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

test('flight rules calculate duration from distance and speed with centralized minimum', () => {
  const veryShortRouteDuration = calculateFlightDurationSimulationMs(50, 900);
  assert.equal(veryShortRouteDuration, MIN_FLIGHT_DURATION_SIMULATION_MS);

  const longRouteDuration = calculateFlightDurationSimulationMs(9000, 900);
  assert.equal(longRouteDuration, 10 * 60 * 60 * 1000);

  assert.equal(calculateFlightDurationSimulationMs(1000, 0), null);
  assert.equal(calculateFlightDurationSimulationMs(-1, 900), null);
});

test('scheduler processes ready flight into in-flight outbound with authoritative timing', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  const tickResult = game.processFlightSchedulerTick(1000);
  const flight = game.authoritativeState.flights[0];
  const expectedDuration = calculateFlightDurationSimulationMs(900, 900);

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 1);
  assert.equal(flight.status, 'in-flight');
  assert.equal(flight.direction, 'outbound');
  assert.equal(flight.departedAtSimulationMs, 10000000);
  assert.equal(flight.arrivesAtSimulationMs, 10000000 + expectedDuration);
  assert.equal(flight.nextTransitionAtSimulationMs, flight.arrivesAtSimulationMs);
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
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const tickResult = game.processFlightSchedulerTick(1);
  const flight = game.authoritativeState.flights[0];

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 1);
  assert.equal(flight.status, 'turnaround');
  assert.equal(flight.direction, 'outbound');
  assert.equal(flight.departedAtSimulationMs, null);
  assert.equal(flight.arrivesAtSimulationMs, null);
  assert.equal(flight.nextTransitionAtSimulationMs, 5000 + TURNAROUND_DURATION_SIMULATION_MS);
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

  assert.equal(tickResult.success, true);
  assert.equal(tickResult.changed, true);
  assert.equal(tickResult.processedTransitions, 1);
  assert.equal(flight.status, 'in-flight');
  assert.equal(flight.direction, 'inbound');
  assert.equal(flight.originAirportId, 'JFK');
  assert.equal(flight.destinationAirportId, 'YYZ');
  assert.equal(flight.departedAtSimulationMs, 5000);
  assert.equal(flight.arrivesAtSimulationMs, 5000 + expectedDuration);
  assert.equal(flight.nextTransitionAtSimulationMs, flight.arrivesAtSimulationMs);
  assert.equal(emitted.length, 1);
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
  assert.equal(flight.status, 'turnaround');
  assert.equal(flight.departedAtSimulationMs, null);
  assert.equal(flight.arrivesAtSimulationMs, null);
  assert.ok(Number.isFinite(flight.nextTransitionAtSimulationMs));
  assert.ok(flight.nextTransitionAtSimulationMs > 270000 * 10000);
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

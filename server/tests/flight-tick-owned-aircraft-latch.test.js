const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const { canonicalRouteKey } = require('../routes');
const { OWNED_AIRCRAFT_STATUS } = require('../aircraft/ownership');

function createManagerWithEmitCapture() {
  const emitted = [];
  const manager = {
    io: {
      to(roomName) {
        return {
          emit(eventName, payload) {
            emitted.push({ roomName, eventName, payload, volatile: false });
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

function createBaseState() {
  return {
    id: 'game-latch-1',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      { airportId: 'JFK', ownerPlayerId: 'p1', saleListing: null }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
        assignedRouteId: 'route-1',
        pendingRouteExitAction: 'unassign'
      }
    ],
    routes: [
      {
        routeId: 'route-1',
        ownerPlayerId: 'p1',
        originAirportId: 'YYZ',
        destinationAirportId: 'JFK',
        routeKey: canonicalRouteKey('YYZ', 'JFK'),
        distanceKm: 550,
        assignedAircraftInstanceIds: ['acft-1'],
        reconfiguringModelCatalogIds: ['BOEING_747'],
        reconfigurationReferenceAircraftInstanceIds: {
          'BOEING_747': null
        }
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
    world: { countryProfitFactors: {} }
  };
}

test('delayed FLIGHT_TICK still includes ownedAircraft after pending unassign completes', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  // Force the next FLIGHT_TICK to be rate-limited so the rebuild-changed flag must survive.
  game.lastFlightStateBroadcastRealMs = Date.now();

  game.processFlightSchedulerTick(0);

  assert.equal(
    emitted.filter((entry) => entry.eventName === 'game:state').length,
    0,
    'First scheduler tick should not broadcast because it is rate-limited.'
  );

  // Aircraft should already be detached on the server side.
  const aircraft = game.authoritativeState.ownedAircraft[0];
  assert.equal(aircraft.status, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(aircraft.assignedRouteId, null);
  assert.equal(aircraft.pendingRouteExitAction, null);
  assert.deepEqual(game.authoritativeState.flights, []);

  // The broadcast should still be pending and should require ownedAircraft.
  assert.equal(game.flightStateBroadcastPending, true);
  assert.equal(game.flightStateBroadcastNeedsOwnedAircraft, true);

  // Allow the next broadcast to fire by pretending the last one was long ago.
  game.lastFlightStateBroadcastRealMs = Date.now() - 1000;

  game.processFlightSchedulerTick(Date.now());

  const stateBroadcasts = emitted.filter((entry) => entry.eventName === 'game:state');
  assert.equal(stateBroadcasts.length, 1, 'Second scheduler tick should emit the delayed FLIGHT_TICK.');
  assert.equal(stateBroadcasts[0].volatile, false, 'FLIGHT_TICK with ownedAircraft should use normal emission.');

  const payload = stateBroadcasts[0].payload;
  assert.ok(payload && payload.game, 'Payload should have game.');
  assert.ok(
    Array.isArray(payload.game.ownedAircraft),
    'Delayed FLIGHT_TICK must include ownedAircraft.'
  );

  const publicAircraft = payload.game.ownedAircraft.find((candidate) => {
    return candidate && candidate.aircraftInstanceId === 'acft-1';
  });
  assert.ok(publicAircraft, 'Public aircraft should be in payload.');
  assert.equal(publicAircraft.status, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(publicAircraft.assignedRouteId, null);
  assert.equal(publicAircraft.isPendingUnassign, false);

  // Latch should be reset after the broadcast.
  assert.equal(game.flightStateBroadcastPending, false);
  assert.equal(game.flightStateBroadcastNeedsOwnedAircraft, false);
});

test('ordinary FLIGHT_TICK remains volatile and omits ownedAircraft', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  game.broadcastState('FLIGHT_TICK');

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].volatile, true);
  assert.equal(emitted[0].payload.game.ownedAircraft, undefined);
});

test('non-FLIGHT_TICK broadcasts retain normal emission and ownedAircraft', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createBaseState(), manager);

  game.broadcastState('OTHER');

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].volatile, false);
  assert.ok(Array.isArray(emitted[0].payload.game.ownedAircraft));
});

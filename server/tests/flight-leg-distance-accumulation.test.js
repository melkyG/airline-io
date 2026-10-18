const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const { canonicalRouteKey } = require('../routes');
const { OWNED_AIRCRAFT_STATUS } = require('../aircraft/ownership');

function createManager() {
  return {
    io: {
      to() {
        return { emit() {} };
      }
    }
  };
}

function createBaseState() {
  return {
    id: 'game-leg-distance-1',
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
        assignedRouteId: 'route-1'
      },
      {
        aircraftInstanceId: 'acft-2',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_737',
        acquisitionPrice: 220000,
        status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
        assignedRouteId: 'route-2'
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
        assignedAircraftInstanceIds: ['acft-1']
      },
      {
        routeId: 'route-2',
        ownerPlayerId: 'p1',
        originAirportId: 'JFK',
        destinationAirportId: 'YYZ',
        routeKey: canonicalRouteKey('JFK', 'YYZ'),
        distanceKm: 330,
        assignedAircraftInstanceIds: ['acft-2']
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
        departedAtSimulationMs: 0,
        arrivesAtSimulationMs: 1000,
        nextTransitionAtSimulationMs: 1000
      },
      {
        flightId: 'flight-2',
        ownerPlayerId: 'p1',
        routeId: 'route-1',
        aircraftInstanceId: 'acft-1',
        originAirportId: 'JFK',
        destinationAirportId: 'YYZ',
        direction: 'inbound',
        status: 'in-flight',
        departedAtSimulationMs: 0,
        arrivesAtSimulationMs: 1000,
        nextTransitionAtSimulationMs: 1000
      },
      {
        flightId: 'flight-3',
        ownerPlayerId: 'p1',
        routeId: 'route-2',
        aircraftInstanceId: 'acft-2',
        originAirportId: 'JFK',
        destinationAirportId: 'YYZ',
        direction: 'outbound',
        status: 'in-flight',
        departedAtSimulationMs: 0,
        arrivesAtSimulationMs: 1000,
        nextTransitionAtSimulationMs: 1000
      }
    ],
    world: { countryProfitFactors: {} }
  };
}

test('one completed leg adds exactly route.distanceKm', () => {
  const game = new Game(createBaseState(), createManager());

  const result = game.flightEngine.applyFlightTransition({ flightId: 'flight-1' }, 1000);
  assert.equal(result.success, true);

  assert.equal(game.weeklyAircraftDistanceKm.get('acft-1'), 550);
});

test('two completed legs for the same aircraft accumulate', () => {
  const game = new Game(createBaseState(), createManager());

  const result1 = game.flightEngine.applyFlightTransition({ flightId: 'flight-1' }, 1000);
  assert.equal(result1.success, true);

  const result2 = game.flightEngine.applyFlightTransition({ flightId: 'flight-2' }, 1000);
  assert.equal(result2.success, true);

  assert.equal(game.weeklyAircraftDistanceKm.get('acft-1'), 1100);
});

test('separate aircraft instance IDs accumulate independently', () => {
  const game = new Game(createBaseState(), createManager());

  const result1 = game.flightEngine.applyFlightTransition({ flightId: 'flight-1' }, 1000);
  assert.equal(result1.success, true);

  const result3 = game.flightEngine.applyFlightTransition({ flightId: 'flight-3' }, 1000);
  assert.equal(result3.success, true);

  assert.equal(game.weeklyAircraftDistanceKm.get('acft-1'), 550);
  assert.equal(game.weeklyAircraftDistanceKm.get('acft-2'), 330);
});

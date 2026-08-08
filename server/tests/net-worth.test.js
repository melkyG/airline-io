const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const {
  calculateAirportSellToGamePrice,
  calculateAircraftSellToGamePrice
} = require('../economy/liquidation');
const {
  calculatePlayerNetWorth,
  calculateNetWorthByPlayer
} = require('../economy/netWorth');
const { AIRCRAFT_CATALOG_BY_ID } = require('../aircraft/catalog');

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
    id: 'game-net-worth',
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
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: null, saleListing: null },
      { airportId: 'JFK', ownerPlayerId: null, saleListing: null }
    ],
    ownedAircraft: [],
    routes: [],
    flights: [],
    ...overrides
  };
}

test('cash-only player net worth equals capital', () => {
  const gameState = createBaseState({
    players: [{ id: 'p1', username: 'Alice', capital: 1250000, score: 0 }],
    airports: [],
    ownedAircraft: []
  });

  assert.equal(calculatePlayerNetWorth(gameState, 'p1'), 1250000);
});

test('owned airport adds exact market sell-to-game value', () => {
  const gameState = createBaseState({
    players: [{ id: 'p1', username: 'Alice', capital: 1000000, score: 0 }],
    airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null }],
    ownedAircraft: []
  });

  const expectedAirportValue = calculateAirportSellToGamePrice(300000);
  assert.equal(calculatePlayerNetWorth(gameState, 'p1'), 1000000 + expectedAirportValue);
});

test('owned aircraft adds exact market sell-to-game value', () => {
  const gameState = createBaseState({
    players: [{ id: 'p1', username: 'Alice', capital: 1000000, score: 0 }],
    airports: [],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: 'available',
        assignedRouteId: null
      }
    ]
  });

  const expectedAircraftValue = calculateAircraftSellToGamePrice(AIRCRAFT_CATALOG_BY_ID.BOEING_747.purchasePrice);
  assert.equal(calculatePlayerNetWorth(gameState, 'p1'), 1000000 + expectedAircraftValue);
});

test('multiple assets aggregate correctly, assigned aircraft count, listed airports count by market value', () => {
  const gameState = createBaseState({
    players: [{ id: 'p1', username: 'Alice', capital: 1000000, score: 0 }],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: { sellerPlayerId: 'p1', askingPrice: 9999999 } },
      { airportId: 'JFK', ownerPlayerId: 'p1', saleListing: null }
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
        aircraftCatalogId: 'BOEING_737',
        acquisitionPrice: 220000,
        status: 'available',
        assignedRouteId: null
      }
    ]
  });

  const airportsValue =
    calculateAirportSellToGamePrice(300000) +
    calculateAirportSellToGamePrice(250000);
  const aircraftValue =
    calculateAircraftSellToGamePrice(AIRCRAFT_CATALOG_BY_ID.BOEING_747.purchasePrice) +
    calculateAircraftSellToGamePrice(AIRCRAFT_CATALOG_BY_ID.BOEING_737.purchasePrice);

  assert.equal(calculatePlayerNetWorth(gameState, 'p1'), 1000000 + airportsValue + aircraftValue);
});

test('assets owned by other players do not count toward local player net worth', () => {
  const gameState = createBaseState({
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p2', saleListing: null }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-1',
        ownerPlayerId: 'p2',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: 'available',
        assignedRouteId: null
      }
    ]
  });

  assert.equal(calculatePlayerNetWorth(gameState, 'p1'), 1000000);
});

test('flight revenue increases capital and derived net worth by the same amount', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
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
          status: 'in-flight',
          departedAtSimulationMs: 2000,
          arrivesAtSimulationMs: 5000,
          nextTransitionAtSimulationMs: 5000
        }
      ]
    }),
    manager
  );

  const beforeCapital = game.authoritativeState.players[0].capital;
  const beforeNetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p1');
  const tickResult = game.processFlightSchedulerTick(1);
  const afterCapital = game.authoritativeState.players[0].capital;
  const afterNetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p1');

  assert.equal(tickResult.success, true);
  assert.equal(afterCapital - beforeCapital, afterNetWorth - beforeNetWorth);
});

test('buying and selling aircraft updates derived net worth from authoritative state', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      players: [{ id: 'p1', username: 'Alice', capital: 1000000, score: 0 }],
      airports: [],
      ownedAircraft: []
    }),
    manager
  );

  const initialNetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p1');
  assert.equal(initialNetWorth, 1000000);

  const purchaseResult = game.purchaseAircraftFromGame('p1', 'BOEING_747', 1);
  assert.equal(purchaseResult.success, true);

  const afterPurchaseNetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p1');
  assert.equal(afterPurchaseNetWorth, 940000);

  const sellResult = game.sellAircraftToGame('p1', 'BOEING_747', 1);
  assert.equal(sellResult.success, true);

  const afterSellNetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p1');
  assert.equal(afterSellNetWorth, 940000);
});

test('airport ownership transfer updates derived net worth from authoritative state', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
        { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 250000 }
        },
        { airportId: 'JFK', ownerPlayerId: 'p2', saleListing: null }
      ]
    }),
    manager
  );

  const beforeP1NetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p1');
  const beforeP2NetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p2');

  const purchaseResult = game.purchaseListedAirport('p2', 'YYZ');
  assert.equal(purchaseResult.success, true);

  const afterP1NetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p1');
  const afterP2NetWorth = calculatePlayerNetWorth(game.authoritativeState, 'p2');

  assert.notEqual(afterP1NetWorth, beforeP1NetWorth);
  assert.notEqual(afterP2NetWorth, beforeP2NetWorth);
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, 'p2');
});

test('public player snapshots expose authoritative derived net worth', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    createBaseState({
      players: [{ id: 'p1', username: 'Alice', capital: 1000000, score: 0 }],
      airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null }],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'available',
          assignedRouteId: null
        }
      ]
    }),
    manager
  );

  const payload = game.getPublicState();
  const localPlayer = payload.game.players.find((player) => player.id === 'p1');
  const expectedNetWorth =
    1000000 +
    calculateAirportSellToGamePrice(300000) +
    calculateAircraftSellToGamePrice(AIRCRAFT_CATALOG_BY_ID.BOEING_747.purchasePrice);

  assert.ok(localPlayer);
  assert.equal(localPlayer.netWorth, expectedNetWorth);
});

test('calculateNetWorthByPlayer returns independent per-player values', () => {
  const gameState = createBaseState({
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
      { id: 'p2', username: 'Bob', capital: 500000, score: 0 }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      { airportId: 'JFK', ownerPlayerId: 'p2', saleListing: null }
    ],
    ownedAircraft: []
  });

  const byPlayer = calculateNetWorthByPlayer(gameState);
  assert.equal(byPlayer.get('p1'), 1000000 + calculateAirportSellToGamePrice(300000));
  assert.equal(byPlayer.get('p2'), 500000 + calculateAirportSellToGamePrice(250000));
});
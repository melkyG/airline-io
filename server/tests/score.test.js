const test = require('node:test');
const assert = require('node:assert/strict');
const { AIRPORT_CATALOG } = require('../airports/catalog');
const { AIRCRAFT_CATALOG_BY_ID } = require('../aircraft/catalog');
const { calculateNetWorthByPlayer } = require('../economy/netWorth');
const {
  NET_WORTH_SCORE_BASELINE,
  NET_WORTH_SCORE_TARGET,
  NET_WORTH_SCORE_TARGET_POINTS,
  calculatePlayerScore,
  calculateNetWorthScore,
  calculateAirportScore,
  calculateRouteScore
} = require('../economy/score');

function expectedLinearNetWorthScore(netWorth) {
  if (!Number.isFinite(netWorth) || netWorth <= NET_WORTH_SCORE_BASELINE) {
    return 0;
  }

  return (
    NET_WORTH_SCORE_TARGET_POINTS *
    (netWorth - NET_WORTH_SCORE_BASELINE) /
    (NET_WORTH_SCORE_TARGET - NET_WORTH_SCORE_BASELINE)
  );
}

function createGameStateForCapital(capital, debugScoreOffset = 0) {
  return {
    players: [
      {
        id: 'p1',
        capital,
        debugScoreOffset
      }
    ],
    airports: [],
    ownedAircraft: []
  };
}

test('net worth score is 0 at exactly the $1M baseline', () => {
  const score = calculateNetWorthScore(1_000_000);
  assert.equal(score, 0);
});

test('net worth score is 0 below the $1M baseline', () => {
  const score = calculateNetWorthScore(500_000);
  assert.equal(score, 0);
});

test('net worth score is 500 at $100B anchor', () => {
  const score = calculateNetWorthScore(100_000_000_000);
  assert.equal(score, 500);
});

test('net worth score matches deterministic linear formula at an intermediate value', () => {
  const netWorth = 50_000_000_000;
  const expected = expectedLinearNetWorthScore(netWorth);
  const actual = calculateNetWorthScore(netWorth);

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('net worth score increases monotonically as net worth increases', () => {
  const lower = calculateNetWorthScore(1_000_000_000);
  const middle = calculateNetWorthScore(10_000_000_000);
  const higher = calculateNetWorthScore(50_000_000_000);

  assert.ok(lower > 0);
  assert.ok(middle > lower);
  assert.ok(higher > middle);
});

test('calculatePlayerScore uses net-worth gameplay score plus debug offset', () => {
  const gameState = createGameStateForCapital(1_000_000_000, 500);
  const expected = expectedLinearNetWorthScore(1_000_000_000) + 500;
  const actual = calculatePlayerScore(gameState, 'p1');

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('calculatePlayerScore ignores legacy stored player.score field', () => {
  const gameState = {
    players: [
      {
        id: 'p1',
        capital: 1_000_000,
        score: 999999,
        debugScoreOffset: 0
      }
    ],
    airports: [],
    ownedAircraft: []
  };

  assert.equal(calculatePlayerScore(gameState, 'p1'), 0);
});

function createScoreGameState({ airports = [], routes = [], ownedAircraft = [] } = {}) {
  return {
    players: [{ id: 'p1', capital: 0, debugScoreOffset: 0 }],
    airports,
    routes,
    ownedAircraft
  };
}

test('calculateAirportScore returns 0 for empty/missing playerId', () => {
  assert.equal(calculateAirportScore(createScoreGameState(), ''), 0);
  assert.equal(calculateAirportScore(createScoreGameState(), null), 0);
  assert.equal(calculateAirportScore(createScoreGameState(), undefined), 0);
});

function expectedAirportScore(basePrice) {
  return 115 * Math.pow(basePrice / 800_000_000, 0.35);
}

test('calculateAirportScore sums diminishing-returns airport score', () => {
  const airportA = AIRPORT_CATALOG[0];
  const airportB = AIRPORT_CATALOG[1];
  const gameState = createScoreGameState({
    airports: [
      { airportId: airportA.id, ownerPlayerId: 'p1' },
      { airportId: airportB.id, ownerPlayerId: 'p1' }
    ]
  });

  const expected = expectedAirportScore(airportA.basePrice) + expectedAirportScore(airportB.basePrice);
  const actual = calculateAirportScore(gameState, 'p1');

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('calculateAirportScore ignores unowned, other-player and missing-catalog airports', () => {
  const airportA = AIRPORT_CATALOG[0];
  const gameState = createScoreGameState({
    airports: [
      { airportId: airportA.id, ownerPlayerId: 'p1' },
      { airportId: airportA.id, ownerPlayerId: 'p2' },
      { airportId: 'UNKNOWN', ownerPlayerId: 'p1' },
      { airportId: airportA.id, ownerPlayerId: null }
    ]
  });

  assert.equal(calculateAirportScore(gameState, 'p1'), expectedAirportScore(airportA.basePrice));
});

test('calculateAirportScore matches the 115-point reference values', () => {
  const catalogModule = require('../airports/catalog');
  const originalCatalog = catalogModule.AIRPORT_CATALOG;
  const referenceAirports = [
    { id: 'TEST5M', basePrice: 5_000_000, expected: 19.2 },
    { id: 'TEST18M', basePrice: 18_000_000, expected: 30.7 },
    { id: 'TEST50M', basePrice: 50_000_000, expected: 44.5 },
    { id: 'TEST100M', basePrice: 100_000_000, expected: 55.2 },
    { id: 'TEST200M', basePrice: 200_000_000, expected: 70.5 },
    { id: 'TEST400M', basePrice: 400_000_000, expected: 90.5 },
    { id: 'TEST800M', basePrice: 800_000_000, expected: 115 }
  ];

  catalogModule.AIRPORT_CATALOG = [
    ...originalCatalog,
    ...referenceAirports.map((airport) => ({ ...airport }))
  ];

  delete require.cache[require.resolve('../economy/score')];
  const { calculateAirportScore: calculateAirportScoreWithSynthetic } = require('../economy/score');

  const actualScores = referenceAirports.map((airport) => calculateAirportScoreWithSynthetic(
    createScoreGameState({
      airports: [{ airportId: airport.id, ownerPlayerId: 'p1' }]
    }),
    'p1'
  ));

  catalogModule.AIRPORT_CATALOG = originalCatalog;
  delete require.cache[require.resolve('../economy/score')];

  referenceAirports.forEach((airport, index) => {
    assert.ok(Math.abs(actualScores[index] - airport.expected) <= 1);
  });
  assert.equal(actualScores.at(-1), 115);
});

test('calculateRouteScore returns 0 for missing playerId', () => {
  assert.equal(calculateRouteScore(createScoreGameState(), ''), 0);
  assert.equal(calculateRouteScore(createScoreGameState(), null), 0);
  assert.equal(calculateRouteScore(createScoreGameState(), undefined), 0);
});

test('calculateRouteScore returns 0 for route with zero valid assigned aircraft', () => {
  const gameState = createScoreGameState({
    routes: [
      { routeId: 'r1', ownerPlayerId: 'p1', assignedAircraftInstanceIds: [] }
    ]
  });

  assert.equal(calculateRouteScore(gameState, 'p1'), 0);
});

test('calculateRouteScore is 10 + purchasePrice / 1000000 for one valid assigned aircraft', () => {
  const aircraftCatalog = AIRCRAFT_CATALOG_BY_ID['BOEING_737'];
  const gameState = createScoreGameState({
    routes: [
      { routeId: 'r1', ownerPlayerId: 'p1', assignedAircraftInstanceIds: ['ac1'] }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'ac1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_737',
        assignedRouteId: 'r1',
        status: 'assigned'
      }
    ]
  });

  const expected = 10 + aircraftCatalog.purchasePrice / 1_000_000;
  const actual = calculateRouteScore(gameState, 'p1');

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('calculateRouteScore sums multiple valid assigned aircraft and multiple routes', () => {
  const catalog737 = AIRCRAFT_CATALOG_BY_ID['BOEING_737'];
  const catalog747 = AIRCRAFT_CATALOG_BY_ID['BOEING_747'];
  const gameState = createScoreGameState({
    routes: [
      { routeId: 'r1', ownerPlayerId: 'p1', assignedAircraftInstanceIds: ['ac1', 'ac2'] },
      { routeId: 'r2', ownerPlayerId: 'p1', assignedAircraftInstanceIds: ['ac3'] }
    ],
    ownedAircraft: [
      { aircraftInstanceId: 'ac1', ownerPlayerId: 'p1', aircraftCatalogId: 'BOEING_737', assignedRouteId: 'r1', status: 'assigned' },
      { aircraftInstanceId: 'ac2', ownerPlayerId: 'p1', aircraftCatalogId: 'BOEING_747', assignedRouteId: 'r1', status: 'assigned' },
      { aircraftInstanceId: 'ac3', ownerPlayerId: 'p1', aircraftCatalogId: 'BOEING_737', assignedRouteId: 'r2', status: 'assigned' }
    ]
  });

  const expected =
    10 +
    (catalog737.purchasePrice + catalog747.purchasePrice) / 1_000_000 +
    10 +
    catalog737.purchasePrice / 1_000_000;
  const actual = calculateRouteScore(gameState, 'p1');

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('calculateRouteScore ignores invalid aircraft assignments', () => {
  const catalog747 = AIRCRAFT_CATALOG_BY_ID['BOEING_747'];
  const gameState = createScoreGameState({
    routes: [
      {
        routeId: 'r1',
        ownerPlayerId: 'p1',
        assignedAircraftInstanceIds: ['ac1', 'ac2', 'ac3', 'ac4', 'ac5']
      }
    ],
    ownedAircraft: [
      { aircraftInstanceId: 'ac1', ownerPlayerId: 'p2', aircraftCatalogId: 'BOEING_737', assignedRouteId: 'r1', status: 'assigned' },
      { aircraftInstanceId: 'ac2', ownerPlayerId: 'p1', aircraftCatalogId: 'BOEING_737', assignedRouteId: 'r2', status: 'assigned' },
      { aircraftInstanceId: 'ac3', ownerPlayerId: 'p1', aircraftCatalogId: 'BOEING_737', assignedRouteId: 'r1', status: 'idle' },
      { aircraftInstanceId: 'ac4', ownerPlayerId: 'p1', aircraftCatalogId: 'UNKNOWN', assignedRouteId: 'r1', status: 'assigned' },
      { aircraftInstanceId: 'ac5', ownerPlayerId: 'p1', aircraftCatalogId: 'BOEING_747', assignedRouteId: 'r1', status: 'assigned' }
    ]
  });

  const expected = 10 + catalog747.purchasePrice / 1_000_000;
  const actual = calculateRouteScore(gameState, 'p1');

  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('calculateRouteScore ignores routes owned by other players', () => {
  const gameState = createScoreGameState({
    routes: [
      { routeId: 'r1', ownerPlayerId: 'p2', assignedAircraftInstanceIds: ['ac1'] }
    ],
    ownedAircraft: [
      { aircraftInstanceId: 'ac1', ownerPlayerId: 'p2', aircraftCatalogId: 'BOEING_737', assignedRouteId: 'r1', status: 'assigned' }
    ]
  });

  assert.equal(calculateRouteScore(gameState, 'p1'), 0);
});

test('calculateRouteScore awards 16 aircraft points for 40 valid assigned Boeing 747s', () => {
  const gameState = createScoreGameState({
    routes: [
      {
        routeId: 'r1',
        ownerPlayerId: 'p1',
        assignedAircraftInstanceIds: Array.from({ length: 40 }, (_, i) => `ac${i}`)
      }
    ],
    ownedAircraft: Array.from({ length: 40 }, (_, i) => ({
      aircraftInstanceId: `ac${i}`,
      ownerPlayerId: 'p1',
      aircraftCatalogId: 'BOEING_747',
      assignedRouteId: 'r1',
      status: 'assigned'
    }))
  });

  const actual = calculateRouteScore(gameState, 'p1');

  assert.ok(Math.abs(actual - 26) < 1e-9);
  assert.ok(Math.abs(actual - 10 - 16) < 1e-9);
});

test('calculateRouteScore awards 0.4 aircraft points for one assigned Boeing 747', () => {
  const gameState = createScoreGameState({
    routes: [
      { routeId: 'r1', ownerPlayerId: 'p1', assignedAircraftInstanceIds: ['ac1'] }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'ac1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        assignedRouteId: 'r1',
        status: 'assigned'
      }
    ]
  });

  const actual = calculateRouteScore(gameState, 'p1');

  assert.ok(Math.abs(actual - 10.4) < 1e-9);
  assert.ok(Math.abs(actual - 10 - 0.4) < 1e-9);
});

test('calculateRouteScore awards 400 aircraft points for 1000 valid assigned Boeing 747s', () => {
  const gameState = createScoreGameState({
    routes: [
      {
        routeId: 'r1',
        ownerPlayerId: 'p1',
        assignedAircraftInstanceIds: Array.from({ length: 1000 }, (_, i) => `ac${i}`)
      }
    ],
    ownedAircraft: Array.from({ length: 1000 }, (_, i) => ({
      aircraftInstanceId: `ac${i}`,
      ownerPlayerId: 'p1',
      aircraftCatalogId: 'BOEING_747',
      assignedRouteId: 'r1',
      status: 'assigned'
    }))
  });

  const actual = calculateRouteScore(gameState, 'p1');

  assert.ok(Math.abs(actual - 410) < 1e-9);
  assert.ok(Math.abs(actual - 10 - 400) < 1e-9);
});

test('calculatePlayerScore combines financial, airport and route scores', () => {
  const airportA = AIRPORT_CATALOG[0];
  const gameState = {
    players: [{ id: 'p1', capital: 1_000_000_000, debugScoreOffset: 0 }],
    airports: [{ airportId: airportA.id, ownerPlayerId: 'p1' }],
    routes: [
      { routeId: 'r1', ownerPlayerId: 'p1', assignedAircraftInstanceIds: ['ac1'] }
    ],
    ownedAircraft: [
      {
        aircraftInstanceId: 'ac1',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_737',
        assignedRouteId: 'r1',
        status: 'assigned'
      }
    ]
  };

  const netWorth = calculateNetWorthByPlayer(gameState).get('p1');
  const financialScore = calculateNetWorthScore(netWorth);
  const airportScore = calculateAirportScore(gameState, 'p1');
  const routeScore = calculateRouteScore(gameState, 'p1');
  const expected = financialScore + airportScore + routeScore;

  assert.ok(Math.abs(calculatePlayerScore(gameState, 'p1') - expected) < 1e-9);
});

test('calculatePlayerScore still adds debugScoreOffset separately', () => {
  const airportA = AIRPORT_CATALOG[0];
  const gameState = {
    players: [{ id: 'p1', capital: 0, debugScoreOffset: 42 }],
    airports: [{ airportId: airportA.id, ownerPlayerId: 'p1' }],
    routes: [],
    ownedAircraft: []
  };

  const airportScore = calculateAirportScore(gameState, 'p1');
  const expected = airportScore + 42;

  assert.equal(calculatePlayerScore(gameState, 'p1'), expected);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');

function createManager() {
  return {
    io: {
      to() {
        const room = { emit() {}, volatile: null };
        room.volatile = room;
        return room;
      }
    }
  };
}

function createGameWithFactors(factors) {
  return new Game({
    id: 'world-revenue',
    status: 'active',
    createdAt: 0,
    startedAt: 0,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 1,
    simulationEndedAtGameMs: null,
    world: { countryProfitFactors: factors },
    players: [{ id: 'p1', username: 'Alice', capital: 0 }],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      { airportId: 'YVR', ownerPlayerId: 'p1', saleListing: null },
      { airportId: 'JFK', ownerPlayerId: 'p1', saleListing: null }
    ],
    routes: [],
    ownedAircraft: [],
    flights: []
  }, createManager());
}

test('empty factors -> route factor 1.00', () => {
  const game = createGameWithFactors({});
  const factor = game.resolveRouteCountryProfitFactor(
    { originAirportId: 'YYZ', destinationAirportId: 'YVR' },
    0
  );
  assert.strictEqual(factor, 1.0);
});

test('Canada 1.20 + Canada 1.20 -> route factor 1.20', () => {
  const game = createGameWithFactors({ Canada: 1.20 });
  const factor = game.resolveRouteCountryProfitFactor(
    { originAirportId: 'YYZ', destinationAirportId: 'YVR' },
    0
  );
  assert.strictEqual(factor, 1.20);
});

test('Canada 1.20 + unconfigured US -> route factor 1.10', () => {
  const game = createGameWithFactors({ Canada: 1.20 });
  const factor = game.resolveRouteCountryProfitFactor(
    { originAirportId: 'YYZ', destinationAirportId: 'JFK' },
    0
  );
  assert.strictEqual(factor, 1.10);
});

// --- Airport-value revenue factor ---

const {
  AIRPORT_REVENUE_REFERENCE_PRICE,
  AIRPORT_REVENUE_EXPONENT,
  resolveAirportValueFactor
} = require('../economy/flightSettlement');
const { AIRPORT_CATALOG } = require('../airports/catalog');
const priceOf = (id) => AIRPORT_CATALOG.find((a) => a.id === id).basePrice;

test('reference-price airport -> factor exactly 1.0 (two $650k airports -> 1.0x)', () => {
  assert.strictEqual(resolveAirportValueFactor(AIRPORT_REVENUE_REFERENCE_PRICE), 1.0);
  assert.ok(Math.abs(
    resolveAirportValueFactor(500000) - Math.pow(500000 / 650000, AIRPORT_REVENUE_EXPONENT)
  ) < 1e-9);
});

test('airport factor uses uncapped pow(price/650k, 0.27)', () => {
  const expected = (price) =>
    Math.pow(price / AIRPORT_REVENUE_REFERENCE_PRICE, AIRPORT_REVENUE_EXPONENT);
  for (const id of ['ABQ', 'YYZ', 'ADD', 'JFK', 'LHR']) {
    assert.ok(Math.abs(resolveAirportValueFactor(priceOf(id)) - expected(priceOf(id))) < 1e-9, id);
  }
  assert.ok(resolveAirportValueFactor(priceOf('ABQ')) < 1.0);   // cheap → below 1
  assert.ok(resolveAirportValueFactor(priceOf('YYZ')) > 1.0);   // major → above 1
});

test('elite airports are uncapped and strictly increasing with price', () => {
  const jfk = resolveAirportValueFactor(priceOf('JFK')); // $225M
  const lhr = resolveAirportValueFactor(priceOf('LHR')); // $450M
  assert.ok(Math.abs(jfk - Math.pow(priceOf('JFK') / AIRPORT_REVENUE_REFERENCE_PRICE, AIRPORT_REVENUE_EXPONENT)) < 1e-9);
  assert.ok(Math.abs(lhr - Math.pow(priceOf('LHR') / AIRPORT_REVENUE_REFERENCE_PRICE, AIRPORT_REVENUE_EXPONENT)) < 1e-9);
  assert.ok(jfk > 4.0 && lhr > jfk, `JFK ${jfk} > 4 and LHR ${lhr} > JFK`);
  assert.ok(resolveAirportValueFactor(100000000000) > lhr); // no ceiling
});

test('route airport factor is the arithmetic mean of endpoint factors', () => {
  const game = createGameWithFactors({});
  const route = { originAirportId: 'ABQ', destinationAirportId: 'ADD' };
  const expected = (resolveAirportValueFactor(priceOf('ABQ')) + resolveAirportValueFactor(priceOf('ADD'))) / 2;
  assert.ok(Math.abs(game.resolveRouteAirportValueFactor(route) - expected) < 1e-9);
});

test('missing airports fall back to neutral 1.0 endpoints', () => {
  const game = createGameWithFactors({});
  assert.strictEqual(game.resolveRouteAirportValueFactor({ originAirportId: 'NOPE', destinationAirportId: 'ABQ' }),
    (1.0 + resolveAirportValueFactor(priceOf('ABQ'))) / 2);
  assert.strictEqual(game.resolveRouteAirportValueFactor({}), 1.0);
});

test('country factor and airport factor are independent and multiply', () => {
  const game = createGameWithFactors({ Canada: 1.5 });
  const route = { originAirportId: 'YYZ', destinationAirportId: 'YVR' }; // both Canada

  const countryFactor = game.resolveRouteCountryProfitFactor(route, 0);
  const airportFactor = game.resolveRouteAirportValueFactor(route);

  assert.strictEqual(countryFactor, 1.5); // unaffected by prices
  const expectedAirport =
    (resolveAirportValueFactor(priceOf('YYZ')) + resolveAirportValueFactor(priceOf('YVR'))) / 2;
  assert.ok(Math.abs(airportFactor - expectedAirport) < 1e-9);
  // Airport factor ignores world factors entirely.
  const gameNeutral = createGameWithFactors({});
  assert.strictEqual(gameNeutral.resolveRouteAirportValueFactor(route), airportFactor);

  const combined = countryFactor * airportFactor;
  assert.ok(Math.abs(combined - 1.5 * expectedAirport) < 1e-9);
});

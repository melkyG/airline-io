const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FLIGHT_REVENUE_MULTIPLIER,
  calculateFlightSettlement
} = require('../economy/flightSettlement');

test('calculateFlightSettlement returns structured baseline revenue values', () => {
  const result = calculateFlightSettlement({
    baseRevenuePerKm: 105,
    routeDistanceKm: 900
  });

  assert.equal(result.success, true);
  assert.equal(FLIGHT_REVENUE_MULTIPLIER, 0.55);
  const expected =
    105 *
    900 *
    (1 + 0.85 / (1 + Math.exp(-(900 - 7000) / 1500))) *
    FLIGHT_REVENUE_MULTIPLIER;
  assert.ok(Math.abs(result.baseRevenue - expected) < 1e-9);
  assert.ok(Math.abs(result.finalRevenue - expected) < 1e-9);
});

test('calculateFlightSettlement rejects invalid aircraft settlement data', () => {
  const result = calculateFlightSettlement({
    baseRevenuePerKm: 0,
    routeDistanceKm: 900
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'BASE_REVENUE_PER_KM_INVALID');
});

test('calculateFlightSettlement rejects invalid route distance data', () => {
  const result = calculateFlightSettlement({
    baseRevenuePerKm: 105,
    routeDistanceKm: null
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'ROUTE_DISTANCE_INVALID');
});
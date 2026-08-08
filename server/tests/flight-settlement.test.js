const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateFlightSettlement } = require('../economy/flightSettlement');

test('calculateFlightSettlement returns structured baseline revenue values', () => {
  const result = calculateFlightSettlement({
    baseRevenuePerKm: 105,
    routeDistanceKm: 900
  });

  assert.equal(result.success, true);
  assert.equal(result.baseRevenue, 94500);
  assert.equal(result.finalRevenue, 94500);
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
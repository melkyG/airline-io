const test = require('node:test');
const assert = require('node:assert/strict');

const { canonicalRouteKey, calculateRouteDistanceKm } = require('../routes');

test('canonicalRouteKey is non-directional', () => {
  assert.equal(canonicalRouteKey('YYZ', 'JFK'), 'JFK::YYZ');
  assert.equal(canonicalRouteKey('JFK', 'YYZ'), 'JFK::YYZ');
  assert.equal(canonicalRouteKey(' YYZ ', ' JFK '), 'JFK::YYZ');
});

test('calculateRouteDistanceKm returns a rounded kilometre distance', () => {
  const yyz = { lat: 43.6777, lng: -79.6248 };
  const jfk = { lat: 40.6413, lng: -73.7781 };

  const distanceKm = calculateRouteDistanceKm(yyz, jfk);

  assert.equal(Number.isInteger(distanceKm), true);
  assert.ok(distanceKm > 500);
  assert.ok(distanceKm < 600);
  assert.equal(distanceKm, calculateRouteDistanceKm(jfk, yyz));
});

test('calculateRouteDistanceKm returns zero for invalid coordinates', () => {
  assert.equal(calculateRouteDistanceKm(null, { lat: 1, lng: 2 }), 0);
  assert.equal(calculateRouteDistanceKm({ lat: 1, lng: 2 }, {}), 0);
});
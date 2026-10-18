const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REFERENCE_AIRPORT_PRICE,
  REFERENCE_DAILY_AIRPORT_FEE,
  AIRPORT_OPERATING_FEE_EXPONENT,
  calculateAirportOperatingFee
} = require('../economy/expenses');

function assertApprox(actual, expected, tolerance = 1) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test('representative airport base fees follow superlinear scaling', () => {
  const cases = [
    { basePrice: 500_000, expected: 3_000 },
    { basePrice: 5_000_000, expected: 33_661 },
    { basePrice: 50_000_000, expected: 377_678 },
    { basePrice: 225_000_000, expected: 1_832_291 },
    { basePrice: 450_000_000, expected: 3_793_813 }
  ];

  for (const { basePrice, expected } of cases) {
    const result = calculateAirportOperatingFee({ basePrice });
    assertApprox(result.baseFee, expected);
    assert.equal(result.finalFee, result.baseFee);
  }
});

test('neutral 1.0 expense factor leaves fee unchanged', () => {
  const result = calculateAirportOperatingFee({
    basePrice: 500_000,
    expenseFactor: 1.0
  });

  assert.equal(result.baseFee, 3_000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalFee, 3_000);
});

test('expense factor above 1.0 increases final fee', () => {
  const result = calculateAirportOperatingFee({
    basePrice: 500_000,
    expenseFactor: 2.0
  });

  assert.equal(result.baseFee, 3_000);
  assert.equal(result.expenseFactor, 2.0);
  assert.equal(result.finalFee, 6_000);
});

test('expense factor below 1.0 decreases final fee', () => {
  const result = calculateAirportOperatingFee({
    basePrice: 500_000,
    expenseFactor: 0.5
  });

  assert.equal(result.baseFee, 3_000);
  assert.equal(result.expenseFactor, 0.5);
  assert.equal(result.finalFee, 1_500);
});

test('invalid basePrice returns safe zero result', () => {
  assert.deepEqual(calculateAirportOperatingFee({ basePrice: -1000 }), {
    baseFee: 0,
    expenseFactor: 1.0,
    finalFee: 0
  });
  assert.deepEqual(calculateAirportOperatingFee({ basePrice: 'not a number' }), {
    baseFee: 0,
    expenseFactor: 1.0,
    finalFee: 0
  });
  assert.deepEqual(calculateAirportOperatingFee({}), {
    baseFee: 0,
    expenseFactor: 1.0,
    finalFee: 0
  });
});

test('invalid expense factor falls back to neutral 1.0', () => {
  const result = calculateAirportOperatingFee({
    basePrice: 500_000,
    expenseFactor: 'bad'
  });

  assert.equal(result.baseFee, 3_000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalFee, 3_000);
});

test('exposed constants are valid smoke-test values', () => {
  assert.equal(REFERENCE_AIRPORT_PRICE, 500_000);
  assert.equal(REFERENCE_DAILY_AIRPORT_FEE, 3_000);
  assert.equal(AIRPORT_OPERATING_FEE_EXPONENT, 1.05);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateAircraftFuelExpense } = require('../economy/expenses');

test('calculateAircraftFuelExpense 747 example', () => {
  const result = calculateAircraftFuelExpense({
    distanceKm: 550,
    fuelCostPerKm: 22
  });

  assert.equal(result.distanceKm, 550);
  assert.equal(result.fuelCostPerKm, 22);
  assert.equal(result.baseFuelCost, 12100);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalFuelCost, 12100);
});

test('calculateAircraftFuelExpense 737 example', () => {
  const result = calculateAircraftFuelExpense({
    distanceKm: 330,
    fuelCostPerKm: 15
  });

  assert.equal(result.distanceKm, 330);
  assert.equal(result.fuelCostPerKm, 15);
  assert.equal(result.baseFuelCost, 4950);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalFuelCost, 4950);
});

test('calculateAircraftFuelExpense zero distance', () => {
  const result = calculateAircraftFuelExpense({
    distanceKm: 0,
    fuelCostPerKm: 18
  });

  assert.equal(result.distanceKm, 0);
  assert.equal(result.baseFuelCost, 0);
  assert.equal(result.finalFuelCost, 0);
});

test('calculateAircraftFuelExpense non-1.0 expenseFactor', () => {
  const result = calculateAircraftFuelExpense({
    distanceKm: 500,
    fuelCostPerKm: 18,
    expenseFactor: 1.25
  });

  assert.equal(result.baseFuelCost, 9000);
  assert.equal(result.expenseFactor, 1.25);
  assert.equal(result.finalFuelCost, 11250);
});

test('calculateAircraftFuelExpense invalid distance', () => {
  const result = calculateAircraftFuelExpense({
    distanceKm: -100,
    fuelCostPerKm: 18
  });

  assert.equal(result.distanceKm, 0);
  assert.equal(result.baseFuelCost, 0);
  assert.equal(result.finalFuelCost, 0);
});

test('calculateAircraftFuelExpense invalid fuelCostPerKm', () => {
  const result = calculateAircraftFuelExpense({
    distanceKm: 550,
    fuelCostPerKm: -5
  });

  assert.equal(result.fuelCostPerKm, 0);
  assert.equal(result.baseFuelCost, 0);
  assert.equal(result.finalFuelCost, 0);
});

test('calculateAircraftFuelExpense invalid expenseFactor', () => {
  const result = calculateAircraftFuelExpense({
    distanceKm: 500,
    fuelCostPerKm: 18,
    expenseFactor: 0
  });

  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.baseFuelCost, 9000);
  assert.equal(result.finalFuelCost, 9000);
});

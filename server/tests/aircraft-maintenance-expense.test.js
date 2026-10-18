const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateAircraftMaintenanceExpense } = require('../economy/expenses');

test('ATR 72 monthly maintenance', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 24000
  });

  assert.equal(result.baseMaintenanceCost, 24000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalMaintenanceCost, 24000);
});

test('Bombardier CRJ900 monthly maintenance', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 51000
  });

  assert.equal(result.baseMaintenanceCost, 51000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalMaintenanceCost, 51000);
});

test('Boeing 737 monthly maintenance', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 80000
  });

  assert.equal(result.baseMaintenanceCost, 80000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalMaintenanceCost, 80000);
});

test('Boeing 747 monthly maintenance', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 112000
  });

  assert.equal(result.baseMaintenanceCost, 112000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalMaintenanceCost, 112000);
});

test('Airbus A350 monthly maintenance', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 148000
  });

  assert.equal(result.baseMaintenanceCost, 148000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalMaintenanceCost, 148000);
});

test('non-1.0 expense modifier', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 80000
  });

  assert.equal(result.baseMaintenanceCost, 80000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalMaintenanceCost, 80000);
});

test('non-1.0 expense modifier', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 100000,
    expenseFactor: 1.25
  });

  assert.equal(result.baseMaintenanceCost, 100000);
  assert.equal(result.expenseFactor, 1.25);
  assert.equal(result.finalMaintenanceCost, 125000);
});

test('invalid monthly maintenance cost', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: -10000,
    expenseFactor: 1.25
  });

  assert.equal(result.baseMaintenanceCost, 0);
  assert.equal(result.expenseFactor, 1.25);
  assert.equal(result.finalMaintenanceCost, 0);
});

test('invalid expense modifier', () => {
  const result = calculateAircraftMaintenanceExpense({
    monthlyMaintenanceCost: 100000,
    expenseFactor: 0
  });

  assert.equal(result.baseMaintenanceCost, 100000);
  assert.equal(result.expenseFactor, 1.0);
  assert.equal(result.finalMaintenanceCost, 100000);
});

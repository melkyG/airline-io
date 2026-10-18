// Server-authoritative game-design aircraft catalog.
// Values here are manually authored gameplay values.

const AIRCRAFT_SCHEMA_KEYS = Object.freeze([
  'aircraftCatalogId',
  'manufacturer',
  'model',
  'purchasePrice',
  'rangeKm',
  'cruiseSpeedKmH',
  'baseRevenuePerKm',
  'fuelCostPerKm',
  'monthlyMaintenanceCost'
]);

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
}

function assertFiniteNonNegativeNumber(value, fieldName) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a finite non-negative number.`);
  }
}

function assertFinitePositiveNumber(value, fieldName) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a finite positive number.`);
  }
}

function validateAircraftCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('Aircraft catalog entry must be an object.');
  }

  const keys = Object.keys(entry);
  const unexpectedKeys = keys.filter((key) => !AIRCRAFT_SCHEMA_KEYS.includes(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Aircraft catalog entry has unknown properties: ${unexpectedKeys.join(', ')}`);
  }

  const missingKeys = AIRCRAFT_SCHEMA_KEYS.filter((key) => !keys.includes(key));
  if (missingKeys.length > 0) {
    throw new Error(`Aircraft catalog entry is missing required properties: ${missingKeys.join(', ')}`);
  }

  assertNonEmptyString(entry.aircraftCatalogId, 'aircraftCatalogId');
  assertNonEmptyString(entry.manufacturer, 'manufacturer');
  assertNonEmptyString(entry.model, 'model');
  assertFiniteNonNegativeNumber(entry.purchasePrice, 'purchasePrice');
  assertFiniteNonNegativeNumber(entry.rangeKm, 'rangeKm');
  assertFinitePositiveNumber(entry.cruiseSpeedKmH, 'cruiseSpeedKmH');
  assertFinitePositiveNumber(entry.baseRevenuePerKm, 'baseRevenuePerKm');
  assertFiniteNonNegativeNumber(entry.fuelCostPerKm, 'fuelCostPerKm');
  assertFiniteNonNegativeNumber(entry.monthlyMaintenanceCost, 'monthlyMaintenanceCost');

  return Object.freeze({
    aircraftCatalogId: entry.aircraftCatalogId.trim(),
    manufacturer: entry.manufacturer.trim(),
    model: entry.model.trim(),
    purchasePrice: entry.purchasePrice,
    rangeKm: entry.rangeKm,
    cruiseSpeedKmH: entry.cruiseSpeedKmH,
    baseRevenuePerKm: entry.baseRevenuePerKm,
    fuelCostPerKm: entry.fuelCostPerKm,
    monthlyMaintenanceCost: entry.monthlyMaintenanceCost
  });
}

const FULL_AIRCRAFT_CATALOG = Object.freeze([
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'ATR_72',
    manufacturer: 'ATR',
    model: '72',
    purchasePrice: 100000,
    rangeKm: 1500,
    cruiseSpeedKmH: 510,
    baseRevenuePerKm: 11.25,
    fuelCostPerKm: 4,
    monthlyMaintenanceCost: 24000
  }),
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'BOMBARDIER_CRJ900',
    manufacturer: 'Bombardier',
    model: 'CRJ900',
    purchasePrice: 200000,
    rangeKm: 3500,
    cruiseSpeedKmH: 830,
    baseRevenuePerKm: 23.25,
    fuelCostPerKm: 9,
    monthlyMaintenanceCost: 51000
  }),
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'BOEING_737',
    manufacturer: 'Boeing',
    model: '737',
    purchasePrice: 300000,
    rangeKm: 6500,
    cruiseSpeedKmH: 840,
    baseRevenuePerKm: 36.02,
    fuelCostPerKm: 15,
    monthlyMaintenanceCost: 80000
  }),
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'AIRBUS_A320',
    manufacturer: 'Airbus',
    model: 'A320',
    purchasePrice: 280000,
    rangeKm: 5700,
    cruiseSpeedKmH: 830,
    baseRevenuePerKm: 32,
    fuelCostPerKm: 13,
    monthlyMaintenanceCost: 72000
  }),
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'BOEING_747',
    manufacturer: 'Boeing',
    model: '747',
    purchasePrice: 400000,
    rangeKm: 14000,
    cruiseSpeedKmH: 900,
    baseRevenuePerKm: 49.5,
    fuelCostPerKm: 22,
    monthlyMaintenanceCost: 112000
  }),
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'AIRBUS_A350',
    manufacturer: 'Airbus',
    model: 'A350',
    purchasePrice: 500000,
    rangeKm: 15500,
    cruiseSpeedKmH: 905,
    baseRevenuePerKm: 64,
    fuelCostPerKm: 24,
    monthlyMaintenanceCost: 148000
  })
]);

const ACTIVE_AIRCRAFT_CATALOG_IDS = Object.freeze([
  'ATR_72',
  'BOMBARDIER_CRJ900',
  'BOEING_737',
  'AIRBUS_A320',
  'BOEING_747',
  'AIRBUS_A350'
]);
const ACTIVE_AIRCRAFT_CATALOG_ID_SET = new Set(ACTIVE_AIRCRAFT_CATALOG_IDS);

const AIRCRAFT_CATALOG = Object.freeze(
  FULL_AIRCRAFT_CATALOG.filter((aircraft) => ACTIVE_AIRCRAFT_CATALOG_ID_SET.has(aircraft.aircraftCatalogId))
);

// ------------------------------------------------------------------
// Reserved aircraft for future expansion
// Temporarily disabled while gameplay systems are developed.
// ------------------------------------------------------------------
const RESERVED_AIRCRAFT_CATALOG = Object.freeze(
  FULL_AIRCRAFT_CATALOG.filter((aircraft) => !ACTIVE_AIRCRAFT_CATALOG_ID_SET.has(aircraft.aircraftCatalogId))
);

const AIRCRAFT_CATALOG_BY_ID = Object.freeze(
  AIRCRAFT_CATALOG.reduce((lookup, aircraft) => {
    lookup[aircraft.aircraftCatalogId] = aircraft;
    return lookup;
  }, Object.create(null))
);

module.exports = {
  AIRCRAFT_CATALOG,
  AIRCRAFT_CATALOG_BY_ID,
  RESERVED_AIRCRAFT_CATALOG,
  FULL_AIRCRAFT_CATALOG,
  validateAircraftCatalogEntry
};

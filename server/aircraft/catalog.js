// Server-authoritative game-design aircraft catalog.
// Values here are manually authored gameplay values.

const AIRCRAFT_SCHEMA_KEYS = Object.freeze([
  'aircraftCatalogId',
  'manufacturer',
  'model',
  'purchasePrice',
  'rangeKm',
  'cruiseSpeedKmH',
  'baseRevenuePerKm'
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

  return Object.freeze({
    aircraftCatalogId: entry.aircraftCatalogId.trim(),
    manufacturer: entry.manufacturer.trim(),
    model: entry.model.trim(),
    purchasePrice: entry.purchasePrice,
    rangeKm: entry.rangeKm,
    cruiseSpeedKmH: entry.cruiseSpeedKmH,
    baseRevenuePerKm: entry.baseRevenuePerKm
  });
}

const FULL_AIRCRAFT_CATALOG = Object.freeze([
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'BOEING_747',
    manufacturer: 'Boeing',
    model: '747',
    purchasePrice: 300000,
    rangeKm: 14000,
    cruiseSpeedKmH: 900,
    baseRevenuePerKm: 130
  }),
  validateAircraftCatalogEntry({
    aircraftCatalogId: 'BOEING_737',
    manufacturer: 'Boeing',
    model: '737',
    purchasePrice: 220000,
    rangeKm: 6500,
    cruiseSpeedKmH: 840,
    baseRevenuePerKm: 105
  })
]);

const ACTIVE_AIRCRAFT_CATALOG_IDS = Object.freeze(['BOEING_747', 'BOEING_737']);
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

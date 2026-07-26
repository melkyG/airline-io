const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OWNED_AIRCRAFT_STATUS,
  createOwnedAircraftInstance,
  createInitialOwnedAircraftState
} = require('../aircraft/ownership');
const {
  AIRCRAFT_CATALOG,
  RESERVED_AIRCRAFT_CATALOG,
  FULL_AIRCRAFT_CATALOG,
  validateAircraftCatalogEntry
} = require('../aircraft/catalog');

test('active aircraft catalog is manually authored with only BOEING_747 active', () => {
  assert.equal(Array.isArray(AIRCRAFT_CATALOG), true);
  assert.equal(AIRCRAFT_CATALOG.length, 1);
  assert.equal(AIRCRAFT_CATALOG[0].aircraftCatalogId, 'BOEING_747');
  assert.equal(AIRCRAFT_CATALOG[0].manufacturer, 'Boeing');
  assert.equal(AIRCRAFT_CATALOG[0].model, '747');
  assert.equal(AIRCRAFT_CATALOG[0].purchasePrice, 300000);
  assert.equal(AIRCRAFT_CATALOG[0].rangeKm, 14000);
  assert.equal('passengerCapacity' in AIRCRAFT_CATALOG[0], false);
  assert.equal('cruiseSpeedKph' in AIRCRAFT_CATALOG[0], false);
  assert.deepEqual(Object.keys(AIRCRAFT_CATALOG[0]).sort(), ['aircraftCatalogId', 'manufacturer', 'model', 'purchasePrice', 'rangeKm']);

  assert.equal(Array.isArray(RESERVED_AIRCRAFT_CATALOG), true);
  assert.equal(RESERVED_AIRCRAFT_CATALOG.length, 0);

  assert.equal(FULL_AIRCRAFT_CATALOG.length, AIRCRAFT_CATALOG.length + RESERVED_AIRCRAFT_CATALOG.length);
});

test('validateAircraftCatalogEntry enforces required schema and rejects unknown properties', () => {
  assert.throws(
    () => {
      validateAircraftCatalogEntry({
        aircraftCatalogId: '',
        manufacturer: 'Boeing',
        model: '747',
        purchasePrice: 300000,
        rangeKm: 14000
      });
    },
    /aircraftCatalogId must be a non-empty string/
  );

  assert.throws(
    () => {
      validateAircraftCatalogEntry({
        aircraftCatalogId: 'BOEING_747',
        manufacturer: 'Boeing',
        model: '747',
        purchasePrice: 300000,
        rangeKm: 14000,
        speed: 900
      });
    },
    /unknown properties/i
  );

  assert.throws(
    () => {
      validateAircraftCatalogEntry({
        aircraftCatalogId: 'BOEING_747',
        manufacturer: 'Boeing',
        model: '747',
        purchasePrice: -1,
        rangeKm: 14000
      });
    },
    /purchasePrice must be a finite non-negative number/
  );
});

test('createOwnedAircraftInstance creates a server-owned aircraft instance with catalog reference only', () => {
  const instance = createOwnedAircraftInstance({
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000
  });

  assert.equal(typeof instance.aircraftInstanceId, 'string');
  assert.ok(instance.aircraftInstanceId.startsWith('acft-'));
  assert.equal(instance.ownerPlayerId, 'p1');
  assert.equal(instance.aircraftCatalogId, 'BOEING_747');
  assert.equal(instance.acquisitionPrice, 300000);
  assert.equal(instance.status, OWNED_AIRCRAFT_STATUS.AVAILABLE);
  assert.equal(instance.assignedRouteId, null);
  assert.equal('cruiseSpeedKph' in instance, false);
  assert.equal('passengerCapacity' in instance, false);
  assert.equal('rangeKm' in instance, false);
  assert.equal('homeAirportId' in instance, false);
  assert.equal('currentAirportId' in instance, false);
  assert.equal('conditionPercent' in instance, false);
  assert.equal('utilizationHours' in instance, false);
  assert.equal('acquiredAt' in instance, false);
});

test('createOwnedAircraftInstance rejects unknown catalog IDs', () => {
  assert.throws(
    () => {
      createOwnedAircraftInstance({
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'UNKNOWN_MODEL'
      });
    },
    /Unknown aircraft catalog id/
  );
});

test('createInitialOwnedAircraftState supports multiple copies of same aircraft model per player', () => {
  const ownedAircraft = createInitialOwnedAircraftState(
    [
      { id: 'p1' },
      { id: 'p2' }
    ],
    {
      starterAircraftCatalogId: 'BOEING_747',
      starterCopiesPerPlayer: 2
    }
  );

  assert.equal(ownedAircraft.length, 4);

  const p1Aircraft = ownedAircraft.filter((instance) => instance.ownerPlayerId === 'p1');
  assert.equal(p1Aircraft.length, 2);
  assert.equal(p1Aircraft[0].aircraftCatalogId, 'BOEING_747');
  assert.equal(p1Aircraft[1].aircraftCatalogId, 'BOEING_747');
  assert.notEqual(p1Aircraft[0].aircraftInstanceId, p1Aircraft[1].aircraftInstanceId);

  const uniqueIds = new Set(ownedAircraft.map((instance) => instance.aircraftInstanceId));
  assert.equal(uniqueIds.size, ownedAircraft.length);
});

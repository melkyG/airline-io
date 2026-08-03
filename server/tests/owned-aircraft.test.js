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

test('active aircraft catalog is manually authored with BOEING_747 and BOEING_737 active', () => {
  assert.equal(Array.isArray(AIRCRAFT_CATALOG), true);
  assert.equal(AIRCRAFT_CATALOG.length, 2);

  const catalogById = AIRCRAFT_CATALOG.reduce((lookup, aircraft) => {
    lookup[aircraft.aircraftCatalogId] = aircraft;
    return lookup;
  }, Object.create(null));

  assert.deepEqual(Object.keys(catalogById).sort(), ['BOEING_737', 'BOEING_747']);

  assert.equal(catalogById.BOEING_747.manufacturer, 'Boeing');
  assert.equal(catalogById.BOEING_747.model, '747');
  assert.equal(catalogById.BOEING_747.purchasePrice, 300000);
  assert.equal(catalogById.BOEING_747.rangeKm, 14000);
  assert.equal(catalogById.BOEING_747.cruiseSpeedKmH, 900);

  assert.equal(catalogById.BOEING_737.manufacturer, 'Boeing');
  assert.equal(catalogById.BOEING_737.model, '737');
  assert.equal(catalogById.BOEING_737.purchasePrice, 220000);
  assert.equal(catalogById.BOEING_737.rangeKm, 6500);
  assert.equal(catalogById.BOEING_737.cruiseSpeedKmH, 840);

  AIRCRAFT_CATALOG.forEach((entry) => {
    assert.equal('passengerCapacity' in entry, false);
    assert.equal('cruiseSpeedKph' in entry, false);
    assert.deepEqual(Object.keys(entry).sort(), [
      'aircraftCatalogId',
      'cruiseSpeedKmH',
      'manufacturer',
      'model',
      'purchasePrice',
      'rangeKm'
    ]);
  });

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
        rangeKm: 14000,
        cruiseSpeedKmH: 900
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
        cruiseSpeedKmH: 900,
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
        rangeKm: 14000,
        cruiseSpeedKmH: 900
      });
    },
    /purchasePrice must be a finite non-negative number/
  );

  assert.throws(
    () => {
      validateAircraftCatalogEntry({
        aircraftCatalogId: 'BOEING_747',
        manufacturer: 'Boeing',
        model: '747',
        purchasePrice: 300000,
        rangeKm: 14000,
        cruiseSpeedKmH: 0
      });
    },
    /cruiseSpeedKmH must be a finite positive number/
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

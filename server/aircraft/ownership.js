const { randomUUID } = require('node:crypto');
const { AIRCRAFT_CATALOG_BY_ID } = require('./catalog');

const OWNED_AIRCRAFT_STATUS = Object.freeze({
  AVAILABLE: 'available',
  ASSIGNED: 'assigned',
  MAINTENANCE: 'maintenance'
});

function createOwnedAircraftInstance({
  ownerPlayerId,
  aircraftCatalogId,
  acquisitionPrice = null,
  status = OWNED_AIRCRAFT_STATUS.AVAILABLE,
  assignedRouteId = null
}) {
  const normalizedOwnerPlayerId = String(ownerPlayerId || '').trim();
  const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

  if (!normalizedOwnerPlayerId) {
    throw new Error('ownerPlayerId is required to create owned aircraft.');
  }

  if (!normalizedAircraftCatalogId || !AIRCRAFT_CATALOG_BY_ID[normalizedAircraftCatalogId]) {
    throw new Error(`Unknown aircraft catalog id: ${normalizedAircraftCatalogId || '<empty>'}`);
  }

  if (acquisitionPrice !== null && (!Number.isFinite(acquisitionPrice) || acquisitionPrice < 0)) {
    throw new Error('acquisitionPrice must be null or a finite non-negative number.');
  }

  return {
    aircraftInstanceId: `acft-${randomUUID()}`,
    ownerPlayerId: normalizedOwnerPlayerId,
    aircraftCatalogId: normalizedAircraftCatalogId,
    acquisitionPrice,
    status,
    assignedRouteId,
    pendingRouteExitAction: null,
    pendingSaleRefund: null
  };
}

function createInitialOwnedAircraftState(players, options = {}) {
  const sourcePlayers = Array.isArray(players) ? players : [];
  const starterAircraftCatalogId =
    typeof options.starterAircraftCatalogId === 'string' && options.starterAircraftCatalogId.trim()
      ? options.starterAircraftCatalogId.trim()
      : null;
  const starterCopiesPerPlayer =
    Number.isInteger(options.starterCopiesPerPlayer) && options.starterCopiesPerPlayer > 0
      ? options.starterCopiesPerPlayer
      : 0;

  if (!starterAircraftCatalogId || starterCopiesPerPlayer <= 0) {
    return [];
  }

  return sourcePlayers.reduce((ownedAircraft, player) => {
    if (!player || !player.id) {
      return ownedAircraft;
    }

    for (let copyIndex = 0; copyIndex < starterCopiesPerPlayer; copyIndex += 1) {
      ownedAircraft.push(
        createOwnedAircraftInstance({
          ownerPlayerId: player.id,
          aircraftCatalogId: starterAircraftCatalogId
        })
      );
    }

    return ownedAircraft;
  }, []);
}

module.exports = {
  OWNED_AIRCRAFT_STATUS,
  createOwnedAircraftInstance,
  createInitialOwnedAircraftState
};

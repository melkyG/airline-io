const { AIRPORT_CATALOG } = require('../airports/catalog');
const { AIRCRAFT_CATALOG_BY_ID } = require('../aircraft/catalog');
const {
  calculateAirportSellToGamePrice,
  calculateAircraftSellToGamePrice
} = require('./liquidation');

const AIRPORT_DEFINITIONS_BY_ID = AIRPORT_CATALOG.reduce((lookup, airport) => {
  lookup.set(String(airport.id || '').trim(), airport);
  return lookup;
}, new Map());

function normalizeCapital(value) {
  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) ? normalizedValue : 0;
}

function calculateNetWorthByPlayer(gameState) {
  const players = Array.isArray(gameState && gameState.players) ? gameState.players : [];
  const airports = Array.isArray(gameState && gameState.airports) ? gameState.airports : [];
  const ownedAircraft = Array.isArray(gameState && gameState.ownedAircraft) ? gameState.ownedAircraft : [];

  const netWorthByPlayerId = new Map();

  players.forEach((player) => {
    if (!player || player.id == null) {
      return;
    }

    netWorthByPlayerId.set(String(player.id), normalizeCapital(player.capital));
  });

  airports.forEach((airportState) => {
    if (!airportState || airportState.ownerPlayerId == null) {
      return;
    }

    const normalizedOwnerPlayerId = String(airportState.ownerPlayerId);
    if (!netWorthByPlayerId.has(normalizedOwnerPlayerId)) {
      return;
    }

    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(String(airportState.airportId || '').trim());
    if (!airportDefinition) {
      return;
    }

    const currentNetWorth = netWorthByPlayerId.get(normalizedOwnerPlayerId);
    const airportLiquidationValue = calculateAirportSellToGamePrice(airportDefinition.basePrice);
    netWorthByPlayerId.set(normalizedOwnerPlayerId, currentNetWorth + airportLiquidationValue);
  });

  ownedAircraft.forEach((aircraft) => {
    if (!aircraft || aircraft.ownerPlayerId == null) {
      return;
    }

    const normalizedOwnerPlayerId = String(aircraft.ownerPlayerId);
    if (!netWorthByPlayerId.has(normalizedOwnerPlayerId)) {
      return;
    }

    const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(aircraft.aircraftCatalogId || '').trim()];
    if (!aircraftDefinition) {
      return;
    }

    const currentNetWorth = netWorthByPlayerId.get(normalizedOwnerPlayerId);
    const aircraftLiquidationValue = calculateAircraftSellToGamePrice(aircraftDefinition.purchasePrice);
    netWorthByPlayerId.set(normalizedOwnerPlayerId, currentNetWorth + aircraftLiquidationValue);
  });

  return netWorthByPlayerId;
}

function calculatePlayerNetWorth(gameState, playerId) {
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) {
    return 0;
  }

  const netWorthByPlayerId = calculateNetWorthByPlayer(gameState);
  if (!netWorthByPlayerId.has(normalizedPlayerId)) {
    return 0;
  }

  return netWorthByPlayerId.get(normalizedPlayerId);
}

module.exports = {
  calculateNetWorthByPlayer,
  calculatePlayerNetWorth
};
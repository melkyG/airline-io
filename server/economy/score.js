const { calculateNetWorthByPlayer } = require('./netWorth');
const { AIRPORT_CATALOG } = require('../airports/catalog');
const { AIRCRAFT_CATALOG_BY_ID } = require('../aircraft/catalog');

const NET_WORTH_SCORE_BASELINE = 1_000_000;
const NET_WORTH_SCORE_TARGET = 100_000_000_000;
const NET_WORTH_SCORE_TARGET_POINTS = 500;
const NET_WORTH_SCORE_RANGE = NET_WORTH_SCORE_TARGET - NET_WORTH_SCORE_BASELINE;

const AIRPORT_DEFINITIONS_BY_ID = AIRPORT_CATALOG.reduce((lookup, airport) => {
  lookup.set(String(airport.id || '').trim(), airport);
  return lookup;
}, new Map());

function getAuthoritativePlayers(gameState) {
  return gameState && Array.isArray(gameState.players) ? gameState.players : [];
}

function calculateNetWorthScore(netWorth) {
  const normalizedNetWorth = Number(netWorth);
  if (!Number.isFinite(normalizedNetWorth) || normalizedNetWorth <= NET_WORTH_SCORE_BASELINE) {
    return 0;
  }

  return (
    NET_WORTH_SCORE_TARGET_POINTS *
    (normalizedNetWorth - NET_WORTH_SCORE_BASELINE) /
    NET_WORTH_SCORE_RANGE
  );
}

function calculateDerivedGameplayScore(gameState, playerId) {
  const netWorthByPlayerId = calculateNetWorthByPlayer(gameState);
  const playerNetWorth = netWorthByPlayerId.has(playerId) ? netWorthByPlayerId.get(playerId) : 0;
  const financialScore = calculateNetWorthScore(playerNetWorth);
  const airportScore = calculateAirportScore(gameState, playerId);
  const routeScore = calculateRouteScore(gameState, playerId);
  return financialScore + airportScore + routeScore;
}

function calculateAirportScore(gameState, playerId) {
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) {
    return 0;
  }

  const airports = Array.isArray(gameState && gameState.airports) ? gameState.airports : [];
  let score = 0;

  airports.forEach((airportState) => {
    if (!airportState || airportState.ownerPlayerId == null) {
      return;
    }

    if (String(airportState.ownerPlayerId) !== normalizedPlayerId) {
      return;
    }

    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(String(airportState.airportId || '').trim());
    if (!airportDefinition) {
      return;
    }

    const basePrice = Number(airportDefinition.basePrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      return;
    }

    score += 115 * Math.pow(basePrice / 800_000_000, 0.35);
  });

  return score;
}

function calculateRouteScore(gameState, playerId) {
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) {
    return 0;
  }

  const routes = Array.isArray(gameState && gameState.routes) ? gameState.routes : [];
  const ownedAircraft = Array.isArray(gameState && gameState.ownedAircraft) ? gameState.ownedAircraft : [];
  const aircraftByInstanceId = ownedAircraft.reduce((lookup, aircraft) => {
    if (!aircraft || aircraft.aircraftInstanceId == null) {
      return lookup;
    }

    lookup.set(String(aircraft.aircraftInstanceId), aircraft);
    return lookup;
  }, new Map());

  let score = 0;

  routes.forEach((route) => {
    if (!route || route.ownerPlayerId == null) {
      return;
    }

    if (String(route.ownerPlayerId) !== normalizedPlayerId) {
      return;
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];

    let routeAssignedScore = 0;
    let validAircraftCount = 0;

    assignedAircraftInstanceIds.forEach((instanceId) => {
      const normalizedInstanceId = String(instanceId || '').trim();
      if (!normalizedInstanceId) {
        return;
      }

      const aircraft = aircraftByInstanceId.get(normalizedInstanceId);
      if (!aircraft) {
        return;
      }

      if (String(aircraft.ownerPlayerId) !== normalizedPlayerId) {
        return;
      }

      if (String(aircraft.assignedRouteId || '').trim() !== String(route.routeId || '').trim()) {
        return;
      }

      if (String(aircraft.status || '').trim() !== 'assigned') {
        return;
      }

      const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(aircraft.aircraftCatalogId || '').trim()];
      if (!aircraftDefinition) {
        return;
      }

      const purchasePrice = Number(aircraftDefinition.purchasePrice);
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        return;
      }

      routeAssignedScore += purchasePrice / 1_000_000;
      validAircraftCount += 1;
    });

    if (validAircraftCount > 0) {
      score += 10 + routeAssignedScore;
    }
  });

  return score;
}

function calculatePlayerScore(gameState, playerId) {
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) {
    return 0;
  }

  const players = getAuthoritativePlayers(gameState);
  const player = players.find((candidate) => String(candidate && candidate.id) === normalizedPlayerId);
  if (!player) {
    return 0;
  }

  const debugScoreOffset = Number.isFinite(player.debugScoreOffset) ? player.debugScoreOffset : 0;
  return calculateDerivedGameplayScore(gameState, normalizedPlayerId) + debugScoreOffset;
}

function calculateScoreByPlayer(gameState) {
  const scoresByPlayerId = new Map();
  const players = getAuthoritativePlayers(gameState);

  players.forEach((player) => {
    const playerId = String(player && player.id ? player.id : '').trim();
    if (!playerId) {
      return;
    }

    scoresByPlayerId.set(playerId, calculatePlayerScore(gameState, playerId));
  });

  return scoresByPlayerId;
}

module.exports = {
  NET_WORTH_SCORE_BASELINE,
  NET_WORTH_SCORE_TARGET,
  NET_WORTH_SCORE_TARGET_POINTS,
  calculateNetWorthScore,
  calculateAirportScore,
  calculateRouteScore,
  calculatePlayerScore,
  calculateScoreByPlayer
};
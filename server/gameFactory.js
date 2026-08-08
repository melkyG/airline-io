const { randomUUID } = require('node:crypto');
const { AIRPORT_CATALOG } = require('./airports/catalog');

const STARTING_CAPITAL = 1000000;
const GAME_DURATION_MS = 30 * 60 * 1000;
const SCORE_TO_WIN = 1000;
const SIMULATION_SPEED_MULTIPLIER = 10000;

function createInitialAirportState() {
  return AIRPORT_CATALOG.map((airport) => ({
    airportId: airport.id,
    ownerPlayerId: null,
    saleListing: null
  }));
}

function createGame(lobbyPlayers) {
  const startedAt = Date.now();
  const players = Array.from(lobbyPlayers || []).map((player) => ({
    id: player.id,
    username: player.displayName,
    isBot: Boolean(player && player.isBot),
    capital: STARTING_CAPITAL,
    colorId: player && player.colorId ? player.colorId : null,
    colorHex: player && player.colorHex ? player.colorHex : null
  }));

  return {
    id: `game-${randomUUID()}`,
    status: 'active',
    createdAt: startedAt,
    startedAt,
    endsAt: startedAt + GAME_DURATION_MS,
    durationMs: GAME_DURATION_MS,
    scoreToWin: SCORE_TO_WIN,
    simulationStartedAtRealMs: null,
    simulationStartedAtGameMs: null,
    simulationSpeedMultiplier: SIMULATION_SPEED_MULTIPLIER,
    simulationEndedAtGameMs: null,
    players,
    airports: createInitialAirportState(),
    ownedAircraft: [],
    routes: [],
    flights: []
  };
}

module.exports = {
  STARTING_CAPITAL,
  GAME_DURATION_MS,
  SCORE_TO_WIN,
  SIMULATION_SPEED_MULTIPLIER,
  createGame
};

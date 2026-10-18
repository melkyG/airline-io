const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const { WORLD_EVENT_DAY_SIMULATION_MS } = require('../world/worldEvents');
const { OWNED_AIRCRAFT_STATUS } = require('../aircraft/ownership');

const WEEK_MS = WORLD_EVENT_DAY_SIMULATION_MS * 7;

function createManager() {
  return {
    io: {
      to() {
        return { emit() {} };
      }
    }
  };
}

function createBaseState() {
  return {
    id: 'game-weekly-fuel-1',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 1,
    players: [
      { id: 'p1', username: 'Alice', capital: 1_000_000 },
      { id: 'p2', username: 'Bot', capital: 500_000 }
    ],
    airports: [],
    ownedAircraft: [
      {
        aircraftInstanceId: 'acft-747',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      },
      {
        aircraftInstanceId: 'acft-737',
        ownerPlayerId: 'p1',
        aircraftCatalogId: 'BOEING_737',
        acquisitionPrice: 220000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      },
      {
        aircraftInstanceId: 'acft-bot',
        ownerPlayerId: 'p2',
        aircraftCatalogId: 'BOEING_747',
        acquisitionPrice: 300000,
        status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
        assignedRouteId: null
      }
    ],
    routes: [],
    flights: [],
    world: { countryProfitFactors: {} }
  };
}

test('no charge on baseline initialization', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-747', 550);

  const result = game.processWeeklyFuelExpenses(0);

  assert.equal(result, false);
  assert.equal(game.lastFuelExpenseWeekIndex, 0);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000);
  assert.equal(game.weeklyAircraftDistanceKm.get('acft-747'), 550);
});

test('one aircraft charged correctly after one week', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-747', 550);

  game.processWeeklyFuelExpenses(0);
  const result = game.processWeeklyFuelExpenses(WEEK_MS);

  assert.equal(result, true);
  assert.equal(game.lastFuelExpenseWeekIndex, 1);
  assert.equal(game.weeklyAircraftDistanceKm.size, 0);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 12100);
});

test('Airbus A320 fuel expense uses its $13 per km catalog cost', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-a320',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'AIRBUS_A320',
    acquisitionPrice: 280000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];
  game.weeklyAircraftDistanceKm.set('acft-a320', 550);

  game.processWeeklyFuelExpenses(0);
  const result = game.processWeeklyFuelExpenses(WEEK_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - (550 * 13));
});

test('two aircraft with different models charged correctly', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-747', 500);
  game.weeklyAircraftDistanceKm.set('acft-737', 330);

  game.processWeeklyFuelExpenses(0);
  const result = game.processWeeklyFuelExpenses(WEEK_MS);

  assert.equal(result, true);
  assert.equal(game.weeklyAircraftDistanceKm.size, 0);
  assert.equal(
    game.authoritativeState.players[0].capital,
    1_000_000 - (500 * 22 + 330 * 15)
  );
});

test('zero-distance aircraft not charged and accumulator resets', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-747', 0);

  game.processWeeklyFuelExpenses(0);
  const result = game.processWeeklyFuelExpenses(WEEK_MS);

  assert.equal(result, false);
  assert.equal(game.weeklyAircraftDistanceKm.size, 0);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000);
});

test('sold/nonexistent aircraft not charged', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-missing', 1000);

  game.processWeeklyFuelExpenses(0);
  const result = game.processWeeklyFuelExpenses(WEEK_MS);

  assert.equal(result, false);
  assert.equal(game.weeklyAircraftDistanceKm.size, 0);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000);
});

test('bot or disconnected owner is still charged', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-bot', 100);

  game.processWeeklyFuelExpenses(0);
  const result = game.processWeeklyFuelExpenses(WEEK_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[1].capital, 500_000 - 2200);
});

test('fuel deduction uses authoritative player, not runtime player object', () => {
  const game = new Game(createBaseState(), createManager());

  assert.equal(game.players.size, 0);

  const runtimePlayer = { id: 'p1', capital: 999 };
  game.players.set('p1', runtimePlayer);

  game.weeklyAircraftDistanceKm.set('acft-747', 550);
  game.processWeeklyFuelExpenses(0);
  game.processWeeklyFuelExpenses(WEEK_MS);

  assert.equal(runtimePlayer.capital, 999);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 12100);
});

test('crossing more than one week boundary is handled deterministically', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-747', 100);

  game.processWeeklyFuelExpenses(0);
  const result = game.processWeeklyFuelExpenses(WEEK_MS * 3);

  assert.equal(result, true);
  assert.equal(game.lastFuelExpenseWeekIndex, 3);
  assert.equal(game.weeklyAircraftDistanceKm.size, 0);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 2200);
});

test('expected capital ledger stays reconciled after weekly fuel expenses', () => {
  const game = new Game(createBaseState(), createManager());
  game.weeklyAircraftDistanceKm.set('acft-747', 550);

  game.processWeeklyFuelExpenses(0);
  game.processWeeklyFuelExpenses(WEEK_MS);

  const player = game.authoritativeState.players[0];
  assert.equal(player.capital, 1_000_000 - 12100);
  assert.equal(game.economyDiagnostics.expectedCapitalByPlayerId.get('p1'), player.capital);
});

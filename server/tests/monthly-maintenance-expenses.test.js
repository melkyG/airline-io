const test = require('node:test');
const assert = require('node:assert/strict');

const Game = require('../Game');
const { WORLD_EVENT_DAY_SIMULATION_MS } = require('../world/worldEvents');
const { OWNED_AIRCRAFT_STATUS } = require('../aircraft/ownership');

const MONTH_MS = WORLD_EVENT_DAY_SIMULATION_MS * 30;

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
    id: 'game-monthly-maintenance-1',
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

test('baseline initialization does not charge', () => {
  const game = new Game(createBaseState(), createManager());

  const result = game.processMonthlyMaintenanceExpenses(0);

  assert.equal(result, false);
  assert.equal(game.lastMaintenanceExpenseMonthIndex, 0);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000);
});

test('one 747 charges exactly $112,000', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-747',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, true);
  assert.equal(game.lastMaintenanceExpenseMonthIndex, 1);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 112_000);
});

test('one 737 charges exactly $80,000', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-737',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_737',
    acquisitionPrice: 220000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 80_000);
});

test('one Airbus A320 charges exactly $72,000 monthly maintenance', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-a320',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'AIRBUS_A320',
    acquisitionPrice: 280000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 72_000);
});

test('owning one of each charges $192,000', () => {
  const game = new Game(createBaseState(), createManager());

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 192_000);
});

test('idle available aircraft is still charged', () => {
  const game = new Game(createBaseState(), createManager());

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 192_000);
});

test('assigned aircraft is still charged', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-747',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.ASSIGNED,
    assignedRouteId: 'route-1'
  }];

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 112_000);
});

test('bot or disconnected owner is still charged', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-bot',
    ownerPlayerId: 'p2',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, true);
  assert.equal(game.authoritativeState.players[1].capital, 500_000 - 112_000);
});

test('sold or nonexistent aircraft is not charged', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-missing',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'UNKNOWN_MODEL',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(result, false);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000);
});

test('maintenance deducts from authoritative player, not runtime this.players', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-747',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  const runtimePlayer = { id: 'p1', capital: 999 };
  game.players.set('p1', runtimePlayer);

  game.processMonthlyMaintenanceExpenses(0);
  game.processMonthlyMaintenanceExpenses(MONTH_MS);

  assert.equal(runtimePlayer.capital, 999);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 112_000);
});

test('crossing multiple month boundaries charges once for each crossed month', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-747',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  game.processMonthlyMaintenanceExpenses(0);
  const result = game.processMonthlyMaintenanceExpenses(MONTH_MS * 2);

  assert.equal(result, true);
  assert.equal(game.lastMaintenanceExpenseMonthIndex, 2);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - 224_000);
});

test('expected capital ledger stays reconciled after monthly maintenance expenses', () => {
  const game = new Game(createBaseState(), createManager());
  game.authoritativeState.ownedAircraft = [{
    aircraftInstanceId: 'acft-747',
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: OWNED_AIRCRAFT_STATUS.AVAILABLE,
    assignedRouteId: null
  }];

  game.processMonthlyMaintenanceExpenses(0);
  game.processMonthlyMaintenanceExpenses(MONTH_MS);

  const player = game.authoritativeState.players[0];
  assert.equal(player.capital, 1_000_000 - 112_000);
  assert.equal(game.economyDiagnostics.expectedCapitalByPlayerId.get('p1'), player.capital);
});

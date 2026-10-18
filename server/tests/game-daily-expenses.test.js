const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');
const { calculateAirportOperatingFee } = require('../economy/expenses');
const { WORLD_EVENT_DAY_SIMULATION_MS } = require('../world/worldEvents');

const DAY = WORLD_EVENT_DAY_SIMULATION_MS;

function createManager() {
  return { io: { to: () => ({ emit: () => {}, volatile: { emit: () => {} } }) } };
}

function createGameState(overrides = {}) {
  return {
    id: 'game-daily-expenses',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 3600000,
    durationMs: 3600000,
    scoreToWin: 1000,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 15000,
    simulationEndedAtGameMs: null,
    players: [
      { id: 'p1', username: 'Alice', capital: 1_000_000 },
      { id: 'p2', username: 'Bob', capital: 1_000_000 },
      { id: 'bot-1', username: 'Bot', capital: 1_000_000, isBot: true }
    ],
    airports: [],
    ownedAircraft: [],
    routes: [],
    flights: [],
    ...overrides
  };
}

test('no expense on initial day 0; baseline is established', () => {
  const game = new Game(createGameState(), createManager());
  const player = game.authoritativeState.players[0];
  const before = player.capital;

  const changed = game.processDailyExpenses(0);

  assert.equal(changed, false);
  assert.equal(player.capital, before);
  assert.equal(game.lastDailyExpenseDayIndex, 0);
});

test('crossing into day 1 charges exactly once and reports change', () => {
  const game = new Game(createGameState({
    airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1' }]
  }), createManager());

  game.processDailyExpenses(0);
  const expectedFee = calculateAirportOperatingFee({ basePrice: 4_600_000 }).finalFee;
  const player = game.authoritativeState.players[0];
  const before = player.capital;

  const changed = game.processDailyExpenses(DAY);

  assert.equal(changed, true);
  assert.equal(player.capital, before - expectedFee);
  assert.equal(game.lastDailyExpenseDayIndex, 1);
});

test('additional ticks during day 1 do not charge again and report no change', () => {
  const game = new Game(createGameState({
    airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1' }]
  }), createManager());

  game.processDailyExpenses(0);
  game.processDailyExpenses(DAY);
  const player = game.authoritativeState.players[0];
  const afterFirstCharge = player.capital;

  assert.equal(game.processDailyExpenses(DAY + 1000), false);
  assert.equal(game.processDailyExpenses(DAY + (DAY / 2)), false);

  assert.equal(player.capital, afterFirstCharge);
  assert.equal(game.lastDailyExpenseDayIndex, 1);
});

test('crossing into day 2 charges again and reports change', () => {
  const game = new Game(createGameState({
    airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1' }]
  }), createManager());

  game.processDailyExpenses(0);
  game.processDailyExpenses(DAY);
  const expectedFee = calculateAirportOperatingFee({ basePrice: 4_600_000 }).finalFee;
  const player = game.authoritativeState.players[0];

  const changed = game.processDailyExpenses(2 * DAY);

  assert.equal(changed, true);
  assert.equal(player.capital, 1_000_000 - 2 * expectedFee);
});

test('multiple owned airports are summed correctly', () => {
  const game = new Game(createGameState({
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1' },
      { airportId: 'YVR', ownerPlayerId: 'p1' }
    ]
  }), createManager());

  game.processDailyExpenses(0);
  const yyzFee = calculateAirportOperatingFee({ basePrice: 4_600_000 }).finalFee;
  const yvrFee = calculateAirportOperatingFee({ basePrice: 4_300_000 }).finalFee;
  const player = game.authoritativeState.players[0];

  const changed = game.processDailyExpenses(DAY);

  assert.equal(changed, true);
  assert.equal(player.capital, 1_000_000 - (yyzFee + yvrFee));
});

test('unowned airports are ignored', () => {
  const game = new Game(createGameState({
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1' },
      { airportId: 'YVR', ownerPlayerId: null }
    ]
  }), createManager());

  game.processDailyExpenses(0);
  const expectedFee = calculateAirportOperatingFee({ basePrice: 4_600_000 }).finalFee;
  const player = game.authoritativeState.players[0];

  const changed = game.processDailyExpenses(DAY);

  assert.equal(changed, true);
  assert.equal(player.capital, 1_000_000 - expectedFee);
});

test('multiple owners are charged independently', () => {
  const game = new Game(createGameState({
    airports: [
      { airportId: 'YYZ', ownerPlayerId: 'p1' },
      { airportId: 'YVR', ownerPlayerId: 'p2' }
    ]
  }), createManager());

  game.processDailyExpenses(0);
  const yyzFee = calculateAirportOperatingFee({ basePrice: 4_600_000 }).finalFee;
  const yvrFee = calculateAirportOperatingFee({ basePrice: 4_300_000 }).finalFee;

  const changed = game.processDailyExpenses(DAY);

  assert.equal(changed, true);
  assert.equal(game.authoritativeState.players[0].capital, 1_000_000 - yyzFee);
  assert.equal(game.authoritativeState.players[1].capital, 1_000_000 - yvrFee);
});

test('bots and disconnected owners are still charged if they own airports', () => {
  const game = new Game(createGameState({
    airports: [{ airportId: 'YYZ', ownerPlayerId: 'bot-1' }]
  }), createManager());

  game.processDailyExpenses(0);
  const expectedFee = calculateAirportOperatingFee({ basePrice: 4_600_000 }).finalFee;
  const bot = game.authoritativeState.players.find((p) => p.id === 'bot-1');

  const changed = game.processDailyExpenses(DAY);

  assert.equal(changed, true);
  assert.equal(bot.capital, 1_000_000 - expectedFee);
});

test('a day with no owned airports reports no change', () => {
  const game = new Game(createGameState({
    airports: [{ airportId: 'YYZ', ownerPlayerId: null }]
  }), createManager());

  game.processDailyExpenses(0);

  const changed = game.processDailyExpenses(DAY);

  assert.equal(changed, false);
  for (const player of game.authoritativeState.players) {
    assert.equal(player.capital, 1_000_000);
  }
});

test('expected capital ledger stays reconciled after daily airport operating fees', () => {
  const game = new Game(createGameState({
    airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1' }]
  }), createManager());

  game.processDailyExpenses(0);
  const expectedFee = calculateAirportOperatingFee({ basePrice: 4_600_000 }).finalFee;

  game.processDailyExpenses(DAY);
  const player = game.authoritativeState.players[0];

  assert.equal(player.capital, 1_000_000 - expectedFee);
  assert.equal(game.economyDiagnostics.expectedCapitalByPlayerId.get('p1'), player.capital);
});

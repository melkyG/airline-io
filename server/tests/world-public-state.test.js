const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');
const { createGame } = require('../gameFactory');

function createManager() {
  return {
    io: {
      to() {
        const room = { emit() {}, volatile: null };
        room.volatile = room;
        return room;
      }
    }
  };
}

function createGameWithWorld(world) {
  return new Game({
    id: 'public-state-test',
    status: 'active',
    createdAt: 0,
    startedAt: 0,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 1,
    simulationEndedAtGameMs: null,
    world: world || { countryProfitFactors: {} },
    players: [{ id: 'p1', username: 'Alice', capital: 0 }],
    airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null }],
    routes: [],
    ownedAircraft: [],
    flights: []
  }, createManager());
}

test('new game world factors are empty', () => {
  const manager = createManager();
  const game = new Game(createGame([{ id: 'p1', displayName: 'Alice', colorId: 'blue', colorHex: '#0000ff' }]), manager);

  const publicState = game.getPublicState({ realNowMs: 0 });

  assert.ok(publicState.game.world, 'game.world should exist');
  assert.deepStrictEqual(publicState.game.world.countryProfitFactors, {});
});

test('public world state propagates authoritative factors', () => {
  const game = createGameWithWorld({ countryProfitFactors: { Testland: 1.25 } });

  const publicState = game.getPublicState({ realNowMs: 0 });

  assert.deepStrictEqual(publicState.game.world.countryProfitFactors, { Testland: 1.25 });
  assert.equal(Object.hasOwn(publicState.game.world.countryProfitFactors, 'Otherland'), false);
});

test('public world state does not change existing public sections', () => {
  const game = createGameWithWorld({ countryProfitFactors: { Testland: 1.25 } });
  const publicState = game.getPublicState({ realNowMs: 0 });

  assert.ok(Array.isArray(publicState.game.players));
  assert.ok(Array.isArray(publicState.game.airports));
  assert.ok(Array.isArray(publicState.game.routes));
  assert.ok(Array.isArray(publicState.game.flights));
  assert.ok(Array.isArray(publicState.game.aircraftCatalog));
  assert.ok(publicState.game.simulationClock);
});

test('client state.js merge preserves game.world updates', () => {
  const game = createGameWithWorld({ countryProfitFactors: { Testland: 1.25 } });

  global.window = {};
  require('../../client/state.js');
  const { createGameState } = global.window;

  const clientState = createGameState({
    connection: {},
    session: {},
    lobby: { players: [] },
    ui: {},
    game: {},
    waitingAnimation: {}
  });

  const snapshot = game.getPublicState({ realNowMs: 0 });
  clientState.update(() => ({ game: snapshot.game }));

  const finalClient = clientState.getState();
  assert.equal(finalClient.game.world.countryProfitFactors.Testland, 1.25);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');
const GameManager = require('../GameManager');

function createManagerWithEmitCapture() {
  const emitted = [];
  const manager = {
    io: {
      to(roomName) {
        return {
          emit(eventName, payload) {
            emitted.push({ roomName, eventName, payload });
          }
        };
      }
    }
  };

  return { manager, emitted };
}

function createInitialState(overrides = {}) {
  return {
    id: 'game-aircraft-purchase',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
    ],
    airports: [],
    ownedAircraft: [],
    ...overrides
  };
}

test('purchaseAircraftFromGame buys aircraft from authoritative catalog price and broadcasts', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 50000000, score: 0 },
        { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
      ]
    }),
    manager
  );

  const result = game.purchaseAircraftFromGame('p1', 'BOEING_747');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.playerId, 'p1');
  assert.equal(result.aircraftCatalogId, 'BOEING_747');
  assert.equal(result.pricePaid, 300000);
  assert.equal(result.remainingCapital, 49700000);
  assert.equal(typeof result.aircraftInstanceId, 'string');
  assert.ok(result.aircraftInstanceId.startsWith('acft-'));

  assert.equal(game.authoritativeState.ownedAircraft.length, 1);
  assert.deepEqual(game.authoritativeState.ownedAircraft[0], {
    aircraftInstanceId: result.aircraftInstanceId,
    ownerPlayerId: 'p1',
    aircraftCatalogId: 'BOEING_747',
    acquisitionPrice: 300000,
    status: 'available',
    assignedRouteId: null
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.equal(emitted[0].payload.game.ownedAircraft.length, 1);
});

test('purchaseAircraftFromGame fails with PLAYER_NOT_FOUND and does not mutate or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseAircraftFromGame('missing-player', 'BOEING_747');

  assert.equal(result.success, false);
  assert.equal(result.code, 'PLAYER_NOT_FOUND');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseAircraftFromGame fails with AIRCRAFT_NOT_FOUND and does not mutate or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseAircraftFromGame('p1', 'UNKNOWN');

  assert.equal(result.success, false);
  assert.equal(result.code, 'AIRCRAFT_NOT_FOUND');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseAircraftFromGame fails with INSUFFICIENT_CAPITAL and does not mutate or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [{ id: 'p1', username: 'Alice', capital: 100000, score: 0 }]
    }),
    manager
  );
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseAircraftFromGame('p1', 'BOEING_747');

  assert.equal(result.success, false);
  assert.equal(result.code, 'INSUFFICIENT_CAPITAL');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager.handleAircraftPurchaseRequest delegates to active game purchase using socket player identity', () => {
  const io = {
    to() {
      return {
        emit() {}
      };
    }
  };

  const manager = new GameManager(io);
  manager.players.set('socket-1', {
    id: 'socket-1',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-1', 'game-1');

  let captured = null;
  manager.games.set('game-1', {
    players: new Map([['socket-1', { id: 'socket-1' }]]),
    purchaseAircraftFromGame(playerId, aircraftCatalogId) {
      captured = { playerId, aircraftCatalogId };
      return {
        success: true,
        code: 'OK',
        playerId,
        aircraftCatalogId,
        aircraftInstanceId: 'acft-test-id',
        pricePaid: 300000,
        remainingCapital: 49700000
      };
    }
  });

  const result = manager.handleAircraftPurchaseRequest('socket-1', 'BOEING_747');

  assert.deepEqual(captured, { playerId: 'socket-1', aircraftCatalogId: 'BOEING_747' });
  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
});

test('GameManager.handleAircraftPurchaseRequest returns PLAYER_NOT_FOUND when socket is not mapped to active game', () => {
  const io = {
    to() {
      return {
        emit() {}
      };
    }
  };

  const manager = new GameManager(io);

  const result = manager.handleAircraftPurchaseRequest('missing-socket', 'BOEING_747');

  assert.equal(result.success, false);
  assert.equal(result.code, 'PLAYER_NOT_FOUND');
});

test('GameManager.handleAircraftPurchaseSocketRequest handles malformed payloads safely', () => {
  const emitted = [];
  const io = {
    to(roomName) {
      return {
        emit(eventName, payload) {
          emitted.push({ roomName, eventName, payload });
        }
      };
    }
  };

  const manager = new GameManager(io);
  manager.players.set('socket-1', {
    id: 'socket-1',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-1', 'game-1');

  const game = new Game(createInitialState(), { io });
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const before = JSON.stringify(game.authoritativeState);
  const malformedPayloads = [
    null,
    {},
    { foo: 'bar' },
    { aircraftCatalogId: 42 },
    { aircraftCatalogId: {} },
    { aircraftCatalogId: [] }
  ];

  malformedPayloads.forEach((payload) => {
    const result = manager.handleAircraftPurchaseSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'AIRCRAFT_NOT_FOUND');
  });

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

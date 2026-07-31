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
  assert.equal(result.quantityPurchased, 1);
  assert.equal(result.unitPrice, 300000);
  assert.equal(result.pricePaid, 300000);
  assert.equal(result.remainingCapital, 49700000);
  assert.equal(result.maxPurchasable, 165);
  assert.equal(typeof result.aircraftInstanceId, 'string');
  assert.ok(result.aircraftInstanceId.startsWith('acft-'));
  assert.deepEqual(result.aircraftInstanceIds, [result.aircraftInstanceId]);

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

test('purchaseAircraftFromGame buys multiple aircraft atomically with unique instance IDs', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000, score: 0 },
        { id: 'p2', username: 'Bob', capital: 1000000, score: 0 }
      ]
    }),
    manager
  );

  const result = game.purchaseAircraftFromGame('p1', 'BOEING_747', 2);

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.playerId, 'p1');
  assert.equal(result.aircraftCatalogId, 'BOEING_747');
  assert.equal(result.quantityPurchased, 2);
  assert.equal(result.unitPrice, 300000);
  assert.equal(result.pricePaid, 600000);
  assert.equal(result.remainingCapital, 400000);
  assert.equal(result.maxPurchasable, 1);
  assert.equal(result.aircraftInstanceIds.length, 2);
  assert.equal(result.aircraftInstanceIds[0], result.aircraftInstanceId);

  const uniqueIds = new Set(result.aircraftInstanceIds);
  assert.equal(uniqueIds.size, 2);

  assert.equal(game.authoritativeState.ownedAircraft.length, 2);
  assert.equal(game.authoritativeState.ownedAircraft[0].ownerPlayerId, 'p1');
  assert.equal(game.authoritativeState.ownedAircraft[1].ownerPlayerId, 'p1');
  assert.equal(game.authoritativeState.ownedAircraft[0].acquisitionPrice, 300000);
  assert.equal(game.authoritativeState.ownedAircraft[1].acquisitionPrice, 300000);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.equal(emitted[0].payload.game.ownedAircraft.length, 2);
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
  assert.equal(result.maxPurchasable, 0);
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseAircraftFromGame fails with INVALID_QUANTITY when quantity is not an integer', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseAircraftFromGame('p1', 'BOEING_747', 1.5);

  assert.equal(result.success, false);
  assert.equal(result.code, 'INVALID_QUANTITY');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseAircraftFromGame fails with INVALID_QUANTITY when quantity is less than 1', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseAircraftFromGame('p1', 'BOEING_747', 0);

  assert.equal(result.success, false);
  assert.equal(result.code, 'INVALID_QUANTITY');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseAircraftFromGame fails with INSUFFICIENT_CAPITAL for bulk purchase and does not partially complete', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [{ id: 'p1', username: 'Alice', capital: 500000, score: 0 }]
    }),
    manager
  );
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseAircraftFromGame('p1', 'BOEING_747', 2);

  assert.equal(result.success, false);
  assert.equal(result.code, 'INSUFFICIENT_CAPITAL');
  assert.equal(result.maxPurchasable, 1);
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
    purchaseAircraftFromGame(playerId, aircraftCatalogId, quantity) {
      captured = { playerId, aircraftCatalogId, quantity };
      return {
        success: true,
        code: 'OK',
        playerId,
        aircraftCatalogId,
        quantityPurchased: quantity,
        unitPrice: 300000,
        aircraftInstanceId: 'acft-test-id',
        aircraftInstanceIds: ['acft-test-id'],
        pricePaid: 300000,
        remainingCapital: 49700000
      };
    }
  });

  const result = manager.handleAircraftPurchaseRequest('socket-1', 'BOEING_747');

  assert.deepEqual(captured, { playerId: 'socket-1', aircraftCatalogId: 'BOEING_747', quantity: 1 });
  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
});

test('GameManager.handleAircraftPurchaseRequest delegates explicit quantity to active game purchase', () => {
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
    purchaseAircraftFromGame(playerId, aircraftCatalogId, quantity) {
      captured = { playerId, aircraftCatalogId, quantity };
      return {
        success: true,
        code: 'OK',
        playerId,
        aircraftCatalogId,
        quantityPurchased: quantity,
        unitPrice: 300000,
        aircraftInstanceId: 'acft-test-id',
        aircraftInstanceIds: ['acft-test-id'],
        pricePaid: 300000 * quantity,
        remainingCapital: 50000000 - (300000 * quantity)
      };
    }
  });

  const result = manager.handleAircraftPurchaseRequest('socket-1', 'BOEING_747', 2);

  assert.deepEqual(captured, { playerId: 'socket-1', aircraftCatalogId: 'BOEING_747', quantity: 2 });
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

test('GameManager.handleAircraftPurchaseSocketRequest passes quantity through and validates it authoritatively', () => {
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

  const game = new Game(
    createInitialState({
      players: [{ id: 'socket-1', username: 'Alice', capital: 1000000, score: 0 }]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const successResult = manager.handleAircraftPurchaseSocketRequest('socket-1', {
    aircraftCatalogId: 'BOEING_747',
    quantity: 2
  });

  assert.equal(successResult.success, true);
  assert.equal(successResult.quantityPurchased, 2);
  assert.equal(successResult.pricePaid, 600000);
  assert.equal(successResult.remainingCapital, 400000);
  assert.equal(successResult.maxPurchasable, 1);

  const failureResult = manager.handleAircraftPurchaseSocketRequest('socket-1', {
    aircraftCatalogId: 'BOEING_747',
    quantity: 1.25
  });

  assert.equal(failureResult.success, false);
  assert.equal(failureResult.code, 'INVALID_QUANTITY');
  assert.equal(failureResult.maxPurchasable, 1);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);
});

test('GameManager.handleAircraftPurchaseSocketRequest supports quoteOnly with authoritative maxPurchasable and no mutation', () => {
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

  const game = new Game(
    createInitialState({
      players: [{ id: 'socket-1', username: 'Alice', capital: 650000, score: 0 }]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const before = JSON.stringify(game.authoritativeState);
  const quoteResult = manager.handleAircraftPurchaseSocketRequest('socket-1', {
    aircraftCatalogId: 'BOEING_747',
    quoteOnly: true
  });

  assert.equal(quoteResult.success, true);
  assert.equal(quoteResult.code, 'OK');
  assert.equal(quoteResult.playerId, 'socket-1');
  assert.equal(quoteResult.aircraftCatalogId, 'BOEING_747');
  assert.equal(quoteResult.unitPrice, 300000);
  assert.equal(quoteResult.currentCapital, 650000);
  assert.equal(quoteResult.maxPurchasable, 2);
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 0);
});

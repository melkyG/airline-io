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
      { id: 'p1', username: 'Alice', capital: 1000000 },
      { id: 'p2', username: 'Bob', capital: 1000000 }
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
        { id: 'p1', username: 'Alice', capital: 50000000 },
        { id: 'p2', username: 'Bob', capital: 1000000 }
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
        { id: 'p1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 1000000 }
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
      players: [{ id: 'p1', username: 'Alice', capital: 100000 }]
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
      players: [{ id: 'p1', username: 'Alice', capital: 500000 }]
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
      players: [{ id: 'socket-1', username: 'Alice', capital: 1000000 }]
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

  const gameEventEntries = emitted.filter((entry) => entry.eventName === 'game:event');
  assert.equal(gameEventEntries.length, 1);
  assert.equal(gameEventEntries[0].roomName, 'socket-1');
  assert.equal(gameEventEntries[0].payload.type, 'asset:transaction');
  assert.equal(gameEventEntries[0].payload.gameId, 'game-1');
  assert.equal(gameEventEntries[0].payload.actorPlayerId, 'socket-1');
  assert.deepEqual(gameEventEntries[0].payload.data, {
    action: 'purchased-from-game',
    assetType: 'aircraft',
    assetId: 'BOEING_747',
    assetName: 'Boeing 747',
    quantity: 2,
    totalAmount: 600000
  });

  const failureResult = manager.handleAircraftPurchaseSocketRequest('socket-1', {
    aircraftCatalogId: 'BOEING_747',
    quantity: 1.25
  });

  assert.equal(failureResult.success, false);
  assert.equal(failureResult.code, 'INVALID_QUANTITY');
  assert.equal(failureResult.maxPurchasable, 1);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 1);
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
      players: [{ id: 'socket-1', username: 'Alice', capital: 650000 }]
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
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 0);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 0);
});

test('getAircraftSellQuote returns authoritative model quote from owned instances with 80 percent rounded buyback', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 1000000 }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-p1-a',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 100000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-p1-b',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 999999,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-p1-other-model',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 300000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-p2-same-model',
          ownerPlayerId: 'p2',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'available',
          assignedRouteId: null
        }
      ]
    }),
    manager
  );

  const before = JSON.stringify(game.authoritativeState);
  const result = game.getAircraftSellQuote('p1', 'BOEING_747');

  assert.deepEqual(result, {
    success: true,
    code: 'OK',
    aircraftCatalogId: 'BOEING_747',
    ownedQuantity: 2,
    maxSellable: 2,
    unitSellPrice: 240000
  });
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('getAircraftSellQuote returns validation failures from authoritative purchase context and does not mutate', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);
  const before = JSON.stringify(game.authoritativeState);

  const missingPlayer = game.getAircraftSellQuote('missing-player', 'BOEING_747');
  assert.equal(missingPlayer.success, false);
  assert.equal(missingPlayer.code, 'PLAYER_NOT_FOUND');

  const missingAircraft = game.getAircraftSellQuote('p1', 'UNKNOWN');
  assert.equal(missingAircraft.success, false);
  assert.equal(missingAircraft.code, 'AIRCRAFT_NOT_FOUND');

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('sellAircraftToGame sells deterministically by model and owner, refunds once, and broadcasts game:state', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 500000 }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 450000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 200000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-3',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-4',
          ownerPlayerId: 'p2',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-5',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 350000,
          status: 'available',
          assignedRouteId: null
        }
      ]
    }),
    manager
  );

  const result = game.sellAircraftToGame('p1', 'BOEING_747', 2);

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.aircraftCatalogId, 'BOEING_747');
  assert.equal(result.quantitySold, 2);
  assert.equal(result.availableQuantitySold, 2);
  assert.equal(result.assignedQuantitySold, 0);
  assert.equal(result.unitSellPrice, 240000);
  assert.equal(result.totalRefund, 480000);
  assert.equal(result.ownedQuantity, 1);
  assert.equal(result.maxSellable, 1);
  assert.equal(result.updatedCapital, 1480000);
  assert.equal(game.authoritativeState.players.find((player) => player.id === 'p1').capital, 1480000);
  assert.deepEqual(
    game.authoritativeState.ownedAircraft.map((aircraft) => aircraft.aircraftInstanceId),
    ['acft-2', 'acft-4', 'acft-5']
  );
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
});

test('sellAircraftToGame selects available first, then assigned in stable authoritative order, and detaches sold assignments', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-3', 'acft-4', 'acft-5']
        }
      ],
      flights: [
        {
          flightId: 'flight-3',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-3',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        },
        {
          flightId: 'flight-4',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-4',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        },
        {
          flightId: 'flight-5',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-5',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-3',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'assigned',
          assignedRouteId: 'route-1'
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-4',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'assigned',
          assignedRouteId: 'route-1'
        },
        {
          aircraftInstanceId: 'acft-5',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'assigned',
          assignedRouteId: 'route-1'
        }
      ]
    }),
    manager
  );

  const result = game.sellAircraftToGame('p1', 'BOEING_737', 4);

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.aircraftCatalogId, 'BOEING_737');
  assert.equal(result.quantitySold, 4);
  assert.equal(result.availableQuantitySold, 2);
  assert.equal(result.assignedQuantitySold, 2);
  assert.equal(result.unitSellPrice, 176000);
  assert.equal(result.totalRefund, 704000);
  assert.equal(result.ownedQuantity, 1);
  assert.equal(result.maxSellable, 1);
  assert.equal(result.updatedCapital, 1704000);

  assert.deepEqual(
    game.authoritativeState.ownedAircraft.map((aircraft) => aircraft.aircraftInstanceId),
    ['acft-5']
  );
  assert.deepEqual(game.authoritativeState.routes[0].assignedAircraftInstanceIds, ['acft-5']);
  assert.deepEqual(
    game.authoritativeState.flights.map((flight) => flight.aircraftInstanceId),
    ['acft-5']
  );
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
});

test('sellAircraftToGame aborts atomically when any selected assigned-aircraft detachment validation fails', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
      routes: [
        {
          routeId: 'route-1',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-4']
        }
      ],
      flights: [
        {
          flightId: 'flight-3',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-3',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        },
        {
          flightId: 'flight-4',
          ownerPlayerId: 'p1',
          routeId: 'route-1',
          aircraftInstanceId: 'acft-4',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          direction: 'outbound',
          status: 'ready',
          departedAtSimulationMs: null,
          arrivesAtSimulationMs: null,
          nextTransitionAtSimulationMs: null
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-3',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'assigned',
          assignedRouteId: 'route-1'
        },
        {
          aircraftInstanceId: 'acft-2',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'available',
          assignedRouteId: null
        },
        {
          aircraftInstanceId: 'acft-4',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_737',
          acquisitionPrice: 220000,
          status: 'assigned',
          assignedRouteId: 'route-1'
        }
      ]
    }),
    manager
  );
  const before = JSON.stringify(game.authoritativeState);

  const result = game.sellAircraftToGame('p1', 'BOEING_737', 4);

  assert.equal(result.success, false);
  assert.equal(result.code, 'ASSIGNMENT_NOT_FOUND');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('sellAircraftToGame is atomic on failures (invalid quantity or oversell) with no mutation or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'available',
          assignedRouteId: null
        }
      ]
    }),
    manager
  );

  const before = JSON.stringify(game.authoritativeState);

  const invalidQuantity = game.sellAircraftToGame('p1', 'BOEING_747', 0);
  assert.equal(invalidQuantity.success, false);
  assert.equal(invalidQuantity.code, 'INVALID_QUANTITY');
  assert.equal(JSON.stringify(game.authoritativeState), before);

  const oversell = game.sellAircraftToGame('p1', 'BOEING_747', 2);
  assert.equal(oversell.success, false);
  assert.equal(oversell.code, 'INSUFFICIENT_OWNED_QUANTITY');
  assert.equal(oversell.ownedQuantity, 1);
  assert.equal(oversell.maxSellable, 1);
  assert.equal(oversell.unitSellPrice, 240000);
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager.handleAircraftSellSocketRequest supports quoteOnly and sale modes', () => {
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
      players: [{ id: 'socket-1', username: 'Alice', capital: 650000 }],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-test-1',
          ownerPlayerId: 'socket-1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'available',
          assignedRouteId: null
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const before = JSON.stringify(game.authoritativeState);
  const quoteResult = manager.handleAircraftSellSocketRequest('socket-1', {
    aircraftCatalogId: 'BOEING_747',
    quoteOnly: true
  });

  assert.equal(quoteResult.success, true);
  assert.equal(quoteResult.code, 'OK');
  assert.equal(quoteResult.aircraftCatalogId, 'BOEING_747');
  assert.equal(quoteResult.ownedQuantity, 1);
  assert.equal(quoteResult.maxSellable, 1);
  assert.equal(quoteResult.unitSellPrice, 240000);
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);

  const saleResult = manager.handleAircraftSellSocketRequest('socket-1', {
    aircraftCatalogId: 'BOEING_747',
    quantity: 1
  });
  assert.equal(saleResult.success, true);
  assert.equal(saleResult.code, 'OK');
  assert.equal(saleResult.aircraftCatalogId, 'BOEING_747');
  assert.equal(saleResult.quantitySold, 1);
  assert.equal(saleResult.unitSellPrice, 240000);
  assert.equal(saleResult.totalRefund, 240000);
  assert.equal(saleResult.ownedQuantity, 0);
  assert.equal(saleResult.maxSellable, 0);
  assert.equal(saleResult.updatedCapital, 890000);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);
  const gameEventEntries = emitted.filter((entry) => entry.eventName === 'game:event');
  assert.equal(gameEventEntries.length, 1);
  assert.equal(gameEventEntries[0].roomName, 'socket-1');
  assert.equal(gameEventEntries[0].payload.type, 'asset:transaction');
  assert.equal(gameEventEntries[0].payload.gameId, 'game-1');
  assert.equal(gameEventEntries[0].payload.actorPlayerId, 'socket-1');
  assert.deepEqual(gameEventEntries[0].payload.data, {
    action: 'sold-to-game',
    assetType: 'aircraft',
    assetId: 'BOEING_747',
    assetName: 'Boeing 747',
    quantity: 1,
    totalAmount: 240000
  });

  const failedSaleResult = manager.handleAircraftSellSocketRequest('socket-1', {
    aircraftCatalogId: 'BOEING_747',
    quantity: 1
  });
  assert.equal(failedSaleResult.success, false);
  assert.equal(failedSaleResult.code, 'INSUFFICIENT_OWNED_QUANTITY');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 1);

  const invalidPayloadResult = manager.handleAircraftSellSocketRequest('socket-1', {
    aircraftCatalogId: 42,
    quoteOnly: true
  });
  assert.equal(invalidPayloadResult.success, false);
  assert.equal(invalidPayloadResult.code, 'AIRCRAFT_NOT_FOUND');
});

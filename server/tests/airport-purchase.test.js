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
    id: 'game-purchase',
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
    airports: [
      { airportId: 'YYZ', ownerPlayerId: null, saleListing: null }
    ],
    ...overrides
  };
}

test('purchaseUnownedAirport buys an unowned airport at immutable basePrice and broadcasts', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);

  const result = game.purchaseUnownedAirport('p1', 'YYZ');

  assert.deepEqual(result, {
    success: true,
    code: 'OK',
    playerId: 'p1',
    airportId: 'YYZ',
    pricePaid: 300000,
    remainingCapital: 700000
  });
  assert.equal(game.authoritativeState.players[0].capital, 700000);
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, 'p1');
  assert.equal(game.authoritativeState.airports[0].saleListing, null);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.equal(emitted[0].payload.game.players[0].capital, 700000);
  assert.equal(emitted[0].payload.game.airports[0].ownerPlayerId, 'p1');
});

test('purchaseUnownedAirport fails with PLAYER_NOT_FOUND and does not mutate or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseUnownedAirport('missing-player', 'YYZ');

  assert.equal(result.success, false);
  assert.equal(result.code, 'PLAYER_NOT_FOUND');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseUnownedAirport fails with AIRPORT_NOT_FOUND and does not mutate or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(createInitialState(), manager);
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseUnownedAirport('p1', 'UNKNOWN');

  assert.equal(result.success, false);
  assert.equal(result.code, 'AIRPORT_NOT_FOUND');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseUnownedAirport fails with AIRPORT_ALREADY_OWNED and does not mutate or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      airports: [{ airportId: 'YYZ', ownerPlayerId: 'p2', saleListing: null }]
    }),
    manager
  );
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseUnownedAirport('p1', 'YYZ');

  assert.equal(result.success, false);
  assert.equal(result.code, 'AIRPORT_ALREADY_OWNED');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseUnownedAirport fails with INSUFFICIENT_CAPITAL and does not mutate or broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [{ id: 'p1', username: 'Alice', capital: 200000 }]
    }),
    manager
  );
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseUnownedAirport('p1', 'YYZ');

  assert.equal(result.success, false);
  assert.equal(result.code, 'INSUFFICIENT_CAPITAL');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager.handleAirportPurchaseRequest delegates to active game purchase using socket player identity', () => {
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
    purchaseUnownedAirport(playerId, airportId) {
      captured = { playerId, airportId };
      return {
        success: true,
        code: 'OK',
        playerId,
        airportId,
        pricePaid: 300000,
        remainingCapital: 700000
      };
    }
  });

  const result = manager.handleAirportPurchaseRequest('socket-1', 'YYZ');

  assert.deepEqual(captured, { playerId: 'socket-1', airportId: 'YYZ' });
  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
});

test('GameManager.handleAirportPurchaseRequest returns PLAYER_NOT_FOUND when socket is not mapped to active game', () => {
  const io = {
    to() {
      return {
        emit() {}
      };
    }
  };

  const manager = new GameManager(io);

  const result = manager.handleAirportPurchaseRequest('missing-socket', 'YYZ');

  assert.equal(result.success, false);
  assert.equal(result.code, 'PLAYER_NOT_FOUND');
});

test('GameManager.handleAirportPurchaseSocketRequest handles malformed payloads safely', () => {
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
  const malformedPayloads = [null, {}, { foo: 'bar' }, { airportId: 42 }, { airportId: {} }, { airportId: [] }];

  malformedPayloads.forEach((payload) => {
    const result = manager.handleAirportPurchaseSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'AIRPORT_NOT_FOUND');
  });

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager.handleAirportPurchaseSocketRequest emits canonical asset transaction only after successful purchase', () => {
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
      players: [{ id: 'socket-1', username: 'Alice', capital: 1000000 }],
      airports: [{ airportId: 'YYZ', ownerPlayerId: null, saleListing: null }]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const successResult = manager.handleAirportPurchaseSocketRequest('socket-1', { airportId: 'YYZ' });
  assert.equal(successResult.success, true);
  assert.equal(successResult.code, 'OK');
  assert.equal(successResult.pricePaid, 300000);
  assert.equal(successResult.remainingCapital, 700000);

  const gameEventEntries = emitted.filter((entry) => entry.eventName === 'game:event');
  assert.equal(gameEventEntries.length, 1);
  assert.equal(gameEventEntries[0].roomName, 'socket-1');
  assert.equal(gameEventEntries[0].payload.type, 'asset:transaction');
  assert.equal(gameEventEntries[0].payload.gameId, 'game-1');
  assert.equal(gameEventEntries[0].payload.actorPlayerId, 'socket-1');
  assert.deepEqual(gameEventEntries[0].payload.data, {
    action: 'purchased-from-game',
    assetType: 'airport',
    assetId: 'YYZ',
    assetName: 'Toronto Pearson International Airport',
    quantity: 1,
    totalAmount: 300000
  });

  const failedResult = manager.handleAirportPurchaseSocketRequest('socket-1', { airportId: 'YYZ' });
  assert.equal(failedResult.success, false);
  assert.equal(failedResult.code, 'AIRPORT_ALREADY_OWNED');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 1);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);
});

test('listAirportForSale creates a listing for an owned unlisted airport and broadcasts game:state', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      airports: [{ airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null }]
    }),
    manager
  );

  const result = game.listAirportForSale('p1', 'YYZ', 450000);

  assert.deepEqual(result, {
    success: true,
    code: 'OK',
    playerId: 'p1',
    airportId: 'YYZ',
    saleListing: {
      sellerPlayerId: 'p1',
      askingPrice: 450000
    }
  });
  assert.deepEqual(game.authoritativeState.airports[0].saleListing, {
    sellerPlayerId: 'p1',
    askingPrice: 450000
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.deepEqual(emitted[0].payload.game.airports[0].saleListing, {
    sellerPlayerId: 'p1',
    askingPrice: 450000
  });
});

test('listAirportForSale validates in order and does not mutate or broadcast on failure', () => {
  const failureCases = [
    {
      name: 'PLAYER_NOT_FOUND',
      playerId: 'missing-player',
      airportState: { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      askingPrice: 450000,
      expectedCode: 'PLAYER_NOT_FOUND'
    },
    {
      name: 'AIRPORT_NOT_FOUND',
      playerId: 'p1',
      airportState: { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      requestedAirportId: 'UNKNOWN',
      askingPrice: 450000,
      expectedCode: 'AIRPORT_NOT_FOUND'
    },
    {
      name: 'NOT_AIRPORT_OWNER',
      playerId: 'p1',
      airportState: { airportId: 'YYZ', ownerPlayerId: 'p2', saleListing: null },
      askingPrice: 450000,
      expectedCode: 'NOT_AIRPORT_OWNER'
    },
    {
      name: 'AIRPORT_ALREADY_LISTED',
      playerId: 'p1',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', askingPrice: 420000 }
      },
      askingPrice: 450000,
      expectedCode: 'AIRPORT_ALREADY_LISTED'
    },
    {
      name: 'INVALID_ASKING_PRICE',
      playerId: 'p1',
      airportState: { airportId: 'YYZ', ownerPlayerId: 'p1', saleListing: null },
      askingPrice: 0,
      expectedCode: 'INVALID_ASKING_PRICE'
    }
  ];

  failureCases.forEach((failureCase) => {
    const { manager, emitted } = createManagerWithEmitCapture();
    const game = new Game(
      createInitialState({
        airports: [failureCase.airportState]
      }),
      manager
    );
    const before = JSON.stringify(game.authoritativeState);

    const result = game.listAirportForSale(
      failureCase.playerId,
      failureCase.requestedAirportId || 'YYZ',
      failureCase.askingPrice
    );

    assert.equal(result.success, false, failureCase.name);
    assert.equal(result.code, failureCase.expectedCode, failureCase.name);
    assert.equal(JSON.stringify(game.authoritativeState), before, failureCase.name);
    assert.equal(emitted.length, 0, failureCase.name);
  });
});

test('cancelAirportListing clears an owned active listing and broadcasts game:state', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 450000 }
        }
      ]
    }),
    manager
  );

  const result = game.cancelAirportListing('p1', 'YYZ');

  assert.deepEqual(result, {
    success: true,
    code: 'OK',
    playerId: 'p1',
    airportId: 'YYZ',
    saleListing: null
  });
  assert.equal(game.authoritativeState.airports[0].saleListing, null);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.equal(emitted[0].payload.game.airports[0].saleListing, null);
});

test('cancelAirportListing validates in order and does not mutate or broadcast on failure', () => {
  const failureCases = [
    {
      name: 'PLAYER_NOT_FOUND',
      playerId: 'missing-player',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', askingPrice: 450000 }
      },
      expectedCode: 'PLAYER_NOT_FOUND'
    },
    {
      name: 'AIRPORT_NOT_FOUND',
      playerId: 'p1',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', askingPrice: 450000 }
      },
      requestedAirportId: 'UNKNOWN',
      expectedCode: 'AIRPORT_NOT_FOUND'
    },
    {
      name: 'NOT_AIRPORT_OWNER',
      playerId: 'p1',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p2',
        saleListing: { sellerPlayerId: 'p2', askingPrice: 450000 }
      },
      expectedCode: 'NOT_AIRPORT_OWNER'
    },
    {
      name: 'AIRPORT_NOT_LISTED',
      playerId: 'p1',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: null
      },
      expectedCode: 'AIRPORT_NOT_LISTED'
    },
    {
      name: 'LISTING_SELLER_MISMATCH',
      playerId: 'p1',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p2', askingPrice: 450000 }
      },
      expectedCode: 'LISTING_SELLER_MISMATCH'
    }
  ];

  failureCases.forEach((failureCase) => {
    const { manager, emitted } = createManagerWithEmitCapture();
    const game = new Game(
      createInitialState({
        airports: [failureCase.airportState]
      }),
      manager
    );
    const before = JSON.stringify(game.authoritativeState);

    const result = game.cancelAirportListing(
      failureCase.playerId,
      failureCase.requestedAirportId || 'YYZ'
    );

    assert.equal(result.success, false, failureCase.name);
    assert.equal(result.code, failureCase.expectedCode, failureCase.name);
    assert.equal(JSON.stringify(game.authoritativeState), before, failureCase.name);
    assert.equal(emitted.length, 0, failureCase.name);
  });
});

test('GameManager.handleAirportListingRequest delegates to active game listing using socket player identity', () => {
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
    listAirportForSale(playerId, airportId, askingPrice) {
      captured = { playerId, airportId, askingPrice };
      return {
        success: true,
        code: 'OK',
        playerId,
        airportId,
        saleListing: { sellerPlayerId: playerId, askingPrice }
      };
    }
  });

  const result = manager.handleAirportListingRequest('socket-1', 'YYZ', 450000);

  assert.deepEqual(captured, { playerId: 'socket-1', airportId: 'YYZ', askingPrice: 450000 });
  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
});

test('GameManager.handleAirportListingCancelRequest delegates to active game cancellation using socket player identity', () => {
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
    cancelAirportListing(playerId, airportId) {
      captured = { playerId, airportId };
      return {
        success: true,
        code: 'OK',
        playerId,
        airportId,
        saleListing: null
      };
    }
  });

  const result = manager.handleAirportListingCancelRequest('socket-1', 'YYZ');

  assert.deepEqual(captured, { playerId: 'socket-1', airportId: 'YYZ' });
  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
});

test('GameManager airport listing socket request handlers fail gracefully for malformed payloads', () => {
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
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 450000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const before = JSON.stringify(game.authoritativeState);
  const malformedListPayloads = [null, {}, { airportId: 'YYZ' }, { askingPrice: 450000 }, { airportId: 42, askingPrice: 450000 }, { airportId: 'YYZ', askingPrice: '450000' }];
  const malformedCancelPayloads = [null, {}, { foo: 'bar' }, { airportId: 42 }, { airportId: [] }];

  malformedListPayloads.forEach((payload) => {
    const result = manager.handleAirportListingSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  malformedCancelPayloads.forEach((payload) => {
    const result = manager.handleAirportListingCancelSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager.handleAirportListingSocketRequest emits canonical asset listing only after successful listing creation', () => {
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
      players: [{ id: 'socket-1', username: 'Alice', capital: 1000000 }],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'socket-1',
          saleListing: null
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const successResult = manager.handleAirportListingSocketRequest('socket-1', {
    airportId: 'YYZ',
    askingPrice: 420000
  });

  assert.equal(successResult.success, true);
  assert.equal(successResult.code, 'OK');
  assert.deepEqual(successResult.saleListing, {
    sellerPlayerId: 'socket-1',
    askingPrice: 420000
  });

  const gameEventEntries = emitted.filter((entry) => entry.eventName === 'game:event');
  assert.equal(gameEventEntries.length, 1);
  assert.equal(gameEventEntries[0].roomName, 'socket-1');
  assert.equal(gameEventEntries[0].payload.type, 'asset:listing');
  assert.equal(gameEventEntries[0].payload.gameId, 'game-1');
  assert.equal(gameEventEntries[0].payload.actorPlayerId, 'socket-1');
  assert.deepEqual(gameEventEntries[0].payload.data, {
    action: 'listed',
    assetType: 'airport',
    assetId: 'YYZ',
    assetName: 'Toronto Pearson International Airport',
    askingPrice: 420000
  });

  const failedResult = manager.handleAirportListingSocketRequest('socket-1', {
    airportId: 'YYZ',
    askingPrice: 430000
  });
  assert.equal(failedResult.success, false);
  assert.equal(failedResult.code, 'AIRPORT_ALREADY_LISTED');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 1);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);
});

test('GameManager.handleAirportListingCancelSocketRequest does not emit game:event on successful cancellation', () => {
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
      players: [{ id: 'socket-1', username: 'Alice', capital: 1000000 }],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'socket-1',
          saleListing: { sellerPlayerId: 'socket-1', askingPrice: 420000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const result = manager.handleAirportListingCancelSocketRequest('socket-1', { airportId: 'YYZ' });

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 0);
});

test('GameManager.handleAirportListedPurchaseSocketRequest emits buyer and seller canonical asset transactions on successful listed purchase', () => {
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
  manager.players.set('socket-2', {
    id: 'socket-2',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-1', 'game-1');
  manager.playerGameIds.set('socket-2', 'game-1');

  const game = new Game(
    createInitialState({
      players: [
        { id: 'socket-1', username: 'Alice', capital: 1000000 },
        { id: 'socket-2', username: 'Bob', capital: 500000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'socket-1',
          saleListing: { sellerPlayerId: 'socket-1', askingPrice: 350000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  game.players.set('socket-2', { id: 'socket-2' });
  manager.games.set('game-1', game);

  const result = manager.handleAirportListedPurchaseSocketRequest('socket-2', { airportId: 'YYZ' });

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);

  const gameEventEntries = emitted.filter((entry) => entry.eventName === 'game:event');
  assert.equal(gameEventEntries.length, 2);

  const buyerEvent = gameEventEntries.find((entry) => entry.roomName === 'socket-2');
  const sellerEvent = gameEventEntries.find((entry) => entry.roomName === 'socket-1');

  assert.ok(buyerEvent);
  assert.equal(buyerEvent.payload.type, 'asset:transaction');
  assert.equal(buyerEvent.payload.gameId, 'game-1');
  assert.equal(buyerEvent.payload.actorPlayerId, 'socket-2');
  assert.deepEqual(buyerEvent.payload.data, {
    action: 'purchased-from-player',
    assetType: 'airport',
    assetId: 'YYZ',
    assetName: 'Toronto Pearson International Airport',
    quantity: 1,
    totalAmount: 350000,
    counterpartyPlayerId: 'socket-1',
    counterpartyName: 'Alice'
  });

  assert.ok(sellerEvent);
  assert.equal(sellerEvent.payload.type, 'asset:transaction');
  assert.equal(sellerEvent.payload.gameId, 'game-1');
  assert.equal(sellerEvent.payload.actorPlayerId, 'socket-1');
  assert.deepEqual(sellerEvent.payload.data, {
    action: 'sold-to-player',
    assetType: 'airport',
    assetId: 'YYZ',
    assetName: 'Toronto Pearson International Airport',
    quantity: 1,
    totalAmount: 350000,
    counterpartyPlayerId: 'socket-2',
    counterpartyName: 'Bob'
  });
});

test('GameManager.handleAirportListedPurchaseSocketRequest emits only buyer event when seller is not connected', () => {
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
  manager.players.set('socket-2', {
    id: 'socket-2',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-2', 'game-1');

  const game = new Game(
    createInitialState({
      players: [
        { id: 'socket-1', username: 'Alice', capital: 1000000 },
        { id: 'socket-2', username: 'Bob', capital: 500000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'socket-1',
          saleListing: { sellerPlayerId: 'socket-1', askingPrice: 350000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-2', { id: 'socket-2' });
  manager.games.set('game-1', game);

  const result = manager.handleAirportListedPurchaseSocketRequest('socket-2', { airportId: 'YYZ' });

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);

  const gameEventEntries = emitted.filter((entry) => entry.eventName === 'game:event');
  assert.equal(gameEventEntries.length, 1);
  assert.equal(gameEventEntries[0].roomName, 'socket-2');
  assert.equal(gameEventEntries[0].payload.type, 'asset:transaction');
  assert.equal(gameEventEntries[0].payload.data.action, 'purchased-from-player');
  assert.equal(gameEventEntries[0].payload.data.counterpartyName, 'Alice');
});

test('GameManager.handleAirportListedPurchaseSocketRequest does not emit game:event on failed listed purchase', () => {
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
  manager.players.set('socket-2', {
    id: 'socket-2',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-2', 'game-1');

  const game = new Game(
    createInitialState({
      players: [
        { id: 'socket-1', username: 'Alice', capital: 1000000 },
        { id: 'socket-2', username: 'Bob', capital: 200000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'socket-1',
          saleListing: { sellerPlayerId: 'socket-1', askingPrice: 350000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-2', { id: 'socket-2' });
  manager.games.set('game-1', game);

  const result = manager.handleAirportListedPurchaseSocketRequest('socket-2', { airportId: 'YYZ' });

  assert.equal(result.success, false);
  assert.equal(result.code, 'INSUFFICIENT_CAPITAL');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 0);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 0);
});

test('purchaseListedAirport buys a listed airport from another player and broadcasts game:state', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
           { id: 'p2', username: 'Bob', capital: 400000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
        }
      ]
    }),
    manager
  );

  const result = game.purchaseListedAirport('p2', 'YYZ');

  assert.deepEqual(result, {
    success: true,
    code: 'OK',
    buyerPlayerId: 'p2',
    sellerPlayerId: 'p1',
    airportId: 'YYZ',
    pricePaid: 350000,
    buyerRemainingCapital: 50000,
    sellerUpdatedCapital: 1350000
  });
  assert.equal(game.authoritativeState.players[0].capital, 1350000);
  assert.equal(game.authoritativeState.players[1].capital, 50000);
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, 'p2');
  assert.equal(game.authoritativeState.airports[0].saleListing, null);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
});

test('purchaseListedAirport removes seller routes using sold airport and unassigns their aircraft in one broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
           { id: 'p2', username: 'Bob', capital: 400000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
        },
        {
          airportId: 'JFK',
          ownerPlayerId: 'p1',
          saleListing: null
        }
      ],
      routes: [
        {
          routeId: 'route-yyz-jfk',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-1']
        }
      ],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-yyz-jfk',
          aircraftInstanceId: 'acft-1',
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
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'assigned',
          assignedRouteId: 'route-yyz-jfk'
        }
      ]
    }),
    manager
  );

  const result = game.purchaseListedAirport('p2', 'YYZ');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(game.authoritativeState.players[0].capital, 1350000);
  assert.equal(game.authoritativeState.players[1].capital, 50000);
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, 'p2');
  assert.equal(game.authoritativeState.airports[0].saleListing, null);
  assert.equal(game.authoritativeState.routes.length, 0);
  assert.equal(game.authoritativeState.ownedAircraft[0].status, 'available');
  assert.equal(game.authoritativeState.ownedAircraft[0].assignedRouteId, null);
  assert.deepEqual(game.authoritativeState.flights, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.deepEqual(emitted[0].payload.game.flights, []);
});

test('purchaseListedAirport is atomic when route cleanup validation fails', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 400000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
        },
        {
          airportId: 'JFK',
          ownerPlayerId: 'p1',
          saleListing: null
        }
      ],
      routes: [
        {
          routeId: 'route-yyz-jfk',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-missing']
        }
      ],
      ownedAircraft: []
    }),
    manager
  );
  const before = JSON.stringify(game.authoritativeState);

  const result = game.purchaseListedAirport('p2', 'YYZ');

  assert.equal(result.success, false);
  assert.equal(result.code, 'ASSIGNED_AIRCRAFT_NOT_FOUND');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('purchaseListedAirport validates in order and does not mutate or broadcast on failure', () => {
  const failureCases = [
    {
      name: 'PLAYER_NOT_FOUND',
      buyerPlayerId: 'missing-player',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
      },
      expectedCode: 'PLAYER_NOT_FOUND'
    },
    {
      name: 'AIRPORT_NOT_FOUND',
      buyerPlayerId: 'p2',
      requestedAirportId: 'UNKNOWN',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
      },
      expectedCode: 'AIRPORT_NOT_FOUND'
    },
    {
      name: 'AIRPORT_NOT_LISTED',
      buyerPlayerId: 'p2',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: null
      },
      expectedCode: 'AIRPORT_NOT_LISTED'
    },
    {
      name: 'SELLER_NOT_FOUND',
      buyerPlayerId: 'p2',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'missing-seller', askingPrice: 350000 }
      },
      expectedCode: 'SELLER_NOT_FOUND'
    },
    {
      name: 'CANNOT_BUY_OWN_LISTING',
      buyerPlayerId: 'p1',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
      },
      expectedCode: 'CANNOT_BUY_OWN_LISTING'
    },
    {
      name: 'INSUFFICIENT_CAPITAL',
      buyerPlayerId: 'p2',
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
           { id: 'p2', username: 'Bob', capital: 100000 }
      ],
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
      },
      expectedCode: 'INSUFFICIENT_CAPITAL'
    }
  ];

  failureCases.forEach((failureCase) => {
    const { manager, emitted } = createManagerWithEmitCapture();
    const game = new Game(
      createInitialState({
        players: failureCase.players || [
          { id: 'p1', username: 'Alice', capital: 1000000 },
          { id: 'p2', username: 'Bob', capital: 400000 }
        ],
        airports: [failureCase.airportState]
      }),
      manager
    );
    const before = JSON.stringify(game.authoritativeState);

    const result = game.purchaseListedAirport(
      failureCase.buyerPlayerId,
      failureCase.requestedAirportId || 'YYZ'
    );

    assert.equal(result.success, false, failureCase.name);
    assert.equal(result.code, failureCase.expectedCode, failureCase.name);
    assert.equal(JSON.stringify(game.authoritativeState), before, failureCase.name);
    assert.equal(emitted.length, 0, failureCase.name);
  });
});

test('GameManager.handleAirportListedPurchaseRequest delegates to active game listed purchase using socket player identity', () => {
  const io = {
    to() {
      return {
        emit() {}
      };
    }
  };

  const manager = new GameManager(io);
  manager.players.set('socket-2', {
    id: 'socket-2',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-2', 'game-1');

  let captured = null;
  manager.games.set('game-1', {
    players: new Map([['socket-2', { id: 'socket-2' }]]),
    purchaseListedAirport(playerId, airportId) {
      captured = { playerId, airportId };
      return {
        success: true,
        code: 'OK',
        buyerPlayerId: playerId,
        sellerPlayerId: 'socket-1',
        airportId,
        pricePaid: 350000,
        buyerRemainingCapital: 50000,
        sellerUpdatedCapital: 1350000
      };
    }
  });

  const result = manager.handleAirportListedPurchaseRequest('socket-2', 'YYZ');

  assert.deepEqual(captured, { playerId: 'socket-2', airportId: 'YYZ' });
  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
});

test('GameManager.handleAirportListedPurchaseSocketRequest handles malformed payloads safely', () => {
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
  manager.players.set('socket-2', {
    id: 'socket-2',
    gameId: 'game-1'
  });
  manager.playerGameIds.set('socket-2', 'game-1');

  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
        { id: 'socket-2', username: 'Bob', capital: 400000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 350000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-2', { id: 'socket-2' });
  manager.games.set('game-1', game);

  const before = JSON.stringify(game.authoritativeState);
  const malformedPayloads = [null, {}, { foo: 'bar' }, { airportId: 42 }, { airportId: {} }, { airportId: [] }];

  malformedPayloads.forEach((payload) => {
    const result = manager.handleAirportListedPurchaseSocketRequest('socket-2', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('sellAirportToGame refunds 80 percent of basePrice, clears ownership/listing, and broadcasts game:state', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
           { id: 'p2', username: 'Bob', capital: 400000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: { sellerPlayerId: 'p1', askingPrice: 450000 }
        }
      ]
    }),
    manager
  );

  const result = game.sellAirportToGame('p1', 'YYZ');

  assert.deepEqual(result, {
    success: true,
    code: 'OK',
    playerId: 'p1',
    airportId: 'YYZ',
    refundAmount: 240000,
    updatedCapital: 1240000
  });
  assert.equal(game.authoritativeState.players[0].capital, 1240000);
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, null);
  assert.equal(game.authoritativeState.airports[0].saleListing, null);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
});

test('sellAirportToGame removes owner routes using sold airport and unassigns their aircraft in one broadcast', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
           { id: 'p2', username: 'Bob', capital: 400000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: null
        },
        {
          airportId: 'JFK',
          ownerPlayerId: 'p1',
          saleListing: null
        }
      ],
      routes: [
        {
          routeId: 'route-yyz-jfk',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-1']
        }
      ],
      flights: [
        {
          flightId: 'flight-1',
          ownerPlayerId: 'p1',
          routeId: 'route-yyz-jfk',
          aircraftInstanceId: 'acft-1',
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
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'assigned',
          assignedRouteId: 'route-yyz-jfk'
        }
      ]
    }),
    manager
  );

  const result = game.sellAirportToGame('p1', 'YYZ');

  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
  assert.equal(game.authoritativeState.players[0].capital, 1240000);
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, null);
  assert.equal(game.authoritativeState.routes.length, 0);
  assert.equal(game.authoritativeState.ownedAircraft[0].status, 'available');
  assert.equal(game.authoritativeState.ownedAircraft[0].assignedRouteId, null);
  assert.deepEqual(game.authoritativeState.flights, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:state');
  assert.deepEqual(emitted[0].payload.game.flights, []);
});

test('sellAirportToGame is atomic when route cleanup validation fails', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const game = new Game(
    createInitialState({
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 },
           { id: 'p2', username: 'Bob', capital: 400000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'p1',
          saleListing: null
        },
        {
          airportId: 'JFK',
          ownerPlayerId: 'p1',
          saleListing: null
        }
      ],
      routes: [
        {
          routeId: 'route-yyz-jfk',
          ownerPlayerId: 'p1',
          originAirportId: 'YYZ',
          destinationAirportId: 'JFK',
          routeKey: 'JFK::YYZ',
          distanceKm: 550,
          assignedAircraftInstanceIds: ['acft-1']
        }
      ],
      ownedAircraft: [
        {
          aircraftInstanceId: 'acft-1',
          ownerPlayerId: 'p1',
          aircraftCatalogId: 'BOEING_747',
          acquisitionPrice: 300000,
          status: 'assigned',
          assignedRouteId: 'route-other'
        }
      ]
    }),
    manager
  );
  const before = JSON.stringify(game.authoritativeState);

  const result = game.sellAirportToGame('p1', 'YYZ');

  assert.equal(result.success, false);
  assert.equal(result.code, 'ASSIGNMENT_MISMATCH');
  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('sellAirportToGame validates in order and does not mutate or broadcast on failure', () => {
  const failureCases = [
    {
      name: 'PLAYER_NOT_FOUND',
      playerId: 'missing-player',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: null
      },
      expectedCode: 'PLAYER_NOT_FOUND'
    },
    {
      name: 'AIRPORT_NOT_FOUND',
      playerId: 'p1',
      requestedAirportId: 'UNKNOWN',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: null
      },
      expectedCode: 'AIRPORT_NOT_FOUND'
    },
    {
      name: 'NOT_AIRPORT_OWNER',
      playerId: 'p2',
      airportState: {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: null
      },
      expectedCode: 'NOT_AIRPORT_OWNER'
    }
  ];

  failureCases.forEach((failureCase) => {
    const { manager, emitted } = createManagerWithEmitCapture();
    const game = new Game(
      createInitialState({
        players: [
          { id: 'p1', username: 'Alice', capital: 1000000 },
          { id: 'p2', username: 'Bob', capital: 500000 }
        ],
        airports: [failureCase.airportState]
      }),
      manager
    );
    const before = JSON.stringify(game.authoritativeState);

    const result = game.sellAirportToGame(
      failureCase.playerId,
      failureCase.requestedAirportId || 'YYZ'
    );

    assert.equal(result.success, false, failureCase.name);
    assert.equal(result.code, failureCase.expectedCode, failureCase.name);
    assert.equal(JSON.stringify(game.authoritativeState), before, failureCase.name);
    assert.equal(emitted.length, 0, failureCase.name);
  });
});

test('GameManager.handleAirportSellToGameRequest delegates to active game sell-to-game using socket player identity', () => {
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
    sellAirportToGame(playerId, airportId) {
      captured = { playerId, airportId };
      return {
        success: true,
        code: 'OK',
        playerId,
        airportId,
        refundAmount: 240000,
        updatedCapital: 1240000
      };
    }
  });

  const result = manager.handleAirportSellToGameRequest('socket-1', 'YYZ');

  assert.deepEqual(captured, { playerId: 'socket-1', airportId: 'YYZ' });
  assert.equal(result.success, true);
  assert.equal(result.code, 'OK');
});

test('GameManager.handleAirportSellToGameSocketRequest handles malformed payloads safely', () => {
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
      players: [
        { id: 'socket-1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 500000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'socket-1',
          saleListing: { sellerPlayerId: 'socket-1', askingPrice: 450000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const before = JSON.stringify(game.authoritativeState);
  const malformedPayloads = [null, {}, { foo: 'bar' }, { airportId: 42 }, { airportId: {} }, { airportId: [] }];

  malformedPayloads.forEach((payload) => {
    const result = manager.handleAirportSellToGameSocketRequest('socket-1', payload);
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REQUEST');
  });

  assert.equal(JSON.stringify(game.authoritativeState), before);
  assert.equal(emitted.length, 0);
});

test('GameManager.handleAirportSellToGameSocketRequest emits canonical asset transaction only after successful sale', () => {
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
      players: [
        { id: 'socket-1', username: 'Alice', capital: 1000000 },
        { id: 'p2', username: 'Bob', capital: 500000 }
      ],
      airports: [
        {
          airportId: 'YYZ',
          ownerPlayerId: 'socket-1',
          saleListing: { sellerPlayerId: 'socket-1', askingPrice: 450000 }
        }
      ]
    }),
    { io }
  );
  game.players.set('socket-1', { id: 'socket-1' });
  manager.games.set('game-1', game);

  const saleResult = manager.handleAirportSellToGameSocketRequest('socket-1', { airportId: 'YYZ' });
  assert.equal(saleResult.success, true);
  assert.equal(saleResult.code, 'OK');
  assert.equal(saleResult.refundAmount, 240000);
  assert.equal(saleResult.updatedCapital, 1240000);

  const gameEventEntries = emitted.filter((entry) => entry.eventName === 'game:event');
  assert.equal(gameEventEntries.length, 1);
  assert.equal(gameEventEntries[0].roomName, 'socket-1');
  assert.equal(gameEventEntries[0].payload.type, 'asset:transaction');
  assert.equal(gameEventEntries[0].payload.gameId, 'game-1');
  assert.equal(gameEventEntries[0].payload.actorPlayerId, 'socket-1');
  assert.deepEqual(gameEventEntries[0].payload.data, {
    action: 'sold-to-game',
    assetType: 'airport',
    assetId: 'YYZ',
    assetName: 'Toronto Pearson International Airport',
    quantity: 1,
    totalAmount: 240000
  });

  const failedSaleResult = manager.handleAirportSellToGameSocketRequest('socket-1', { airportId: 'YYZ' });
  assert.equal(failedSaleResult.success, false);
  assert.equal(failedSaleResult.code, 'NOT_AIRPORT_OWNER');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:event').length, 1);
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:state').length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');

test('game:started public payload includes authoritative game wrapper', () => {
  const initialState = {
    id: 'game-1',
    status: 'active',
    createdAt: 123456,
    startedAt: 123456,
    endsAt: 1923456,
    durationMs: 1800000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0, internalOnlyField: 'secret' }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: null, saleListing: null }
    ]
  };

  const manager = {
    io: {
      to() {
        return {
          emit() {}
        };
      }
    }
  };

  const game = new Game(initialState, manager);
  const payload = game.getPublicState();

  assert.deepEqual(payload, {
    game: {
      id: 'game-1',
      status: 'active',
      createdAt: 123456,
      startedAt: 123456,
      endsAt: 1923456,
      durationMs: 1800000,
      scoreToWin: 1000,
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000, score: 0 }
      ],
      airports: [
        {
          id: 'YYZ',
          iata: 'YYZ',
          name: 'Toronto Pearson International Airport',
          city: 'Toronto',
          country: 'Canada',
          lat: 43.6777,
          lng: -79.6248,
          size: 'large',
          basePrice: 300000,
          ownerPlayerId: null,
          saleListing: null
        }
      ]
    }
  });

  payload.game.players[0].username = 'Changed';
  payload.game.players[0].capital = 1;
  payload.game.players[0].score = 999;
  payload.game.airports[0].ownerPlayerId = 'p1';
  assert.notEqual(payload.game.players[0], game.authoritativeState.players[0]);
  assert.equal(game.authoritativeState.players[0].username, 'Alice');
  assert.equal(game.authoritativeState.players[0].capital, 1000000);
  assert.equal(game.authoritativeState.players[0].score, 0);
  assert.equal('internalOnlyField' in payload.game.players[0], false);
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, null);
  assert.equal('startedAt' in payload.game, true);
  assert.equal('endsAt' in payload.game, true);
  assert.equal('durationMs' in payload.game, true);
  assert.equal('scoreToWin' in payload.game, true);
});

test('game:started public player payload includes only explicit public fields', () => {
  const initialState = {
    id: 'game-players-1',
    status: 'active',
    createdAt: 523456,
    startedAt: 523456,
    endsAt: 2323456,
    durationMs: 1800000,
    scoreToWin: 1000,
    players: [
      {
        id: 'p1',
        username: 'Alice',
        capital: 1000000,
        score: 0,
        internalOnlyField: 'hidden-value'
      }
    ],
    airports: []
  };

  const manager = {
    io: {
      to() {
        return {
          emit() {}
        };
      }
    }
  };

  const game = new Game(initialState, manager);
  const payload = game.getPublicState();

  assert.deepEqual(payload.game.players, [
    {
      id: 'p1',
      username: 'Alice',
      capital: 1000000,
      score: 0
    }
  ]);
  assert.equal('internalOnlyField' in payload.game.players[0], false);
  assert.notEqual(payload.game.players[0], game.authoritativeState.players[0]);
});

test('game:started public payload includes airport definition plus game-owned mutable state', () => {
  const initialState = {
    id: 'game-2',
    status: 'active',
    createdAt: 223456,
    startedAt: 223456,
    endsAt: 2023456,
    durationMs: 1800000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: null, saleListing: null }
    ]
  };

  const manager = {
    io: {
      to() {
        return {
          emit() {}
        };
      }
    }
  };

  const game = new Game(initialState, manager);
  const payload = game.getPublicState();

  assert.deepEqual(payload.game.airports, [
    {
      id: 'YYZ',
      iata: 'YYZ',
      name: 'Toronto Pearson International Airport',
      city: 'Toronto',
      country: 'Canada',
      lat: 43.6777,
      lng: -79.6248,
      size: 'large',
      basePrice: 300000,
      ownerPlayerId: null,
      saleListing: null
    }
  ]);
  assert.deepEqual(game.authoritativeState.airports, [{ airportId: 'YYZ', ownerPlayerId: null, saleListing: null }]);
});

test('unknown airport IDs in game state are skipped with warning during public payload construction', () => {
  const initialState = {
    id: 'game-3',
    status: 'active',
    createdAt: 323456,
    startedAt: 323456,
    endsAt: 2123456,
    durationMs: 1800000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: null, saleListing: null },
      { airportId: 'UNKNOWN', ownerPlayerId: null, saleListing: null }
    ]
  };

  const manager = {
    io: {
      to() {
        return {
          emit() {}
        };
      }
    }
  };

  const game = new Game(initialState, manager);
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);

  try {
    const payload = game.getPublicState();

    assert.equal(payload.game.airports.length, 1);
    assert.equal(payload.game.airports[0].id, 'YYZ');
    assert.equal(payload.game.airports[0].basePrice, 300000);
    assert.equal(payload.game.airports[0].saleListing, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown airport ID/i);
  } finally {
    console.warn = originalWarn;
  }
});

test('airport saleListing is projected as a new object when present', () => {
  const initialState = {
    id: 'game-4',
    status: 'active',
    createdAt: 423456,
    startedAt: 423456,
    endsAt: 2223456,
    durationMs: 1800000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 }
    ],
    airports: [
      {
        airportId: 'YYZ',
        ownerPlayerId: 'p1',
        saleListing: { sellerPlayerId: 'p1', listPrice: 350000 }
      }
    ]
  };

  const manager = {
    io: {
      to() {
        return {
          emit() {}
        };
      }
    }
  };

  const game = new Game(initialState, manager);
  const payload = game.getPublicState();

  assert.notEqual(payload.game.airports[0].saleListing, game.authoritativeState.airports[0].saleListing);
  payload.game.airports[0].saleListing.listPrice = 1;
  assert.equal(game.authoritativeState.airports[0].saleListing.listPrice, 350000);
});

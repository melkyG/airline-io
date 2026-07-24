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
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 }
    ],
    airports: [
      { airportId: 'YYZ', ownerPlayerId: null }
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
          ownerPlayerId: null
        }
      ]
    }
  });

  payload.game.players[0].username = 'Changed';
  payload.game.airports[0].ownerPlayerId = 'p1';
  assert.equal(game.authoritativeState.players[0].username, 'Alice');
  assert.equal(game.authoritativeState.airports[0].ownerPlayerId, null);
  assert.equal('startedAt' in payload.game, true);
  assert.equal('endsAt' in payload.game, true);
  assert.equal('durationMs' in payload.game, true);
  assert.equal('scoreToWin' in payload.game, true);
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
      { airportId: 'YYZ', ownerPlayerId: null }
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
      ownerPlayerId: null
    }
  ]);
  assert.deepEqual(game.authoritativeState.airports, [{ airportId: 'YYZ', ownerPlayerId: null }]);
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
      { airportId: 'YYZ', ownerPlayerId: null },
      { airportId: 'UNKNOWN', ownerPlayerId: null }
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
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown airport ID/i);
  } finally {
    console.warn = originalWarn;
  }
});

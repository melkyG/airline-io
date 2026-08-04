const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  STARTING_CAPITAL,
  STARTING_SCORE,
  GAME_DURATION_MS,
  SCORE_TO_WIN,
  SIMULATION_SPEED_MULTIPLIER
} = require('../gameFactory');
const { AIRPORT_CATALOG } = require('../airports/catalog');

function makeLobbyPlayers() {
  return [
    {
      id: 'socket-1',
      displayName: 'Alice',
      lobbyId: 'lobby-1',
      connected: true,
      score: 5,
      colorId: 'violet',
      colorHex: '#8b5cf6'
    },
    {
      id: 'socket-2',
      displayName: 'Bob',
      lobbyId: 'lobby-1',
      connected: true,
      score: 1,
      colorId: 'sky',
      colorHex: '#0ea5e9'
    }
  ];
}

test('createGame builds the expected initial authoritative state shape', () => {
  const lobbyPlayers = makeLobbyPlayers();
  const game = createGame(lobbyPlayers);

  assert.equal(typeof game.id, 'string');
  assert.ok(game.id.length > 0);
  assert.equal(game.status, 'active');
  assert.equal(typeof game.createdAt, 'number');
  assert.ok(Number.isFinite(game.createdAt));
  assert.equal(game.startedAt, game.createdAt);
  assert.equal(game.endsAt, game.startedAt + GAME_DURATION_MS);
  assert.equal(game.durationMs, GAME_DURATION_MS);
  assert.equal(game.scoreToWin, SCORE_TO_WIN);
  assert.equal(game.simulationStartedAtRealMs, null);
  assert.equal(game.simulationStartedAtGameMs, null);
  assert.equal(game.simulationSpeedMultiplier, SIMULATION_SPEED_MULTIPLIER);
  assert.equal(game.simulationEndedAtGameMs, null);

  assert.equal(Array.isArray(game.players), true);
  assert.equal(game.players.length, 2);

  assert.deepEqual(
    game.players.map((player) => ({
      id: player.id,
      username: player.username,
      isBot: player.isBot,
      score: player.score,
      colorId: player.colorId,
      colorHex: player.colorHex
    })),
    [
      { id: 'socket-1', username: 'Alice', isBot: false, score: STARTING_SCORE, colorId: 'violet', colorHex: '#8b5cf6' },
      { id: 'socket-2', username: 'Bob', isBot: false, score: STARTING_SCORE, colorId: 'sky', colorHex: '#0ea5e9' }
    ]
  );

  assert.deepEqual(
    game.players.map((player) => player.capital),
    [STARTING_CAPITAL, STARTING_CAPITAL]
  );

  assert.deepEqual(
    game.airports,
    AIRPORT_CATALOG.map((airport) => ({
      airportId: airport.id,
      ownerPlayerId: null,
      saleListing: null
    }))
  );

  assert.equal(Array.isArray(game.ownedAircraft), true);
  assert.deepEqual(game.ownedAircraft, []);
  assert.equal(Array.isArray(game.routes), true);
  assert.deepEqual(game.routes, []);
  assert.equal(Array.isArray(game.flights), true);
  assert.deepEqual(game.flights, []);
});

test('createGame does not reuse lobby player object references', () => {
  const lobbyPlayers = makeLobbyPlayers();
  const game = createGame(lobbyPlayers);

  assert.notEqual(game.players[0], lobbyPlayers[0]);
  assert.notEqual(game.players[1], lobbyPlayers[1]);
});

test('mutating game players does not mutate original lobby players', () => {
  const lobbyPlayers = makeLobbyPlayers();
  const game = createGame(lobbyPlayers);

  game.players[0].username = 'Changed';
  game.players[0].capital = 0;
  game.players[0].score = 99;

  assert.equal(lobbyPlayers[0].displayName, 'Alice');
  assert.equal(lobbyPlayers[0].capital, undefined);
  assert.equal(lobbyPlayers[0].score, 5);
});

test('createGame preserves bot and human lobby colors in authoritative game players', () => {
  const lobbyPlayers = [
    {
      id: 'socket-human',
      displayName: 'Alice',
      lobbyId: 'lobby-1',
      connected: true,
      isBot: false,
      colorId: 'violet',
      colorHex: '#8b5cf6'
    },
    {
      id: 'bot-1',
      displayName: 'Sky Goose',
      lobbyId: 'lobby-1',
      connected: true,
      isBot: true,
      colorId: 'sky',
      colorHex: '#0ea5e9'
    }
  ];

  const game = createGame(lobbyPlayers);

  assert.deepEqual(
    game.players.map((player) => ({
      id: player.id,
      isBot: player.isBot,
      colorId: player.colorId,
      colorHex: player.colorHex
    })),
    [
      { id: 'socket-human', isBot: false, colorId: 'violet', colorHex: '#8b5cf6' },
      { id: 'bot-1', isBot: true, colorId: 'sky', colorHex: '#0ea5e9' }
    ]
  );

  lobbyPlayers[0].colorId = 'red';
  lobbyPlayers[0].colorHex = '#ef4444';
  lobbyPlayers[1].colorId = 'lime';
  lobbyPlayers[1].colorHex = '#84cc16';

  assert.equal(game.players[0].colorId, 'violet');
  assert.equal(game.players[0].colorHex, '#8b5cf6');
  assert.equal(game.players[1].colorId, 'sky');
  assert.equal(game.players[1].colorHex, '#0ea5e9');
});

test('two games are independent objects and have different IDs', () => {
  const lobbyPlayers = makeLobbyPlayers();
  const gameA = createGame(lobbyPlayers);
  const gameB = createGame(lobbyPlayers);

  assert.notEqual(gameA, gameB);
  assert.notEqual(gameA.players, gameB.players);
  assert.notEqual(gameA.id, gameB.id);

  gameA.players[0].username = 'Altered A';

  assert.equal(gameB.players[0].username, 'Alice');
});

test('two games do not share mutable airport-state object references', () => {
  const lobbyPlayers = makeLobbyPlayers();
  const gameA = createGame(lobbyPlayers);
  const gameB = createGame(lobbyPlayers);

  assert.notEqual(gameA.airports, gameB.airports);
  assert.notEqual(gameA.airports[0], gameB.airports[0]);

  gameA.airports[0].ownerPlayerId = gameA.players[0].id;
  gameA.airports[0].saleListing = { sellerPlayerId: gameA.players[0].id, listPrice: 350000 };

  assert.equal(gameA.airports[0].ownerPlayerId, gameA.players[0].id);
  assert.deepEqual(gameA.airports[0].saleListing, { sellerPlayerId: gameA.players[0].id, listPrice: 350000 });
  assert.equal(gameB.airports[0].ownerPlayerId, null);
  assert.equal(gameB.airports[0].saleListing, null);
});

test('new games start with no owned aircraft before purchasing is implemented', () => {
  const lobbyPlayers = makeLobbyPlayers();
  const game = createGame(lobbyPlayers);

  assert.deepEqual(game.ownedAircraft, []);
});

test('airport catalog is immutable shared static world data', () => {
  assert.equal(Object.isFrozen(AIRPORT_CATALOG), true);
  assert.equal(Array.isArray(AIRPORT_CATALOG), true);
  assert.ok(AIRPORT_CATALOG.length >= 2);
  assert.equal(Object.isFrozen(AIRPORT_CATALOG[0]), true);
  AIRPORT_CATALOG.forEach((airport) => {
    assert.equal(Object.isFrozen(airport), true);
  });

  const originalName = AIRPORT_CATALOG[0].name;
  const originalBasePrice = AIRPORT_CATALOG[0].basePrice;

  try {
    AIRPORT_CATALOG[0].name = 'Changed';
    AIRPORT_CATALOG[0].basePrice = 1;
  } catch (error) {
    // Assignment to frozen objects may throw in strict mode.
  }

  assert.equal(AIRPORT_CATALOG[0].name, originalName);
  assert.equal(AIRPORT_CATALOG[0].basePrice, originalBasePrice);
});

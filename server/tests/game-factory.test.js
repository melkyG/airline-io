const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, STARTING_CAPITAL } = require('../gameFactory');

function makeLobbyPlayers() {
  return [
    {
      id: 'socket-1',
      displayName: 'Alice',
      lobbyId: 'lobby-1',
      connected: true,
      score: 5
    },
    {
      id: 'socket-2',
      displayName: 'Bob',
      lobbyId: 'lobby-1',
      connected: true,
      score: 1
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

  assert.equal(Array.isArray(game.players), true);
  assert.equal(game.players.length, 2);

  assert.deepEqual(
    game.players.map((player) => ({ id: player.id, username: player.username })),
    [
      { id: 'socket-1', username: 'Alice' },
      { id: 'socket-2', username: 'Bob' }
    ]
  );

  assert.deepEqual(
    game.players.map((player) => player.capital),
    [STARTING_CAPITAL, STARTING_CAPITAL]
  );

  assert.deepEqual(game.airports, []);
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

  assert.equal(lobbyPlayers[0].displayName, 'Alice');
  assert.equal(lobbyPlayers[0].capital, undefined);
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

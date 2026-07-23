const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, STARTING_CAPITAL, STARTING_SCORE, GAME_DURATION_MS, SCORE_TO_WIN } = require('../gameFactory');

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
  assert.equal(game.startedAt, game.createdAt);
  assert.equal(game.endsAt, game.startedAt + GAME_DURATION_MS);
  assert.equal(game.durationMs, GAME_DURATION_MS);
  assert.equal(game.scoreToWin, SCORE_TO_WIN);

  assert.equal(Array.isArray(game.players), true);
  assert.equal(game.players.length, 2);

  assert.deepEqual(
    game.players.map((player) => ({ id: player.id, username: player.username, score: player.score })),
    [
      { id: 'socket-1', username: 'Alice', score: STARTING_SCORE },
      { id: 'socket-2', username: 'Bob', score: STARTING_SCORE }
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
  game.players[0].score = 99;

  assert.equal(lobbyPlayers[0].displayName, 'Alice');
  assert.equal(lobbyPlayers[0].capital, undefined);
  assert.equal(lobbyPlayers[0].score, 5);
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

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
      airports: []
    }
  });

  payload.game.players[0].username = 'Changed';
  assert.equal(game.authoritativeState.players[0].username, 'Alice');
  assert.equal('startedAt' in payload.game, true);
  assert.equal('endsAt' in payload.game, true);
  assert.equal('durationMs' in payload.game, true);
  assert.equal('scoreToWin' in payload.game, true);
});

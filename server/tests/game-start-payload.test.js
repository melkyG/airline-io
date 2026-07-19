const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');

test('game:started public payload includes authoritative game wrapper', () => {
  const initialState = {
    id: 'game-1',
    status: 'active',
    createdAt: 123456,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000 }
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
      players: [
        { id: 'p1', username: 'Alice', capital: 1000000 }
      ],
      airports: []
    }
  });

  payload.game.players[0].username = 'Changed';
  assert.equal(game.authoritativeState.players[0].username, 'Alice');
});

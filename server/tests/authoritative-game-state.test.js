const test = require('node:test');
const assert = require('node:assert/strict');

function createStateFactory() {
  const stateModulePath = require.resolve('../../client/state.js');
  delete require.cache[stateModulePath];

  global.window = {};
  require('../../client/state.js');
  return global.window.createGameState;
}

test('client stores authoritative game without leaderboard property', () => {
  const createGameState = createStateFactory();

  const state = createGameState({
    connection: { status: 'connected' },
    session: {
      playerId: 'p1',
      joined: true,
      joinPending: false,
      currentLobbyId: 'l1',
      currentGameId: null
    },
    lobby: {
      lobbyId: 'l1',
      status: 'countdown',
      playerCount: 5,
      maxPlayers: 5,
      players: [],
      countdownSeconds: 1
    },
    ui: { errorMessage: null, screen: 'lobby' },
    game: {
      id: null,
      status: null,
      createdAt: null,
      players: [],
      airports: []
    },
    waitingAnimation: { step: 0 }
  });

  state.update(() => ({
    game: {
      id: 'game-1',
      status: 'active',
      createdAt: 123,
      players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
      airports: []
    }
  }));

  const snapshot = state.getState();

  assert.deepEqual(Object.keys(snapshot.game).sort(), ['airports', 'createdAt', 'id', 'players', 'status']);
  assert.equal('leaderboard' in snapshot.game, false);

  delete global.window;
});

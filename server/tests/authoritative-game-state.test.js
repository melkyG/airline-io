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
      startedAt: null,
      endsAt: null,
      durationMs: null,
      scoreToWin: null,
      players: [],
      airports: [],
      ownedAircraft: []
    },
    waitingAnimation: { step: 0 }
  });

  state.update(() => ({
    game: {
      id: 'game-1',
      status: 'active',
      createdAt: 123,
      startedAt: 123,
      endsAt: 1800123,
      durationMs: 1800000,
      scoreToWin: 1000,
      players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
      airports: [],
      ownedAircraft: []
    }
  }));

  const snapshot = state.getState();

  assert.deepEqual(Object.keys(snapshot.game).sort(), ['airports', 'createdAt', 'durationMs', 'endsAt', 'id', 'ownedAircraft', 'players', 'scoreToWin', 'startedAt', 'status']);
  assert.equal('leaderboard' in snapshot.game, false);

  delete global.window;
});

test('client retains authoritative owned aircraft when a game update omits the field', () => {
  const createGameState = createStateFactory();
  const ownedAircraft = [
    { aircraftInstanceId: 'acft-1', ownerPlayerId: 'p1', assignedRouteId: 'route-1' }
  ];
  const state = createGameState({
    connection: { status: 'connected' },
    session: {},
    lobby: { players: [] },
    ui: { screen: 'game' },
    game: { ownedAircraft },
    waitingAnimation: {}
  });

  state.update(() => ({
    game: {
      status: 'active',
      routes: [{ routeId: 'route-1', ownerPlayerId: 'p1', assignedAircraftInstanceIds: ['acft-1'] }]
    }
  }));

  assert.deepEqual(state.getState().game.ownedAircraft, ownedAircraft);

  delete global.window;
});

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

test('game ends by score threshold and records endReason/endedAt once', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = {
    id: 'game-score',
    status: 'active',
    createdAt: 10,
    startedAt: 10,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 100,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 100 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 20 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);

  game.initialize();

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(typeof game.authoritativeState.endedAt, 'number');
  assert.equal(game.endTimeoutId, null);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, 'game:started');

  const endedAt = game.authoritativeState.endedAt;
  const secondEndAttempt = game.endGame('time');
  assert.equal(secondEndAttempt, false);
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(game.authoritativeState.endedAt, endedAt);
});

test('game ends by time expiration and records time end reason', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = {
    id: 'game-time',
    status: 'active',
    createdAt: 10,
    startedAt: 10,
    endsAt: Date.now() - 1,
    durationMs: 60000,
    scoreToWin: 999,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);

  game.initialize();

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'time');
  assert.equal(typeof game.authoritativeState.endedAt, 'number');
  assert.equal(game.endTimeoutId, null);
  assert.equal(emitted.length, 1);
});

test('dispose clears pending expiration timeout for active game', () => {
  const { manager } = createManagerWithEmitCapture();
  const initialState = {
    id: 'game-dispose',
    status: 'active',
    createdAt: 10,
    startedAt: 10,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 0 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);

  game.initialize();
  assert.notEqual(game.endTimeoutId, null);

  game.dispose();
  assert.equal(game.endTimeoutId, null);
});

test('addScore updates authoritative player score and broadcasts while active', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = {
    id: 'game-add-score',
    status: 'active',
    createdAt: 10,
    startedAt: 10,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 1000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 10 },
      { id: 'p2', username: 'Bob', capital: 1000000, score: 20 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);
  game.initialize();
  assert.equal(emitted.length, 1);

  const updated = game.addScore('p1', 500);
  assert.equal(updated, true);
  assert.equal(game.authoritativeState.players[0].score, 510);
  assert.equal(emitted.length, 2);
  assert.equal(game.status, 'active');
});

test('addScore can end the game via score win condition', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = {
    id: 'game-add-score-end',
    status: 'active',
    createdAt: 10,
    startedAt: 10,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 500,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000, score: 10 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);
  game.initialize();
  assert.equal(emitted.length, 1);

  const updated = game.addScore('p1', 500);
  assert.equal(updated, true);
  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(emitted.length, 2);
});

test('GameManager.shutdown disposes active game timers', () => {
  const io = {
    to() {
      return {
        emit() {}
      };
    }
  };

  const manager = new GameManager(io);

  let disposed = false;
  manager.games.set('game-1', {
    dispose() {
      disposed = true;
    }
  });

  manager.shutdown();

  assert.equal(disposed, true);
});

test('GameManager.handleDeveloperScoreRequest only affects requester in active game', () => {
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
    addScore(playerId, amount) {
      captured = { playerId, amount };
      return true;
    }
  });

  const success = manager.handleDeveloperScoreRequest('socket-1', 500);
  assert.equal(success, true);
  assert.deepEqual(captured, { playerId: 'socket-1', amount: 500 });

  const denied = manager.handleDeveloperScoreRequest('socket-2', 500);
  assert.equal(denied, false);
});

test('endGame stores authoritative results ranked by score then capital', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = {
    id: 'game-results-rank',
    status: 'active',
    createdAt: 10,
    startedAt: 10,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 100,
    players: [
      { id: 'p1', username: 'Alpha', capital: 500, score: 120 },
      { id: 'p2', username: 'Bravo', capital: 900, score: 120 },
      { id: 'p3', username: 'Charlie', capital: 5000, score: 90 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);
  game.initialize();

  assert.equal(game.status, 'ended');
  assert.ok(game.authoritativeState.results);
  assert.equal(game.authoritativeState.results.winner.id, 'p2');
  assert.deepEqual(
    game.authoritativeState.results.standings.map((entry) => entry.id),
    ['p2', 'p1', 'p3']
  );

  assert.equal(emitted.length, 1);
  const payload = emitted[0].payload;
  assert.ok(payload.game.results);
  assert.equal(payload.game.results.winner.id, 'p2');
});

test('exact score and capital ties use server-side random tie-break and results do not regenerate', () => {
  const originalRandom = Math.random;
  let callCount = 0;

  Math.random = () => {
    callCount += 1;
    return callCount <= 16 ? 0 : 1;
  };

  try {
    const { manager } = createManagerWithEmitCapture();
    const initialState = {
      id: 'game-results-tie',
      status: 'active',
      createdAt: 10,
      startedAt: 10,
      endsAt: Date.now() + 60000,
      durationMs: 60000,
      scoreToWin: 100,
      players: [
        { id: 'p1', username: 'Alpha', capital: 700, score: 100 },
        { id: 'p2', username: 'Bravo', capital: 700, score: 100 }
      ],
      airports: []
    };

    const game = new Game(initialState, manager);
    game.initialize();

    assert.equal(game.status, 'ended');
    assert.equal(game.authoritativeState.results.winner.id, 'p2');

    const firstResults = JSON.stringify(game.authoritativeState.results);

    Math.random = () => 0;
    const secondEndAttempt = game.endGame('time');
    assert.equal(secondEndAttempt, false);
    assert.equal(JSON.stringify(game.authoritativeState.results), firstResults);
  } finally {
    Math.random = originalRandom;
  }
});

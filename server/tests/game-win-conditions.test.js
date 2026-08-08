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
      { id: 'p1', username: 'Alice', capital: 1000000, debugScoreOffset: 100 },
      { id: 'p2', username: 'Bob', capital: 1000000, debugScoreOffset: 20 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);

  game.initialize();

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(typeof game.authoritativeState.endedAt, 'number');
  assert.equal(typeof game.authoritativeState.simulationEndedAtGameMs, 'number');
  assert.equal(game.endTimeoutId, null);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(emitted[1].eventName, 'game:state');

  const endedAt = game.authoritativeState.endedAt;
  const simulationEndedAtGameMs = game.authoritativeState.simulationEndedAtGameMs;
  const secondEndAttempt = game.endGame('time');
  assert.equal(secondEndAttempt, false);
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(game.authoritativeState.endedAt, endedAt);
  assert.equal(game.authoritativeState.simulationEndedAtGameMs, simulationEndedAtGameMs);
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
      { id: 'p1', username: 'Alice', capital: 1000000 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);

  game.initialize();

  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'time');
  assert.equal(typeof game.authoritativeState.endedAt, 'number');
  assert.equal(typeof game.authoritativeState.simulationEndedAtGameMs, 'number');
  assert.equal(game.endTimeoutId, null);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(emitted[1].eventName, 'game:state');
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
      { id: 'p1', username: 'Alice', capital: 1000000 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);

  game.initialize();
  assert.notEqual(game.endTimeoutId, null);

  game.dispose();
  assert.equal(game.endTimeoutId, null);
});

test('addDebugScoreOffset updates authoritative debug score offset and broadcasts while active', () => {
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
      { id: 'p1', username: 'Alice', capital: 1000000 },
      { id: 'p2', username: 'Bob', capital: 1000000 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);
  game.initialize();
  assert.equal(emitted.length, 1);

  const updated = game.addDebugScoreOffset('p1', 500);
  assert.equal(updated, true);
  assert.equal(game.authoritativeState.players[0].debugScoreOffset, 500);
  assert.equal(game.getPublicState().game.players[0].score, 500);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(emitted[1].eventName, 'game:state');
  assert.equal(game.status, 'active');
});

test('addDebugScoreOffset can end the game via score win condition', () => {
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
      { id: 'p1', username: 'Alice', capital: 1000000 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);
  game.initialize();
  assert.equal(emitted.length, 1);

  const updated = game.addDebugScoreOffset('p1', 500);
  assert.equal(updated, true);
  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(emitted[1].eventName, 'game:state');
});

test('game:started is emitted only once at initialization while later updates use game:state', () => {
  const { manager, emitted } = createManagerWithEmitCapture();
  const initialState = {
    id: 'game-start-once',
    status: 'active',
    createdAt: 10,
    startedAt: 10,
    endsAt: Date.now() + 60000,
    durationMs: 60000,
    scoreToWin: 5000,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000 }
    ],
    airports: []
  };

  const game = new Game(initialState, manager);
  game.initialize();
  game.addDebugScoreOffset('p1', 5);
  game.addDebugScoreOffset('p1', 10);

  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(emitted[1].eventName, 'game:state');
  assert.equal(emitted[2].eventName, 'game:state');
  assert.equal(emitted.filter((entry) => entry.eventName === 'game:started').length, 1);
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
    addDebugScoreOffset(playerId, amount) {
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
      { id: 'p1', username: 'Alpha', capital: 500, score: 1, debugScoreOffset: 120 },
      { id: 'p2', username: 'Bravo', capital: 900, score: 99999, debugScoreOffset: 120 },
      { id: 'p3', username: 'Charlie', capital: 5000, score: 50000, debugScoreOffset: 90 }
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

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, 'game:started');
  assert.equal(emitted[1].eventName, 'game:state');
  const payload = emitted[1].payload;
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
        { id: 'p1', username: 'Alpha', capital: 700, debugScoreOffset: 100 },
        { id: 'p2', username: 'Bravo', capital: 700, debugScoreOffset: 100 }
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

test('public score starts at derived 0 when no debug offset exists', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    {
      id: 'game-derived-zero',
      status: 'active',
      createdAt: 10,
      startedAt: 10,
      endsAt: Date.now() + 60000,
      durationMs: 60000,
      scoreToWin: 1000,
      players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
      airports: []
    },
    manager
  );

  assert.equal(game.getPublicState().game.players[0].score, 0);
});

test('legacy stored player.score changes do not affect authoritative derived score', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    {
      id: 'game-legacy-score-ignored',
      status: 'active',
      createdAt: 10,
      startedAt: 10,
      endsAt: Date.now() + 60000,
      durationMs: 60000,
      scoreToWin: 1000,
      players: [{ id: 'p1', username: 'Alice', capital: 1000000, score: 25 }],
      airports: []
    },
    manager
  );

  assert.equal(game.getPublicState().game.players[0].score, 0);
  game.authoritativeState.players[0].score = 99999;
  assert.equal(game.getPublicState().game.players[0].score, 0);
});

test('public snapshot score uses centralized net-worth-derived path and ignores legacy score', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    {
      id: 'game-public-net-worth-derived',
      status: 'active',
      createdAt: 10,
      startedAt: 10,
      endsAt: Date.now() + 60000,
      durationMs: 60000,
      scoreToWin: 1000,
      players: [{ id: 'p1', username: 'Alice', capital: 1_000_000_000, score: 99999 }],
      airports: []
    },
    manager
  );

  const publicScore = game.getPublicState().game.players[0].score;
  assert.ok(publicScore > 0);
  assert.ok(publicScore < 500);
});

test('win condition uses centralized derived score path from net worth', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    {
      id: 'game-win-net-worth-derived',
      status: 'active',
      createdAt: 10,
      startedAt: 10,
      endsAt: Date.now() + 60000,
      durationMs: 60000,
      scoreToWin: 500,
      players: [{ id: 'p1', username: 'Alice', capital: 100_000_000_000 }],
      airports: []
    },
    manager
  );

  game.initialize();
  assert.equal(game.status, 'ended');
  assert.equal(game.authoritativeState.endReason, 'score');
});

test('results ranking uses centralized derived score path from net worth', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(
    {
      id: 'game-results-net-worth-derived',
      status: 'active',
      createdAt: 10,
      startedAt: 10,
      endsAt: Date.now() + 60000,
      durationMs: 60000,
      scoreToWin: 999999,
      players: [
        { id: 'p1', username: 'Alpha', capital: 100_000_000_000, score: 0 },
        { id: 'p2', username: 'Bravo', capital: 1_000_000, score: 99999 }
      ],
      airports: []
    },
    manager
  );

  const results = game.generateResults();
  assert.equal(results.winner.id, 'p1');
  assert.deepEqual(results.standings.map((entry) => entry.id), ['p1', 'p2']);
});

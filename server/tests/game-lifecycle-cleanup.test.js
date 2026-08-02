const test = require('node:test');
const assert = require('node:assert/strict');
const GameManager = require('../GameManager');
const Game = require('../Game');

function createIoCapture() {
  const emitted = [];
  const io = {
    to(roomName) {
      return {
        emit(eventName, payload) {
          emitted.push({ roomName, eventName, payload });
        }
      };
    }
  };

  return { io, emitted };
}

function createSocket(id) {
  return {
    id,
    connected: true,
    joinedRooms: new Set(),
    join(roomName) {
      this.joinedRooms.add(roomName);
    },
    leave(roomName) {
      this.joinedRooms.delete(roomName);
    }
  };
}

function createFakeTimerApi() {
  let idSeed = 0;
  const scheduled = new Map();
  const cleared = [];

  return {
    setTimeout(callback, delayMs) {
      idSeed += 1;
      const timer = {
        id: idSeed,
        callback,
        delayMs
      };
      scheduled.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) {
      if (!timer) {
        return;
      }

      const timerId = typeof timer === 'object' && timer !== null ? timer.id : timer;
      if (scheduled.has(timerId)) {
        scheduled.delete(timerId);
      }
      cleared.push(timerId);
    },
    fire(timer) {
      const timerId = typeof timer === 'object' && timer !== null ? timer.id : timer;
      const entry = scheduled.get(timerId);
      if (!entry) {
        return false;
      }

      scheduled.delete(timerId);
      entry.callback();
      return true;
    },
    listScheduled() {
      return Array.from(scheduled.values());
    },
    get clearedTimerIds() {
      return cleared.slice();
    }
  };
}

function createManagedGame({
  manager,
  gameId,
  humanCount,
  connectedHumanCount,
  botCount,
  scoreToWin = 1000,
  endsAt = Date.now() + 60000,
  humanScores = []
}) {
  const humans = [];
  const bots = [];

  for (let index = 0; index < humanCount; index += 1) {
    const socketId = `socket-human-${index + 1}-${gameId}`;
    const socket = createSocket(socketId);
    manager.registerConnection(socket);
    const player = manager.createPlayer(socket, `Human${index + 1}`);
    humans.push(player);
  }

  for (let index = 0; index < botCount; index += 1) {
    const bot = manager.createBotPlayer(`Bot${index + 1}`);
    bots.push(bot);
  }

  const runtimePlayers = [...humans, ...bots];

  const initialState = {
    id: gameId,
    status: 'active',
    createdAt: Date.now(),
    startedAt: Date.now(),
    endsAt,
    durationMs: Math.max(1, endsAt - Date.now()),
    scoreToWin,
    players: runtimePlayers.map((player, index) => ({
      id: player.id,
      username: player.displayName,
      isBot: Boolean(player.isBot),
      capital: 1000000,
      score: Number.isFinite(humanScores[index]) ? humanScores[index] : 0
    })),
    airports: [],
    ownedAircraft: []
  };

  const game = new Game(initialState, manager);
  manager.games.set(game.id, game);

  runtimePlayers.forEach((player, index) => {
    player.gameId = game.id;
    player.lobbyId = null;

    if (player.isBot) {
      player.connected = true;
      player.socket = null;
    } else {
      const isConnected = index < connectedHumanCount;
      player.connected = isConnected;
      if (!isConnected) {
        player.socket = null;
      }
    }

    game.players.set(player.id, player);
    manager.playerGameIds.set(player.id, game.id);
    manager.connections.delete(player.id);
  });

  return {
    game,
    humans,
    bots
  };
}

test('one human plus bots: human disconnect during active game destroys the game', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const { game, humans } = createManagedGame({
    manager,
    gameId: 'active-disconnect-destroy',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 4
  });

  const result = manager.handleDisconnect(humans[0].id);

  assert.equal(result, undefined);
  assert.equal(manager.games.has(game.id), false);
});

test('one human plus bots: explicit game leave destroys the game', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const { game, humans } = createManagedGame({
    manager,
    gameId: 'active-leave-destroy',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 4
  });

  const result = manager.leaveGame(humans[0].id);

  assert.equal(result.success, true);
  assert.equal(result.code, 'GAME_DESTROYED');
  assert.equal(manager.games.has(game.id), false);
});

test('two humans and bots: one disconnects and game remains active', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const { game, humans } = createManagedGame({
    manager,
    gameId: 'active-continue-after-disconnect',
    humanCount: 2,
    connectedHumanCount: 2,
    botCount: 3
  });

  manager.handleDisconnect(humans[0].id);

  assert.equal(manager.games.has(game.id), true);
  assert.equal(manager.getConnectedRealHumansInGame(game), 1);
  assert.equal(humans[0].connected, false);
  assert.equal(humans[0].socket, null);
});

test('bots never count as connected humans', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const { game } = createManagedGame({
    manager,
    gameId: 'connected-human-count-excludes-bots',
    humanCount: 0,
    connectedHumanCount: 0,
    botCount: 5
  });

  assert.equal(manager.getConnectedRealHumansInGame(game), 0);
});

test('timer-based completion retains ended game and schedules retention', () => {
  const { io } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, { timerApi });
  const { game } = createManagedGame({
    manager,
    gameId: 'ended-time-retained',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 1,
    scoreToWin: 99999,
    endsAt: Date.now() - 1
  });

  game.initialize();

  assert.equal(game.status, 'ended');
  assert.equal(manager.games.has(game.id), true);
  assert.equal(manager.endedGameRetentionTimeoutIds.has(game.id), true);
});

test('score-based completion retains ended game and schedules retention', () => {
  const { io } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, { timerApi });
  const { game } = createManagedGame({
    manager,
    gameId: 'ended-score-retained',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 1,
    scoreToWin: 100,
    humanScores: [100]
  });

  game.initialize();

  assert.equal(game.status, 'ended');
  assert.equal(manager.games.has(game.id), true);
  assert.equal(manager.endedGameRetentionTimeoutIds.has(game.id), true);
});

test('ended game is destroyed when final human explicitly leaves', () => {
  const { io } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, { timerApi });
  const { game, humans } = createManagedGame({
    manager,
    gameId: 'ended-leave-destroy',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 2,
    scoreToWin: 100,
    humanScores: [100]
  });

  game.initialize();
  const result = manager.leaveGame(humans[0].id);

  assert.equal(result.success, true);
  assert.equal(result.code, 'GAME_DESTROYED');
  assert.equal(manager.games.has(game.id), false);
});

test('ended game is destroyed when final human disconnects', () => {
  const { io } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, { timerApi });
  const { game, humans } = createManagedGame({
    manager,
    gameId: 'ended-disconnect-destroy',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 2,
    scoreToWin: 100,
    humanScores: [100]
  });

  game.initialize();
  manager.handleDisconnect(humans[0].id);

  assert.equal(manager.games.has(game.id), false);
});

test('ended game survives while at least one connected human remains before retention expiry', () => {
  const { io } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, { timerApi });
  const { game, humans } = createManagedGame({
    manager,
    gameId: 'ended-survives-with-viewer',
    humanCount: 2,
    connectedHumanCount: 2,
    botCount: 1,
    scoreToWin: 100,
    humanScores: [100, 0]
  });

  game.initialize();
  manager.handleDisconnect(humans[0].id);

  assert.equal(manager.games.has(game.id), true);
  assert.equal(manager.getConnectedRealHumansInGame(game), 1);
  assert.equal(manager.endedGameRetentionTimeoutIds.has(game.id), true);
});

test('ended game disconnect removes only the departed real player from live players while preserving final results snapshot', () => {
  const { io, emitted } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, { timerApi });
  const { game, humans, bots } = createManagedGame({
    manager,
    gameId: 'ended-live-leaderboard-prunes-disconnect',
    humanCount: 2,
    connectedHumanCount: 2,
    botCount: 1,
    scoreToWin: 100,
    humanScores: [100, 0]
  });

  game.initialize();
  const standingsBeforeDisconnect = game.authoritativeState.results.standings.map((entry) => entry.id);

  manager.handleDisconnect(humans[0].id);

  assert.equal(game.status, 'ended');
  assert.equal(manager.games.has(game.id), true);
  assert.equal(manager.getConnectedRealHumansInGame(game), 1);
  assert.equal(manager.endedGameRetentionTimeoutIds.has(game.id), true);

  assert.deepEqual(
    game.authoritativeState.players.map((player) => player.id),
    [humans[1].id, bots[0].id]
  );

  assert.deepEqual(
    game.authoritativeState.results.standings.map((entry) => entry.id),
    standingsBeforeDisconnect
  );

  const latestGameStateEvent = emitted
    .filter((entry) => entry.eventName === 'game:state')
    .at(-1);
  assert.ok(latestGameStateEvent);
  assert.deepEqual(
    latestGameStateEvent.payload.game.players.map((player) => player.id),
    [humans[1].id, bots[0].id]
  );
  assert.deepEqual(
    latestGameStateEvent.payload.game.results.standings.map((entry) => entry.id),
    standingsBeforeDisconnect
  );
});

test('five-minute retention expiry destroys ended game', () => {
  const { io } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, {
    endedGameRetentionMs: 5 * 60 * 1000,
    timerApi
  });

  const { game } = createManagedGame({
    manager,
    gameId: 'ended-expiry-destroy',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 1,
    scoreToWin: 100,
    humanScores: [100]
  });

  game.initialize();
  const retentionTimer = manager.endedGameRetentionTimeoutIds.get(game.id);
  assert.ok(retentionTimer);

  const fired = timerApi.fire(retentionTimer);
  assert.equal(fired, true);
  assert.equal(manager.games.has(game.id), false);
});

test('destroyGame is idempotent', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const { game } = createManagedGame({
    manager,
    gameId: 'destroy-idempotent',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 1
  });

  const first = manager.destroyGame(game.id, 'test-first-destroy');
  const second = manager.destroyGame(game.id, 'test-second-destroy');

  assert.equal(first, true);
  assert.equal(second, false);
});

test('destroyGame clears both game-duration and retention timers', () => {
  const { io } = createIoCapture();
  const timerApi = createFakeTimerApi();
  const manager = new GameManager(io, { timerApi });
  const { game } = createManagedGame({
    manager,
    gameId: 'destroy-clears-timers',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 1,
    endsAt: Date.now() + 120000
  });

  game.initialize();
  assert.notEqual(game.endTimeoutId, null);

  const retentionTimer = timerApi.setTimeout(() => {}, 1234);
  manager.endedGameRetentionTimeoutIds.set(game.id, retentionTimer);

  const destroyed = manager.destroyGame(game.id, 'timer-cleanup-test');

  assert.equal(destroyed, true);
  assert.equal(game.endTimeoutId, null);
  assert.equal(manager.endedGameRetentionTimeoutIds.has(game.id), false);
  assert.ok(timerApi.clearedTimerIds.includes(retentionTimer.id));
});

test('destroyGame leaves no stale game or player mappings', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const { game, humans, bots } = createManagedGame({
    manager,
    gameId: 'destroy-no-stale-registries',
    humanCount: 1,
    connectedHumanCount: 1,
    botCount: 4
  });

  const allPlayerIds = [...humans, ...bots].map((player) => player.id);
  const destroyed = manager.destroyGame(game.id, 'registry-cleanup-test');

  assert.equal(destroyed, true);
  assert.equal(manager.games.has(game.id), false);

  allPlayerIds.forEach((playerId) => {
    assert.equal(manager.playerGameIds.has(playerId), false);
  });

  bots.forEach((bot) => {
    assert.equal(manager.players.has(bot.id), false);
  });

  assert.equal(manager.connections.has(humans[0].id), true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Game = require('../Game');
const GameManager = require('../GameManager');
const { calculateNetWorthByPlayer } = require('../economy/netWorth');

const SAMPLE_INTERVAL = 15 * 1000 * 1000; // 15,000,000 sim ms (~1 real second at 15000x)

function createManagerWithEmitCapture() {
  const emitted = [];
  const manager = {
    io: {
      to(roomName) {
        const room = {
          emit(eventName, payload) {
            emitted.push({ roomName, eventName, payload });
          }
        };
        room.volatile = room;
        return room;
      }
    }
  };

  return { manager, emitted };
}

function createGameState(overrides = {}) {
  return {
    id: 'game-finance-history',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 3600000,
    durationMs: 3600000,
    scoreToWin: 1000,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 15000,
    simulationEndedAtGameMs: null,
    players: [
      { id: 'p1', username: 'Alice', capital: 1000000 },
      { id: 'bot-1', username: 'Bot', capital: 1000000, isBot: true }
    ],
    airports: [],
    ownedAircraft: [],
    routes: [],
    flights: [],
    ...overrides
  };
}

test('initial finance sample is recorded when the simulation clock initializes', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  game.initializeSimulationClock(0);

  const history = game.financeHistoryByPlayerId.p1;
  assert.equal(Array.isArray(history), true);
  assert.equal(history.length, 1);
  assert.equal(history[0].worldElapsedSimulationMs, 0);
  assert.equal(history[0].cash, 1000000);
});

test('bots do not get finance history samples', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  game.initializeSimulationClock(0);
  game.sampleFinanceHistory(0);

  assert.equal(game.financeHistoryByPlayerId['bot-1'], undefined);
  assert.equal(Object.keys(game.financeHistoryByPlayerId).length, 1);
});

test('no duplicate sample before the cadence interval and one after 15,000,000 sim ms', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  game.initializeSimulationClock(0);
  assert.equal(game.financeHistoryByPlayerId.p1.length, 1);

  assert.equal(game.sampleFinanceHistory(SAMPLE_INTERVAL - 1), false);
  assert.equal(game.financeHistoryByPlayerId.p1.length, 1);

  assert.equal(game.sampleFinanceHistory(SAMPLE_INTERVAL), true);
  assert.equal(game.financeHistoryByPlayerId.p1.length, 2);
  assert.equal(game.financeHistoryByPlayerId.p1[1].worldElapsedSimulationMs, SAMPLE_INTERVAL);
});

test('samples record authoritative cash and net worth', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  game.initializeSimulationClock(0);
  game.authoritativeState.players[0].capital = 2500000;
  game.sampleFinanceHistory(SAMPLE_INTERVAL);

  const sample = game.financeHistoryByPlayerId.p1[1];
  assert.equal(sample.cash, 2500000);

  const expectedNetWorth = calculateNetWorthByPlayer(game.authoritativeState).get('p1');
  assert.equal(sample.netWorth, expectedNetWorth);
  assert.equal(sample.worldElapsedSimulationMs, SAMPLE_INTERVAL);
});

test('scheduler tick drives sampling without a separate timer', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  game.processFlightSchedulerTick(0);
  assert.equal(game.financeHistoryByPlayerId.p1.length, 1);

  game.processFlightSchedulerTick(1);
  assert.equal(game.financeHistoryByPlayerId.p1.length, 1);

  // simNow = realNow * 15000 → realNow 1000 = 15,000,000 sim ms
  game.processFlightSchedulerTick(1000);
  assert.equal(game.financeHistoryByPlayerId.p1.length, 2);
});

test('history is capped at 6500 samples per player', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  for (let i = 0; i <= 6505; i += 1) {
    game.sampleFinanceHistory(i * SAMPLE_INTERVAL);
  }

  const history = game.financeHistoryByPlayerId.p1;
  assert.equal(history.length, 6500);
  assert.equal(history[0].worldElapsedSimulationMs, 6 * SAMPLE_INTERVAL);
  assert.equal(history[6499].worldElapsedSimulationMs, 6505 * SAMPLE_INTERVAL);
});

test('finance history is not exposed in getPublicState', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  game.initializeSimulationClock(0);
  const publicState = game.getPublicState();

  assert.equal(publicState.game.financeHistory, undefined);
  assert.equal(JSON.stringify(publicState.game).includes('financeHistory'), false);
});

test('re-sampling the same player does not duplicate history', () => {
  const { manager } = createManagerWithEmitCapture();
  const game = new Game(createGameState(), manager);

  game.initializeSimulationClock(0);
  game.sampleFinanceHistory(0);
  game.sampleFinanceHistory(0);

  assert.equal(game.financeHistoryByPlayerId.p1.length, 1);
});

function createManagerWithGame() {
  const { manager: emitStub } = createManagerWithEmitCapture();
  const manager = new GameManager(emitStub.io);
  const game = new Game(createGameState({ id: 'game-fh-1' }), manager);
  manager.games.set('game-fh-1', game);
  return { manager, game };
}

test('finance:history request returns only the requesting player\'s samples', () => {
  const { manager, game } = createManagerWithGame();

  manager.players.set('socket-1', { id: 'p1', gameId: 'game-fh-1' });
  manager.playerGameIds.set('socket-1', 'game-fh-1');

  game.financeHistoryByPlayerId.p1 = [
    { worldElapsedSimulationMs: 0, cash: 1000000, netWorth: 1000000 },
    { worldElapsedSimulationMs: SAMPLE_INTERVAL, cash: 1100000, netWorth: 1200000 }
  ];
  game.financeHistoryByPlayerId.p2 = [
    { worldElapsedSimulationMs: 0, cash: 999, netWorth: 999 }
  ];

  const result = manager.handleFinanceHistoryRequest('socket-1');

  assert.equal(result.ok, true);
  assert.equal(result.samples.length, 2);
  assert.deepEqual(result.samples[1], {
    worldElapsedSimulationMs: SAMPLE_INTERVAL,
    cash: 1100000,
    netWorth: 1200000
  });
  assert.equal(result.samples.some((sample) => sample.cash === 999), false);
});

test('finance:history request fails safely without a player or game', () => {
  const { manager } = createManagerWithGame();

  const noPlayer = manager.handleFinanceHistoryRequest('socket-unknown');
  assert.equal(noPlayer.ok, false);
  assert.equal(typeof noPlayer.error, 'string');

  manager.players.set('socket-2', { id: 'p2', gameId: null });
  const noGame = manager.handleFinanceHistoryRequest('socket-2');
  assert.equal(noGame.ok, false);
  assert.equal(typeof noGame.error, 'string');

  manager.players.set('socket-3', { id: 'p3', gameId: 'game-missing' });
  const missingGame = manager.handleFinanceHistoryRequest('socket-3');
  assert.equal(missingGame.ok, false);
  assert.equal(typeof missingGame.error, 'string');
});

test('finance:history request returns ok with empty samples when no history exists', () => {
  const { manager } = createManagerWithGame();

  manager.players.set('socket-1', { id: 'p1', gameId: 'game-fh-1' });
  manager.playerGameIds.set('socket-1', 'game-fh-1');

  const result = manager.handleFinanceHistoryRequest('socket-1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.samples, []);
});

test('finance:history result returns copies that cannot mutate authoritative history', () => {
  const { manager, game } = createManagerWithGame();

  manager.players.set('socket-1', { id: 'p1', gameId: 'game-fh-1' });
  manager.playerGameIds.set('socket-1', 'game-fh-1');

  const original = { worldElapsedSimulationMs: 0, cash: 500, netWorth: 700 };
  game.financeHistoryByPlayerId.p1 = [original];

  const result = manager.handleFinanceHistoryRequest('socket-1');
  assert.equal(result.samples[0].cash, 500);

  result.samples[0].cash = -999;
  result.samples.push({ worldElapsedSimulationMs: 1, cash: 2, netWorth: 3 });

  assert.equal(game.financeHistoryByPlayerId.p1.length, 1);
  assert.equal(game.financeHistoryByPlayerId.p1[0].cash, 500);
  assert.notEqual(result.samples[0], original);
});

test('client listens for finance:history:result and stores samples in session state', () => {
  const clientSource = fs.readFileSync(
    path.join(__dirname, '../../client/game.js'),
    'utf8'
  );

  assert.equal(clientSource.includes("socket.on('finance:history:result'"), true);
  assert.equal(clientSource.includes('financeHistorySamples: mergeFinanceHistorySamples'), true);
  assert.equal(clientSource.includes("socket.on('finance:history:sample'"), true);
  assert.equal(clientSource.includes("socket.emit('finance:history:request'"), true);
});

const clientGameSource = fs.readFileSync(
  path.join(__dirname, '../../client/game.js'),
  'utf8'
);

function extractFunction(name, source, injectedArgs = []) {
  const prefix = `function ${name}`;
  const start = source.indexOf(prefix);
  if (start === -1) {
    throw new Error(`Function ${name} not found in client/game.js`);
  }

  const signatureStart = start + prefix.length;
  const parenStart = source.indexOf('(', signatureStart);
  let parenDepth = 0;
  let signatureEnd = -1;
  let inSignatureString = null;
  for (let i = parenStart; i < source.length; i += 1) {
    const ch = source[i];
    if (inSignatureString) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inSignatureString) {
        inSignatureString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inSignatureString = ch;
      continue;
    }
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnd = i;
        break;
      }
    }
  }
  if (signatureEnd === -1) {
    throw new Error(`Function ${name} signature not closed in client/game.js`);
  }

  const bodyStart = source.indexOf('{', signatureEnd);
  let braceDepth = 0;
  let inString = null;

  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '{') {
      braceDepth += 1;
    } else if (ch === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) {
        const functionSource = source.slice(start, i + 1);
        return new Function(...injectedArgs, `return ${functionSource}`);
      }
    }
  }

  throw new Error(`Function ${name} brace mismatch in client/game.js`);
}

function buildExtractedFinanceHelpers({ simulationClockSnapshot, selectedTimeframe = 'All' } = {}) {
  const getAuthoritativePlayerById = (state, playerId) => {
    const players = Array.isArray(state && state.game && state.game.players) ? state.game.players : [];
    return players.find((player) => player && String(player.id) === String(playerId)) || null;
  };
  const deriveSimulationNowGameMs = (snapshot, realNowMs = 0) => {
    const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
    if (Number.isFinite(s.simulationEndedAtGameMs)) {
      return s.simulationEndedAtGameMs;
    }
    if (
      Number.isFinite(s.simulationStartedAtRealMs) &&
      Number.isFinite(s.simulationStartedAtGameMs) &&
      Number.isFinite(s.simulationSpeedMultiplier) &&
      s.simulationSpeedMultiplier > 0
    ) {
      const elapsedRealMs = Math.max(0, realNowMs - s.simulationStartedAtRealMs);
      return s.simulationStartedAtGameMs + elapsedRealMs * s.simulationSpeedMultiplier;
    }
    return Number.isFinite(s.simulationNowGameMs) ? s.simulationNowGameMs : null;
  };
  const gameStateStub = { getState: () => ({ session: {} }) };

  const buildFinanceLiveSample = extractFunction(
    'buildFinanceLiveSample',
    clientGameSource,
    ['gameState', 'simulationClockSnapshot', 'getAuthoritativePlayerById', 'deriveSimulationNowGameMs']
  )(gameStateStub, simulationClockSnapshot, getAuthoritativePlayerById, deriveSimulationNowGameMs);

  const FinancesModalStateStub = { selectedTimeframe };
  const FINANCE_TIMEFRAME_WINDOWS_MS_STUB = {
    '1W': 604800000,
    '2W': 1209600000,
    '1M': 2592000000,
    '3M': 7776000000,
    '6M': 15552000000,
    '1Y': 31104000000,
    '3Y': 93312000000
  };

  const buildFinanceChartData = extractFunction(
    'buildFinanceChartData',
    clientGameSource,
    ['gameState', 'buildFinanceLiveSample', 'FinancesModalState', 'FINANCE_TIMEFRAME_WINDOWS_MS']
  )(gameStateStub, buildFinanceLiveSample, FinancesModalStateStub, FINANCE_TIMEFRAME_WINDOWS_MS_STUB);

  return { buildFinanceLiveSample, buildFinanceChartData };
}

function createClientFinanceState({ samples = [], capital = 1000000, netWorth = 1500000 } = {}) {
  return {
    session: { playerId: 'p1', financeHistorySamples: samples },
    game: {
      players: [{ id: 'p1', capital, netWorth }]
    }
  };
}

test('buildFinanceChartData appends one transient live point without mutating history samples', () => {
  const snapshot = {
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 15000,
    simulationEndedAtGameMs: null,
    simulationNowGameMs: null
  };
  const { buildFinanceChartData } = buildExtractedFinanceHelpers({ simulationClockSnapshot: snapshot });

  const samples = [
    { worldElapsedSimulationMs: 0, cash: 1000000, netWorth: 1000000 },
    { worldElapsedSimulationMs: 450000000, cash: 1100000, netWorth: 1200000 }
  ];
  const state = createClientFinanceState({ samples, capital: 1150000, netWorth: 1250000 });

  const chartData = buildFinanceChartData(state);

  assert.equal(chartData.length, 3);
  assert.equal(chartData[2].live, true);
  assert.equal(chartData[2].cash, 1150000);
  assert.equal(chartData[2].netWorth, 1250000);
  assert.equal(Number.isFinite(chartData[2].worldElapsedSimulationMs), true);

  // History array unchanged: same length, no live flag added.
  assert.equal(state.session.financeHistorySamples.length, 2);
  assert.equal(state.session.financeHistorySamples.every((s) => s.live !== true), true);
});

test('buildFinanceChartData filters history to the selected rolling simulation-time window', () => {
  const snapshot = {
    simulationStartedAtRealMs: null,
    simulationStartedAtGameMs: 0,
    simulationNowGameMs: 1000000000,
    simulationSpeedMultiplier: 1,
    simulationEndedAtGameMs: null
  };
  const { buildFinanceChartData } = buildExtractedFinanceHelpers({
    simulationClockSnapshot: snapshot,
    selectedTimeframe: '1W'
  });

  const samples = [
    { worldElapsedSimulationMs: 200000000, cash: 1000000, netWorth: 1000000 },
    { worldElapsedSimulationMs: 600000000, cash: 1100000, netWorth: 1200000 }
  ];
  const state = createClientFinanceState({ samples, capital: 1150000, netWorth: 1250000 });

  const chartData = buildFinanceChartData(state);

  assert.equal(chartData.length, 2);
  assert.equal(chartData[0].worldElapsedSimulationMs, 600000000);
  assert.equal(chartData[1].worldElapsedSimulationMs, 1000000000);
  assert.equal(chartData[1].live, true);
});

test('transient live point advances with simulation/world time, not Date.now wall time', () => {
  const snapshot = {
    simulationStartedAtRealMs: 1000,
    simulationStartedAtGameMs: 5000,
    simulationSpeedMultiplier: 15000,
    simulationEndedAtGameMs: null,
    simulationNowGameMs: null
  };
  const { buildFinanceLiveSample } = buildExtractedFinanceHelpers({ simulationClockSnapshot: snapshot });
  const state = createClientFinanceState();

  const point = buildFinanceLiveSample(state);
  // realNowMs defaults to 0 inside the injected derive stub → simNow = 5000 → elapsed 0
  assert.equal(point.worldElapsedSimulationMs, 0);
  assert.equal(point.live, true);
});

test('opening the Finances modal requests history once and no auto-request exists on state updates', () => {
  const openStart = clientGameSource.indexOf('function openFinancesModal');
  const openEnd = clientGameSource.indexOf('function closeFinancesModal');
  const openBody = clientGameSource.slice(openStart, openEnd);
  assert.equal(openBody.includes('requestFinanceHistory()'), true);

  // The result listener must not itself re-request (no request loop per game:state).
  const listenerStart = clientGameSource.indexOf("socket.on('finance:history:result'");
  const listenerEnd = clientGameSource.indexOf('function requestFinanceHistory', listenerStart);
  const listenerBody = clientGameSource.slice(listenerStart, listenerEnd);
  assert.equal(listenerBody.includes("socket.emit('finance:history:request'"), false);

  // No finance-specific interval/timer introduced.
  assert.equal(clientGameSource.includes('financeHistoryInterval'), false);
  const financeSetInterval = clientGameSource.match(/setInterval\([^)]*finance/gi);
  assert.equal(financeSetInterval, null);
});

const CHART_CONSTS = {
  SIMULATION_HOUR_MS: 3600000,
  SIMULATION_HOURS_PER_DAY: 24,
  SIMULATION_DAYS_PER_MONTH: 30,
  SIMULATION_DAYS_PER_YEAR: 360,
  FINANCE_CHART_MONTH_ABBREVIATIONS: [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ],
  FINANCE_CHART_WIDTH: 308,
  FINANCE_CHART_HEIGHT: 140,
  FINANCE_CHART_PAD_LEFT: 44,
  FINANCE_CHART_PAD_RIGHT: 8,
  FINANCE_CHART_PAD_TOP: 8,
  FINANCE_CHART_PAD_BOTTOM: 20
};

function buildExtractedChartHelpers() {
  const formatCompactCurrencyValue = extractFunction('formatCompactCurrencyValue', clientGameSource)();

  const formatFinanceAxisLabel = extractFunction('formatFinanceAxisLabel', clientGameSource, [
    'SIMULATION_HOUR_MS',
    'SIMULATION_HOURS_PER_DAY',
    'SIMULATION_DAYS_PER_MONTH',
    'SIMULATION_DAYS_PER_YEAR',
    'FINANCE_CHART_MONTH_ABBREVIATIONS'
  ])(
    CHART_CONSTS.SIMULATION_HOUR_MS,
    CHART_CONSTS.SIMULATION_HOURS_PER_DAY,
    CHART_CONSTS.SIMULATION_DAYS_PER_MONTH,
    CHART_CONSTS.SIMULATION_DAYS_PER_YEAR,
    CHART_CONSTS.FINANCE_CHART_MONTH_ABBREVIATIONS
  );

  const buildFinanceChartGeometry = extractFunction('buildFinanceChartGeometry', clientGameSource, [
    'FINANCE_CHART_WIDTH',
    'FINANCE_CHART_HEIGHT',
    'FINANCE_CHART_PAD_LEFT',
    'FINANCE_CHART_PAD_RIGHT',
    'FINANCE_CHART_PAD_TOP',
    'FINANCE_CHART_PAD_BOTTOM',
    'formatFinanceAxisLabel',
    'formatCompactCurrencyValue'
  ])(
    CHART_CONSTS.FINANCE_CHART_WIDTH,
    CHART_CONSTS.FINANCE_CHART_HEIGHT,
    CHART_CONSTS.FINANCE_CHART_PAD_LEFT,
    CHART_CONSTS.FINANCE_CHART_PAD_RIGHT,
    CHART_CONSTS.FINANCE_CHART_PAD_TOP,
    CHART_CONSTS.FINANCE_CHART_PAD_BOTTOM,
    formatFinanceAxisLabel,
    formatCompactCurrencyValue
  );

  return { formatCompactCurrencyValue, formatFinanceAxisLabel, buildFinanceChartGeometry };
}

test('formatCompactCurrencyValue produces compact k/M/B labels', () => {
  const { formatCompactCurrencyValue } = buildExtractedChartHelpers();

  assert.equal(formatCompactCurrencyValue(500000), '$500k');
  assert.equal(formatCompactCurrencyValue(1200000), '$1.2M');
  assert.equal(formatCompactCurrencyValue(25000000), '$25M');
  assert.equal(formatCompactCurrencyValue(1100000000), '$1.1B');
  assert.equal(formatCompactCurrencyValue(950), '$950');
  assert.equal(formatCompactCurrencyValue(-2000000), '-$2M');
  assert.equal(formatCompactCurrencyValue(NaN), '$0');
});

test('x-axis labels use HH:mm for sub-day spans and Mon DD for longer spans', () => {
  const { formatFinanceAxisLabel } = buildExtractedChartHelpers();
  const dayMs = 24 * 3600000;

  assert.equal(formatFinanceAxisLabel(0, dayMs - 1), '00:00');
  assert.equal(formatFinanceAxisLabel((14 * 3600000) + (30 * 60000), dayMs - 1), '14:30');

  assert.equal(formatFinanceAxisLabel(0, dayMs), 'Jan 01');
  assert.equal(formatFinanceAxisLabel(30 * dayMs, 40 * dayMs), 'Feb 01');
  assert.equal(formatFinanceAxisLabel(360 * dayMs, 400 * dayMs), 'Jan 01');

  assert.equal(formatFinanceAxisLabel(null, dayMs), '--');
});

function parsePathCoordinates(pathData) {
  return (pathData.match(/-?\d+\.?\d*/g) || []).map(Number);
}

test('chart geometry maps multiple samples to finite coordinates with 4 ticks each axis', () => {
  const { buildFinanceChartGeometry } = buildExtractedChartHelpers();

  const data = [
    { worldElapsedSimulationMs: 0, cash: 1000000, netWorth: 1000000 },
    { worldElapsedSimulationMs: 450000000, cash: 1100000, netWorth: 1200000 },
    { worldElapsedSimulationMs: 900000000, cash: 900000, netWorth: 1400000 }
  ];

  const geometry = buildFinanceChartGeometry(data, { showCash: true, showNetWorth: true });

  assert.equal(geometry.isEmpty, false);
  assert.equal(geometry.xTicks.length, 4);
  assert.equal(geometry.yTicks.length, 4);
  assert.ok(geometry.cashPath.startsWith('M'));
  assert.ok(geometry.netWorthPath.startsWith('M'));
  for (const coord of parsePathCoordinates(geometry.cashPath + ' ' + geometry.netWorthPath)) {
    assert.equal(Number.isFinite(coord), true);
  }
  // First point at left edge of plot area, last at right edge.
  assert.ok(geometry.xTicks[0].x === 44);
  assert.ok(Math.abs(geometry.xTicks[3].x - (308 - 8)) < 0.01);
});

test('chart geometry handles one point and flat domains without NaN', () => {
  const { buildFinanceChartGeometry } = buildExtractedChartHelpers();

  const single = buildFinanceChartGeometry(
    [{ worldElapsedSimulationMs: 0, cash: 1000000, netWorth: 1000000 }],
    { showCash: true, showNetWorth: true }
  );

  assert.equal(single.isEmpty, false);
  for (const coord of parsePathCoordinates(single.cashPath + ' ' + single.netWorthPath)) {
    assert.equal(Number.isFinite(coord), true);
  }
  for (const tick of [...single.xTicks, ...single.yTicks]) {
    assert.equal(Number.isFinite(tick.x ?? tick.y), true);
    assert.notEqual(tick.label, 'NaN');
    assert.notEqual(tick.label, '$NaN');
  }

  const flat = buildFinanceChartGeometry(
    [
      { worldElapsedSimulationMs: 0, cash: 500, netWorth: 500 },
      { worldElapsedSimulationMs: 100, cash: 500, netWorth: 500 }
    ],
    { showCash: true, showNetWorth: true }
  );
  for (const coord of parsePathCoordinates(flat.cashPath)) {
    assert.equal(Number.isFinite(coord), true);
  }
});

test('chart geometry respects independent series toggles including both off', () => {
  const { buildFinanceChartGeometry } = buildExtractedChartHelpers();
  const data = [
    { worldElapsedSimulationMs: 0, cash: 1000000, netWorth: 2000000 },
    { worldElapsedSimulationMs: 100, cash: 1100000, netWorth: 2100000 }
  ];

  const cashOnly = buildFinanceChartGeometry(data, { showCash: true, showNetWorth: false });
  assert.ok(cashOnly.cashPath.length > 0);
  assert.equal(cashOnly.netWorthPath, '');

  const netWorthOnly = buildFinanceChartGeometry(data, { showCash: false, showNetWorth: true });
  assert.equal(netWorthOnly.cashPath, '');
  assert.ok(netWorthOnly.netWorthPath.length > 0);

  const bothOff = buildFinanceChartGeometry(data, { showCash: false, showNetWorth: false });
  assert.equal(bothOff.cashPath, '');
  assert.equal(bothOff.netWorthPath, '');
  assert.equal(bothOff.xTicks.length, 4);
  assert.equal(bothOff.yTicks.length, 4);
});

test('finance:history request returns the complete history (All view) in chronological order', () => {
  const { manager, game } = createManagerWithGame();

  manager.players.set('socket-1', { id: 'p1', gameId: 'game-fh-1' });
  manager.playerGameIds.set('socket-1', 'game-fh-1');

  const total = 2500;
  game.financeHistoryByPlayerId.p1 = Array.from({ length: total }, (_, i) => ({
    worldElapsedSimulationMs: i * SAMPLE_INTERVAL,
    cash: 1000 + i,
    netWorth: 2000 + i
  }));

  const result = manager.handleFinanceHistoryRequest('socket-1');

  assert.equal(result.ok, true);
  assert.equal(result.samples.length, total);
  for (let i = 1; i < result.samples.length; i += 1) {
    assert.ok(
      result.samples[i].worldElapsedSimulationMs > result.samples[i - 1].worldElapsedSimulationMs,
      `sample ${i} out of order`
    );
  }
  assert.equal(result.samples[0].worldElapsedSimulationMs, 0);
  assert.equal(result.samples[total - 1].worldElapsedSimulationMs, (total - 1) * SAMPLE_INTERVAL);
});

test('chart geometry plots all points chronologically (x is non-decreasing along the path)', () => {
  const { buildFinanceChartGeometry } = buildExtractedChartHelpers();

  const data = Array.from({ length: 60 }, (_, i) => ({
    worldElapsedSimulationMs: i * SAMPLE_INTERVAL,
    cash: 1000000 + i * 1000,
    netWorth: 1000000 + i * 2000
  }));

  const geometry = buildFinanceChartGeometry(data, { showCash: true, showNetWorth: true });
  assert.equal(geometry.points.length, 60);

  const xCoords = parsePathCoordinates(geometry.cashPath).filter((_, i) => i % 2 === 0);
  assert.equal(xCoords.length, 60);
  for (let i = 1; i < xCoords.length; i += 1) {
    assert.ok(xCoords[i] >= xCoords[i - 1], `x coord ${i} went backwards`);
  }
  assert.equal(xCoords[0], 44);
  assert.ok(Math.abs(xCoords[xCoords.length - 1] - 300) < 0.01);
});

test('new finance samples are pushed to the owning player socket after being stored', () => {
  const emitted = [];
  const manager = {
    io: {
      to(roomName) {
        const room = {
          emit(eventName, payload) {
            emitted.push({ roomName, eventName, payload });
          }
        };
        room.volatile = room;
        return room;
      }
    },
    players: new Map(),
    emitFinanceSampleToPlayer(playerId, sample) {
      this.lastPush = { playerId, sample };
      return true;
    }
  };
  manager.lastPush = null;

  const game = new Game(createGameState(), manager);
  game.sampleFinanceHistory(0);

  assert.equal(manager.lastPush.playerId, 'p1');
  assert.deepEqual(manager.lastPush.sample, game.financeHistoryByPlayerId.p1[0]);
  assert.notEqual(manager.lastPush.sample, game.financeHistoryByPlayerId.p1[0]);
});

test('finance sample push is not emitted for bots or disconnected players', () => {
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
  const manager = new GameManager(io);

  manager.players.set('bot-1', { id: 'bot-1', isBot: true, connected: true });
  manager.players.set('p1', { id: 'p1', connected: true });
  manager.players.set('p2', { id: 'p2', connected: false });

  assert.equal(manager.emitFinanceSampleToPlayer('bot-1', { worldElapsedSimulationMs: 0, cash: 1, netWorth: 1 }), false);
  assert.equal(manager.emitFinanceSampleToPlayer('p2', { worldElapsedSimulationMs: 0, cash: 1, netWorth: 1 }), false);
  assert.equal(manager.emitFinanceSampleToPlayer('p1', { worldElapsedSimulationMs: 0, cash: 100, netWorth: 200 }), true);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].roomName, 'p1');
  assert.equal(emitted[0].eventName, 'finance:history:sample');
  assert.deepEqual(emitted[0].payload, { worldElapsedSimulationMs: 0, cash: 100, netWorth: 200 });
});

function buildExtractedClientHistoryHelpers() {
  const injected = ['FINANCE_HISTORY_CLIENT_MAX_SAMPLES'];
  const values = [6500];

  const normalizeFinanceHistorySample = extractFunction(
    'normalizeFinanceHistorySample',
    clientGameSource,
    injected
  )(...values);

  const mergeFinanceHistorySamples = extractFunction(
    'mergeFinanceHistorySamples',
    clientGameSource,
    ['FINANCE_HISTORY_CLIENT_MAX_SAMPLES', 'normalizeFinanceHistorySample']
  )(6500, normalizeFinanceHistorySample);

  return { normalizeFinanceHistorySample, mergeFinanceHistorySamples };
}

test('client merge appends pushed samples, dedupes by elapsed, and caps at 6500', () => {
  const { mergeFinanceHistorySamples } = buildExtractedClientHistoryHelpers();

  const existing = [
    { worldElapsedSimulationMs: 0, cash: 1000, netWorth: 1000 },
    { worldElapsedSimulationMs: 15000000, cash: 1100, netWorth: 1100 }
  ];

  const appended = mergeFinanceHistorySamples(existing, [
    { worldElapsedSimulationMs: 30000000, cash: 1200, netWorth: 1200 }
  ]);
  assert.equal(appended.length, 3);
  assert.equal(appended[2].worldElapsedSimulationMs, 30000000);
  assert.equal(existing.length, 2);

  const deduped = mergeFinanceHistorySamples(appended, [
    { worldElapsedSimulationMs: 30000000, cash: 9999, netWorth: 9999 }
  ]);
  assert.equal(deduped.length, 3);

  const huge = Array.from({ length: 6505 }, (_, i) => ({
    worldElapsedSimulationMs: i,
    cash: i,
    netWorth: i
  }));
  const capped = mergeFinanceHistorySamples(huge, [{ worldElapsedSimulationMs: 99999, cash: 1, netWorth: 1 }]);
  assert.equal(capped.length, 6500);
  assert.equal(capped[6499].worldElapsedSimulationMs, 99999);
});

test('request result and pushed samples merge without duplicates (overlap safe)', () => {
  const { mergeFinanceHistorySamples } = buildExtractedClientHistoryHelpers();

  // Pushed sample arrived while the full-history request was in flight.
  const pushedFirst = [
    { worldElapsedSimulationMs: 45000000, cash: 1500, netWorth: 1600 }
  ];
  const requestResult = [
    { worldElapsedSimulationMs: 0, cash: 1000, netWorth: 1000 },
    { worldElapsedSimulationMs: 15000000, cash: 1100, netWorth: 1100 },
    { worldElapsedSimulationMs: 30000000, cash: 1200, netWorth: 1200 },
    { worldElapsedSimulationMs: 45000000, cash: 1500, netWorth: 1600 }
  ];

  const merged = mergeFinanceHistorySamples(pushedFirst, requestResult);
  assert.equal(merged.length, 4);
  assert.equal(
    merged.filter((s) => s.worldElapsedSimulationMs === 45000000).length,
    1
  );
  assert.deepEqual(
    merged.map((s) => s.worldElapsedSimulationMs),
    [0, 15000000, 30000000, 45000000]
  );

  // Out-of-order arrival gets sorted chronologically.
  const reordered = mergeFinanceHistorySamples(
    [{ worldElapsedSimulationMs: 30000000, cash: 1, netWorth: 1 }],
    [{ worldElapsedSimulationMs: 15000000, cash: 2, netWorth: 2 }]
  );
  assert.deepEqual(
    reordered.map((s) => s.worldElapsedSimulationMs),
    [15000000, 30000000]
  );
});

test('client ignores malformed pushed samples', () => {
  const { normalizeFinanceHistorySample, mergeFinanceHistorySamples } = buildExtractedClientHistoryHelpers();

  assert.equal(normalizeFinanceHistorySample(null), null);
  assert.equal(normalizeFinanceHistorySample({ cash: 1 }), null);
  assert.equal(normalizeFinanceHistorySample({ worldElapsedSimulationMs: NaN }), null);

  const merged = mergeFinanceHistorySamples(
    [{ worldElapsedSimulationMs: 0, cash: 1, netWorth: 1 }],
    [{ worldElapsedSimulationMs: null, cash: 5, netWorth: 5 }, 'junk', null]
  );
  assert.equal(merged.length, 1);
});

test('chart geometry handles empty data gracefully', () => {
  const { buildFinanceChartGeometry } = buildExtractedChartHelpers();

  const empty = buildFinanceChartGeometry([], { showCash: true, showNetWorth: true });
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.cashPath, '');
  assert.equal(empty.netWorthPath, '');

  const allInvalid = buildFinanceChartGeometry(
    [{ worldElapsedSimulationMs: null, cash: 1, netWorth: 1 }],
    { showCash: true, showNetWorth: true }
  );
  assert.equal(allInvalid.isEmpty, true);
});

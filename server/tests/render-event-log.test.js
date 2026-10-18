const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const clientSource = fs.readFileSync(
  path.join(__dirname, '../../client/game.js'),
  'utf8'
);

function extractFunction(name, source) {
  const prefix = `function ${name}`;
  const start = source.indexOf(prefix);
  if (start === -1) {
    throw new Error(`Function ${name} not found in client/game.js`);
  }

  const signatureStart = start + prefix.length;
  const bodyStart = source.indexOf('{', signatureStart);
  if (bodyStart === -1) {
    throw new Error(`Function ${name} body not found in client/game.js`);
  }

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
        return new Function(`return ${functionSource}`)();
      }
    }
  }

  throw new Error(`Function ${name} brace mismatch in client/game.js`);
}

const normalizeIncomingGameEvent = extractFunction('normalizeIncomingGameEvent', clientSource);

function createClassList() {
  return {
    values: new Set(),
    add(name) {
      this.values.add(name);
    },
    remove(name) {
      this.values.delete(name);
    },
    toggle(name, enabled) {
      if (enabled) {
        this.values.add(name);
      } else {
        this.values.delete(name);
      }
    }
  };
}

function createMockElement() {
  return {
    textContent: '',
    className: '',
    disabled: false,
    innerHTML: '',
    children: [],
    classList: createClassList(),
    setAttribute() {},
    addEventListener() {},
    appendChild(node) {
      if (node && node.__isFragment && Array.isArray(node.children)) {
        this.children.push(...node.children);
      } else if (node) {
        this.children.push(node);
      }
    }
  };
}

function createMockDocument() {
  const elements = new Map();

  return {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createMockElement());
      }
      return elements.get(id);
    },
    querySelector(selector) {
      if (selector === '.main-content') {
        return this.getElementById('mainContent');
      }
      return null;
    },
    createDocumentFragment() {
      return {
        __isFragment: true,
        children: [],
        appendChild(node) {
          this.children.push(node);
        }
      };
    },
    createElement() {
      return createMockElement();
    }
  };
}

function createRendererUnderTest() {
  const renderModulePath = require.resolve('../../client/render.js');
  delete require.cache[renderModulePath];

  global.window = {
    createMapRenderer() {
      return {
        render() {}
      };
    }
  };

  require('../../client/render.js');

  const documentRef = createMockDocument();
  const renderer = global.window.createRenderer(documentRef);

  return { renderer, documentRef };
}

function collectNodesByClassName(node, className, matches = []) {
  if (!node) {
    return matches;
  }

  if (node.className === className) {
    matches.push(node);
  }

  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    collectNodesByClassName(child, className, matches);
  }

  return matches;
}

function renderEventLogTimestamps(gameEvents, worldCalendarStartYear) {
  const { renderer, documentRef } = createRendererUnderTest();

  renderer.render({
    connection: { status: 'connected' },
    session: { joinPending: false, joined: true, gameEvents },
    lobby: { playerCount: 1, maxPlayers: 5, players: [], status: 'waiting', countdownSeconds: null },
    ui: { errorMessage: null, screen: 'game' },
    game: {
      id: 'game-1',
      status: 'active',
      createdAt: 123,
      players: [],
      airports: [],
      simulationClock: { worldCalendarStartYear }
    },
    waitingAnimation: { step: 0 }
  });

  const gameScreen = documentRef.getElementById('gameScreen');
  return collectNodesByClassName(gameScreen, 'event-log-time').map((node) => node.textContent);
}

const WORLD_MINUTE_MS = 60 * 1000;
const WORLD_HOUR_MS = 60 * WORLD_MINUTE_MS;
const WORLD_DAY_MS = 24 * WORLD_HOUR_MS;

test('event log world timestamp renders game start as startYear Jan 01 · 00:00', () => {
  const timestamps = renderEventLogTimestamps(
    [{ type: 'asset:transaction', occurredAt: 123, worldElapsedSimulationMs: 0, data: { action: 'purchased-from-game' } }],
    2026
  );

  assert.deepEqual(timestamps, ['Jan 01/26 · 00:00']);
  delete global.window;
});

test('event log world timestamp rolls over month and year boundaries', () => {
  const timestamps = renderEventLogTimestamps(
    [
      { type: 'x', occurredAt: 1, worldElapsedSimulationMs: 30 * WORLD_DAY_MS, data: { message: 'a' } },
      { type: 'x', occurredAt: 2, worldElapsedSimulationMs: 360 * WORLD_DAY_MS, data: { message: 'b' } }
    ],
    2026
  );

  assert.deepEqual(timestamps, ['Feb 01/26 · 00:00', 'Jan 01/27 · 00:00']);
  delete global.window;
});

test('event log world timestamp renders hour and minute of day', () => {
  const elapsed = (14 * WORLD_HOUR_MS) + (30 * WORLD_MINUTE_MS);
  const timestamps = renderEventLogTimestamps(
    [{ type: 'x', occurredAt: 1, worldElapsedSimulationMs: elapsed, data: { message: 'a' } }],
    2026
  );

  assert.deepEqual(timestamps, ['Jan 01/26 · 14:30']);
  delete global.window;
});

test('event log falls back to occurredAt real time when world timestamp is unavailable', () => {
  const occurredAt = new Date('2026-03-04T05:06:07.000Z').getTime();
  const timestamps = renderEventLogTimestamps(
    [
      { type: 'x', occurredAt, data: { message: 'a' } },
      { type: 'x', occurredAt, worldElapsedSimulationMs: 1000, data: { message: 'b' } }
    ],
    null
  );

  assert.equal(timestamps.length, 2);
  assert.match(timestamps[0], /^\d{2}:\d{2}:\d{2}(\s[AP]M)?$/);
  assert.match(timestamps[1], /^\d{2}:\d{2}:\d{2}(\s[AP]M)?$/);
  delete global.window;
});

test('normalizeIncomingGameEvent preserves finite worldElapsedSimulationMs and drops invalid values', () => {
  const withWorld = normalizeIncomingGameEvent({
    type: 'asset:transaction',
    occurredAt: 123,
    worldElapsedSimulationMs: 4567,
    data: {}
  });
  assert.equal(withWorld.worldElapsedSimulationMs, 4567);

  const missing = normalizeIncomingGameEvent({ type: 'x', occurredAt: 123 });
  assert.equal(missing.worldElapsedSimulationMs, null);

  const invalid = normalizeIncomingGameEvent({ type: 'x', occurredAt: 123, worldElapsedSimulationMs: 'soon' });
  assert.equal(invalid.worldElapsedSimulationMs, null);

  const nan = normalizeIncomingGameEvent({ type: 'x', occurredAt: 123, worldElapsedSimulationMs: NaN });
  assert.equal(nan.worldElapsedSimulationMs, null);
});

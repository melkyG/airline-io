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

const normalizeSimulationClockSnapshot = extractFunction(
  'normalizeSimulationClockSnapshot',
  clientSource
);
const getEmptySimulationClockSnapshot = extractFunction(
  'getEmptySimulationClockSnapshot',
  clientSource
);

test('client normalizeSimulationClockSnapshot preserves worldCalendarStartYear', () => {
  const source = {
    simulationStartedAtRealMs: 1000,
    simulationStartedAtGameMs: 2000,
    simulationSpeedMultiplier: 15000,
    simulationEndedAtGameMs: null,
    simulationNowGameMs: 3000,
    worldCalendarStartYear: 2026
  };

  const normalized = normalizeSimulationClockSnapshot(source);

  assert.equal(normalized.worldCalendarStartYear, 2026);
});

test('client normalizeSimulationClockSnapshot safely drops invalid worldCalendarStartYear', () => {
  const source = {
    simulationStartedAtRealMs: null,
    simulationStartedAtGameMs: null,
    simulationSpeedMultiplier: null,
    simulationEndedAtGameMs: null,
    simulationNowGameMs: null,
    worldCalendarStartYear: 'invalid'
  };

  const normalized = normalizeSimulationClockSnapshot(source);

  assert.equal(normalized.worldCalendarStartYear, null);
});

test('client getEmptySimulationClockSnapshot initializes worldCalendarStartYear to null', () => {
  const snapshot = getEmptySimulationClockSnapshot();

  assert.equal(snapshot.worldCalendarStartYear, null);
});

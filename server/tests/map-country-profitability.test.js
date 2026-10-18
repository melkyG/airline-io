const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
global.window = global;
require('../../client/map.js');

const {
  getCountryProfitFactorFromState,
  getCountryProfitabilityColor,
  getCountryProfitabilityOpacity,
  getCountryProfitabilityPaint,
  buildCountryProfitabilityPaint
} = global.__airlineCountryProfitability;

function buildState(factors) {
  return { game: { world: { countryProfitFactors: factors } } };
}

test('getCountryProfitFactorFromState returns the server-provided country factor', () => {
  assert.strictEqual(getCountryProfitFactorFromState(buildState({ Testland: 1.15 }), 'Testland'), 1.15);
});

test('getCountryProfitFactorFromState defaults to neutral for missing or invalid values', () => {
  assert.strictEqual(getCountryProfitFactorFromState(buildState({}), 'Testland'), 1.00);
  assert.strictEqual(getCountryProfitFactorFromState(buildState({ Testland: 'bad' }), 'Testland'), 1.00);
  assert.strictEqual(getCountryProfitFactorFromState({}, 'Testland'), 1.00);
  assert.strictEqual(getCountryProfitFactorFromState(null, 'Testland'), 1.00);
  assert.strictEqual(getCountryProfitFactorFromState(buildState({ Testland: 1.15 }), ''), 1.00);
  assert.strictEqual(getCountryProfitFactorFromState(buildState({ Testland: 1.15 }), null), 1.00);
});

const MAX_OPACITY = 0.5;
const greenExpected = (factor) => {
  const intensity = Math.min((factor - 1.0) / 1.5, 1);
  return Math.pow(intensity, 1.5) * MAX_OPACITY;
};
const redExpected = (factor) => {
  const intensity = Math.min((1.0 - factor) / 0.7, 1);
  return Math.pow(intensity, 1.5) * MAX_OPACITY;
};

test('green-side representative factors follow exponent-1.5 opacity scaling', () => {
  const cases = [
    [1.00, 0],
    [1.20, greenExpected(1.20)],   // intensity 0.133 → 0.0089
    [1.40, greenExpected(1.40)],   // intensity 0.267 → 0.0356
    [1.60, greenExpected(1.60)],   // intensity 0.400 → 0.08
    [2.00, greenExpected(2.00)],   // intensity 0.667 → 0.2222
    [2.50, MAX_OPACITY]
  ];
  for (const [factor, expected] of cases) {
    const paint = getCountryProfitabilityPaint(factor);
    if (factor === 1.00) {
      assert.strictEqual(paint['fill-color'], 'rgba(0, 0, 0, 0)');
    } else {
      assert.strictEqual(paint['fill-color'], 'rgb(0, 255, 0)');
    }
    assert.ok(Math.abs(paint['fill-opacity'] - expected) < 1e-9,
      `factor ${factor}: expected ${expected}, got ${paint['fill-opacity']}`);
  }
});

test('red-side representative factors follow exponent-1.5 opacity scaling', () => {
  const cases = [
    [0.90, redExpected(0.90)],   // intensity 0.143 → 0.0102
    [0.80, redExpected(0.80)],   // intensity 0.286 → 0.0408
    [0.70, redExpected(0.70)],   // intensity 0.429 → 0.0918
    [0.55, redExpected(0.55)],   // intensity 0.643 → 0.2066
    [0.30, MAX_OPACITY]
  ];
  for (const [factor, expected] of cases) {
    const paint = getCountryProfitabilityPaint(factor);
    assert.strictEqual(paint['fill-color'], 'rgb(255, 0, 0)');
    assert.ok(Math.abs(paint['fill-opacity'] - expected) < 1e-9,
      `factor ${factor}: expected ${expected}, got ${paint['fill-opacity']}`);
  }
});

test('stacked factor 2.40 renders substantially stronger than a Travel Boom 1.50', () => {
  const stacked = getCountryProfitabilityOpacity(2.40);
  const boom = getCountryProfitabilityOpacity(1.50);
  assert.ok(stacked > boom * 4, `stacked ${stacked} should be >4x boom ${boom}`);
  assert.ok(Math.abs(stacked - greenExpected(2.40)) < 1e-9);
  assert.ok(Math.abs(boom - greenExpected(1.50)) < 1e-9);
});

test('1.00 -> transparent', () => {
  const paint = getCountryProfitabilityPaint(1.00);
  assert.strictEqual(paint['fill-color'], 'rgba(0, 0, 0, 0)');
  assert.strictEqual(paint['fill-opacity'], 0);
});

test('invalid/missing factor -> neutral transparent', () => {
  assert.strictEqual(getCountryProfitabilityColor(NaN), 'rgba(0, 0, 0, 0)');
  assert.strictEqual(getCountryProfitabilityOpacity(undefined), 0);
  const paint = getCountryProfitabilityPaint('invalid');
  assert.strictEqual(paint['fill-color'], 'rgba(0, 0, 0, 0)');
  assert.strictEqual(paint['fill-opacity'], 0);
});

test('extreme factors are clamped to max opacity', () => {
  const veryLow = getCountryProfitabilityPaint(0.10);
  assert.strictEqual(veryLow['fill-color'], 'rgb(255, 0, 0)');
  assert.ok(Math.abs(veryLow['fill-opacity'] - MAX_OPACITY) < 1e-9);

  const atRedMax = getCountryProfitabilityPaint(0.30);
  assert.ok(Math.abs(atRedMax['fill-opacity'] - MAX_OPACITY) < 1e-9);

  const veryHigh = getCountryProfitabilityPaint(3.00);
  assert.strictEqual(veryHigh['fill-color'], 'rgb(0, 255, 0)');
  assert.ok(Math.abs(veryHigh['fill-opacity'] - MAX_OPACITY) < 1e-9);

  const atGreenMax = getCountryProfitabilityPaint(2.50);
  assert.ok(Math.abs(atGreenMax['fill-opacity'] - MAX_OPACITY) < 1e-9);
});

test('empty factor map -> all transparent', () => {
  const paint = buildCountryProfitabilityPaint(buildState({}));
  assert.strictEqual(paint['fill-color'], 'rgba(0, 0, 0, 0)');
  assert.strictEqual(paint['fill-opacity'], 0);
});

test('Canada 0.80 -> Canada red', () => {
  const paint = buildCountryProfitabilityPaint(buildState({ Canada: 0.80 }));
  assert.deepStrictEqual(paint['fill-color'], ['match', ['get', 'ADMIN'], 'Canada', 'rgb(255, 0, 0)', 'rgba(0, 0, 0, 0)']);
  assert.deepStrictEqual(paint['fill-opacity'], ['match', ['get', 'ADMIN'], 'Canada', getCountryProfitabilityOpacity(0.80), 0]);
});

test('Spain 1.20 -> Spain green', () => {
  const paint = buildCountryProfitabilityPaint(buildState({ Spain: 1.20 }));
  assert.deepStrictEqual(paint['fill-color'], ['match', ['get', 'ADMIN'], 'Spain', 'rgb(0, 255, 0)', 'rgba(0, 0, 0, 0)']);
  assert.deepStrictEqual(paint['fill-opacity'], ['match', ['get', 'ADMIN'], 'Spain', getCountryProfitabilityOpacity(1.20), 0]);
});

test('Canada + Spain together -> both can be colored', () => {
  const paint = buildCountryProfitabilityPaint(buildState({ Canada: 0.80, Spain: 1.20 }));
  assert.deepStrictEqual(paint['fill-color'], ['match', ['get', 'ADMIN'], 'Canada', 'rgb(255, 0, 0)', 'Spain', 'rgb(0, 255, 0)', 'rgba(0, 0, 0, 0)']);
  assert.deepStrictEqual(paint['fill-opacity'], ['match', ['get', 'ADMIN'], 'Canada', getCountryProfitabilityOpacity(0.80), 'Spain', getCountryProfitabilityOpacity(1.20), 0]);
});

test('missing country -> neutral default', () => {
  const paint = buildCountryProfitabilityPaint(buildState({ Canada: 0.80 }));
  const colorDefault = paint['fill-color'][paint['fill-color'].length - 1];
  const opacityDefault = paint['fill-opacity'][paint['fill-opacity'].length - 1];
  assert.strictEqual(colorDefault, 'rgba(0, 0, 0, 0)');
  assert.strictEqual(opacityDefault, 0);
});

test('invalid factor -> neutral', () => {
  const paint = buildCountryProfitabilityPaint(buildState({ Canada: 'bad' }));
  assert.strictEqual(paint['fill-color'], 'rgba(0, 0, 0, 0)');
  assert.strictEqual(paint['fill-opacity'], 0);
});

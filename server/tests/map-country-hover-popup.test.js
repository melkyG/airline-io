const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
global.window = global;
require('../../client/map.js');

const {
  COUNTRY_HOVER_POPUP_DWELL_MS,
  createCountryHoverPopupScheduler,
  formatCountryProfitabilityMultiplier,
  getCountryPopupMultiplierText
} = global.__airlineCountryHoverPopup;

const { getCountryProfitFactorFromState } = global.__airlineCountryProfitability;

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const calls = { set: [], clear: [] };

  return {
    calls,
    setTimeoutFn(fn, ms) {
      const id = nextId++;
      pending.set(id, fn);
      calls.set.push(ms);
      return id;
    },
    clearTimeoutFn(id) {
      calls.clear.push(id);
      pending.delete(id);
    },
    fireAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((fn) => fn());
    },
    pendingCount() {
      return pending.size;
    }
  };
}

function createScheduler(fakeTimers, events) {
  return createCountryHoverPopupScheduler({
    onShow: (key) => events.push(['show', key]),
    onHide: () => events.push(['hide']),
    setTimeoutFn: fakeTimers.setTimeoutFn,
    clearTimeoutFn: fakeTimers.clearTimeoutFn
  });
}

test('popup shows only after the 500ms dwell', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');

  assert.strictEqual(COUNTRY_HOVER_POPUP_DWELL_MS, 500);
  assert.deepStrictEqual(timers.calls.set, [500]);
  assert.deepStrictEqual(events, [['hide']]);
  assert.strictEqual(scheduler.isPending(), true);

  timers.fireAll();

  assert.deepStrictEqual(events, [['hide'], ['show', 'France']]);
  assert.strictEqual(scheduler.isPending(), false);
});

test('repeated mousemove over the same country does not restart the timer', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');
  scheduler.schedule('France');
  scheduler.schedule('France');

  assert.strictEqual(timers.calls.set.length, 1);
  assert.strictEqual(timers.calls.clear.length, 0);
  assert.deepStrictEqual(events, [['hide']]);

  timers.fireAll();
  assert.deepStrictEqual(events, [['hide'], ['show', 'France']]);
});

test('switching countries cancels the old timer and starts a new one', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');
  scheduler.schedule('Germany');

  assert.strictEqual(timers.calls.set.length, 2);
  assert.strictEqual(timers.calls.clear.length, 1);
  assert.strictEqual(timers.pendingCount(), 1);
  assert.deepStrictEqual(events, [['hide'], ['hide']]);

  timers.fireAll();

  // Only the Germany timer was pending; the cancelled France timer can never fire.
  assert.deepStrictEqual(events, [['hide'], ['hide'], ['show', 'Germany']]);
});

test('leaving countries cancels the timer and hides the popup', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');
  scheduler.clear();

  assert.strictEqual(timers.calls.clear.length, 1);
  assert.strictEqual(timers.pendingCount(), 0);
  assert.strictEqual(scheduler.isPending(), false);
  assert.deepStrictEqual(events, [['hide'], ['hide']]);

  // Nothing fires afterwards — the popup can never appear after mouseleave.
  timers.fireAll();
  assert.deepStrictEqual(events, [['hide'], ['hide']]);
});

test('clear after the popup is already visible hides it', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');
  timers.fireAll();
  scheduler.clear();

  assert.deepStrictEqual(events, [['hide'], ['show', 'France'], ['hide']]);
});

test('missing multiplier defaults to 1.00x', () => {
  assert.strictEqual(formatCountryProfitabilityMultiplier(undefined), '1.00×');
  assert.strictEqual(formatCountryProfitabilityMultiplier(null), '1.00×');
  assert.strictEqual(formatCountryProfitabilityMultiplier('bad'), '1.00×');
  assert.strictEqual(formatCountryProfitabilityMultiplier(NaN), '1.00×');

  // End-to-end: a country absent from the factor map resolves to neutral 1.00.
  const state = { game: { world: { countryProfitFactors: { Spain: 1.2 } } } };
  const factor = getCountryProfitFactorFromState(state, 'Atlantis');
  assert.strictEqual(formatCountryProfitabilityMultiplier(factor), '1.00×');
});

test('existing multiplier formats to two decimals', () => {
  assert.strictEqual(formatCountryProfitabilityMultiplier(1.15), '1.15×');
  assert.strictEqual(formatCountryProfitabilityMultiplier(1), '1.00×');
  assert.strictEqual(formatCountryProfitabilityMultiplier(2), '2.00×');
  assert.strictEqual(formatCountryProfitabilityMultiplier(0.8), '0.80×');
});

test('visible popup multiplier text follows snapshot updates without a new dwell cycle', () => {
  const timers = createFakeTimers();
  const events = [];
  const snapshot = { game: { world: { countryProfitFactors: { Canada: 1.12 } } } };
  let popupText = null;

  // Same show path as showCountryTooltip: capture text at dwell-fire time.
  const scheduler = createCountryHoverPopupScheduler({
    onShow: (key) => {
      events.push(['show', key]);
      popupText = getCountryPopupMultiplierText(snapshot, key);
    },
    onHide: () => events.push(['hide']),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });

  scheduler.schedule('Canada');
  timers.fireAll();
  assert.strictEqual(popupText, 'Current multiplier: 1.12×');

  // Incoming game:state snapshots keep changing the factor; the visible
  // popup text is recomputed from the latest snapshot each render.
  for (const next of [1.18, 1.25, 1.31]) {
    snapshot.game.world.countryProfitFactors.Canada = next;
    popupText = getCountryPopupMultiplierText(snapshot, 'Canada');
    assert.strictEqual(popupText, `Current multiplier: ${formatCountryProfitabilityMultiplier(next)}`);
  }

  // Decay updates downward the same way — no new hover/dwell involved.
  snapshot.game.world.countryProfitFactors.Canada = 1.05;
  popupText = getCountryPopupMultiplierText(snapshot, 'Canada');
  assert.strictEqual(popupText, 'Current multiplier: 1.05×');

  // Exactly one dwell cycle ran the whole time; the popup never hid/reshowed.
  assert.strictEqual(timers.calls.set.length, 1);
  assert.deepStrictEqual(events, [['hide'], ['show', 'Canada']]);
});

test('country tooltip CSS allows long names to wrap inside a wider popup', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../client/style.css'), 'utf8');

  const base = css.match(/\.airport-tooltip\s*\{([^}]*)\}/);
  const country = css.match(/\.country-tooltip\s*\{([^}]*)\}/);
  const countryName = css.match(/\.country-tooltip\s+\.airport-tooltip-code\s*\{([^}]*)\}/);

  assert.ok(base, 'base .airport-tooltip rule should exist');
  assert.ok(country, '.country-tooltip override should exist');
  assert.ok(countryName, '.country-tooltip name rule should exist');

  const baseMaxWidth = Number.parseFloat(base[1].match(/max-width:\s*([\d.]+)rem/)[1]);
  const countryMaxWidth = Number.parseFloat(country[1].match(/max-width:\s*([\d.]+)rem/)[1]);

  // Wider than the airport tooltip but still bounded — no fixed huge width.
  assert.ok(countryMaxWidth > baseMaxWidth);
  assert.ok(countryMaxWidth <= 20);

  // Long names wrap inside the popup instead of overflowing on one line.
  assert.match(country[1], /white-space:\s*normal/);
  assert.match(base[1], /white-space:\s*nowrap/);
  assert.match(countryName[1], /overflow-wrap:\s*anywhere/);

  // A name longer than the airport tooltip's 9rem cap fits in ~14rem.
  assert.ok('United States of America'.length * 0.09 < countryMaxWidth);
});

test('airport hover cancels a pending country popup timer', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');
  assert.strictEqual(scheduler.isPending(), true);

  scheduler.setBlocked(true); // airport marker mouseenter

  assert.strictEqual(scheduler.isPending(), false);
  assert.strictEqual(timers.calls.clear.length, 1);
  assert.deepStrictEqual(events, [['hide'], ['hide']]);

  timers.fireAll();
  assert.deepStrictEqual(events, [['hide'], ['hide']]); // cancelled timer never shows
});

test('airport hover hides an already-visible country popup', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');
  timers.fireAll();
  assert.deepStrictEqual(events, [['hide'], ['show', 'France']]);

  scheduler.setBlocked(true);
  assert.deepStrictEqual(events, [['hide'], ['show', 'France'], ['hide']]);
});

test('country popup cannot reschedule while an airport is hovered', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.setBlocked(true);
  scheduler.schedule('Germany');
  scheduler.schedule('France');

  assert.strictEqual(timers.calls.set.length, 0);
  assert.strictEqual(scheduler.isPending(), false);
  assert.deepStrictEqual(events, [['hide']]);

  timers.fireAll();
  assert.deepStrictEqual(events, [['hide']]); // nothing can appear while blocked
});

test('after airport mouseleave, country dwell can begin again normally', () => {
  const timers = createFakeTimers();
  const events = [];
  const scheduler = createScheduler(timers, events);

  scheduler.schedule('France');
  scheduler.setBlocked(true);
  scheduler.setBlocked(false); // airport marker mouseleave

  // A fresh hover over any country starts a new 500ms dwell.
  scheduler.schedule('France');
  assert.strictEqual(scheduler.isPending(), true);
  assert.strictEqual(timers.calls.set.length, 2);

  timers.fireAll();
  assert.deepStrictEqual(events, [['hide'], ['hide'], ['hide'], ['show', 'France']]);
});

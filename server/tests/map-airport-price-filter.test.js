const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
global.window = global;
require('../../client/map.js');

const { isAirportVisibleAtPrice } = global.__airlineAirportPriceFilter;

const clientGameSource = fs.readFileSync(
  path.join(__dirname, '../../client/game.js'),
  'utf8'
);

const airportAt = (basePrice) => ({ id: 'TST', basePrice });

test('null/null bounds show all airports', () => {
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(0), { minPrice: null, maxPrice: null }), true);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(500000), { minPrice: null, maxPrice: null }), true);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(99999999), { minPrice: null, maxPrice: null }), true);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(5000000000), { minPrice: null, maxPrice: null }), true);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(500000)), true);
});

test('lower bound hides airports below minPrice', () => {
  const range = { minPrice: 100000, maxPrice: null };
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(99999), range), false);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(50000), range), false);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(150000), range), true);
});

test('upper bound hides airports above maxPrice', () => {
  const range = { minPrice: null, maxPrice: 200000 };
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(200001), range), false);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(500000), range), false);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(150000), range), true);
});

test('both bounds form an inclusive range', () => {
  const range = { minPrice: 100000, maxPrice: 200000 };
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(99999), range), false);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(200001), range), false);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(150000), range), true);
});

test('exact-bound prices are included', () => {
  const range = { minPrice: 100000, maxPrice: 200000 };
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(100000), range), true);
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(200000), range), true);
});

test('missing or non-finite basePrice stays visible', () => {
  const range = { minPrice: 100000, maxPrice: 200000 };
  assert.strictEqual(isAirportVisibleAtPrice({}, range), true);
  assert.strictEqual(isAirportVisibleAtPrice({ basePrice: 'bad' }, range), true);
  assert.strictEqual(isAirportVisibleAtPrice(null, range), true);
});

test('non-finite bounds behave like null bounds', () => {
  assert.strictEqual(isAirportVisibleAtPrice(airportAt(50), { minPrice: 'bad', maxPrice: NaN }), true);
});

function extractStops(source) {
  const start = source.indexOf('const AIRPORT_PRICE_FILTER_STOPS = [');
  const end = source.indexOf('];', start);
  assert.ok(start !== -1 && end !== -1, 'AIRPORT_PRICE_FILTER_STOPS should exist');
  const body = source.slice(start, end);
  const stops = [];
  for (const m of body.matchAll(/\{\s*label:\s*'([^']+)',\s*maxPrice:\s*(null|\d+)\s*\}/g)) {
    stops.push({ label: m[1], maxPrice: m[2] === 'null' ? null : Number(m[2]) });
  }
  return stops;
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name} should have a complete function body`);
}

function extractArrowListenerBody(source, target, eventName) {
  const marker = `${target}.addEventListener('${eventName}', () => {`;
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, `${target} ${eventName} listener should exist`);
  const bodyStart = start + marker.length;
  let depth = 1;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, index);
    }
  }
  assert.fail(`${target} ${eventName} listener should have a complete body`);
}

function loadBudgetSliderHelpers() {
  const functionNames = [
    'snapAirportPriceFilterPosition',
    'getAirportPriceFilterMinimumPrice',
    'getAirportPriceFilterAllSegmentFiniteMaximumPrice',
    'getAirportPriceFilterPriceAtStopPosition',
    'getAirportPriceFilterStopPositionForPrice',
    'getAirportPriceFilterLowerStopIndexBelowPrice',
    'getAirportPriceFilterMinimumRawValueForBudget'
  ];
  const helperSource = functionNames.map((name) => extractFunction(clientGameSource, name)).join('\n');
  return new Function(
    'AIRPORT_PRICE_FILTER_STOPS',
    'gameState',
    `${helperSource}; return { ${functionNames.join(', ')} };`
  )(extractStops(clientGameSource), { getState: () => ({ game: { airports: [] } }) });
}

function clickBudgetButtonWithState(state) {
  const stops = extractStops(clientGameSource);
  const functionNames = [
    'snapAirportPriceFilterPosition',
    'getAirportPriceFilterMinimumPrice',
    'getAirportPriceFilterAllSegmentFiniteMaximumPrice',
    'getAirportPriceFilterPriceAtStopPosition',
    'getAirportPriceFilterStopPositionForPrice',
    'getAirportPriceFilterLowerStopIndexBelowPrice',
    'getAirportPriceFilterMinimumRawValueForBudget',
    'applyAirportPriceFilterRange'
  ];
  const functions = functionNames.map((name) => extractFunction(clientGameSource, name)).join('\n');
  const listenerBody = extractArrowListenerBody(
    clientGameSource,
    'airportPriceFilterBudgetButtonEl',
    'click'
  );
  const executeClick = new Function(
    'testState',
    `
      const AIRPORT_PRICE_FILTER_STOPS = ${JSON.stringify(stops)};
      const airportPriceFilterMinSliderEl = { value: '0' };
      const airportPriceFilterMaxSliderEl = { value: String(AIRPORT_PRICE_FILTER_STOPS.length - 1) };
      const airportPriceFilterTickEls = AIRPORT_PRICE_FILTER_STOPS.map(() => ({
        classList: { toggle() {} }
      }));
      const airportPriceFilterSliderStackEl = { style: { setProperty() {} } };
      let appliedRange = null;
      const renderer = { setAirportPriceFilter(range) { appliedRange = range; } };
      const gameState = { getState() { return testState; } };
      let airportPriceFilterExactMaxPrice = null;
      ${functions}
      let clickHandler = null;
      const airportPriceFilterBudgetButtonEl = {
        addEventListener(_eventName, handler) {
          clickHandler = handler;
        }
      };
      airportPriceFilterBudgetButtonEl.addEventListener('click', () => {
        ${listenerBody}
      });
      clickHandler();
      return {
        range: appliedRange,
        minRaw: Number(airportPriceFilterMinSliderEl.value),
        maxRaw: Number(airportPriceFilterMaxSliderEl.value)
      };
    `
  );

  return executeClick(state);
}

function applyAirportPriceRangeWithState(minRaw, maxRaw, state, activeHandle = null) {
  const stops = extractStops(clientGameSource);
  const functionNames = [
    'snapAirportPriceFilterPosition',
    'getAirportPriceFilterMinimumPrice',
    'getAirportPriceFilterAllSegmentFiniteMaximumPrice',
    'getAirportPriceFilterPriceAtStopPosition',
    'applyAirportPriceFilterRange'
  ];
  const functions = functionNames.map((name) => extractFunction(clientGameSource, name)).join('\n');
  const applyRange = new Function(
    'testState',
    'minRaw',
    'maxRaw',
    'activeHandle',
    `
      const AIRPORT_PRICE_FILTER_STOPS = ${JSON.stringify(stops)};
      const airportPriceFilterMinSliderEl = { value: String(minRaw) };
      const airportPriceFilterMaxSliderEl = { value: String(maxRaw) };
      const airportPriceFilterTickEls = AIRPORT_PRICE_FILTER_STOPS.map(() => ({
        classList: { toggle() {} }
      }));
      const airportPriceFilterSliderStackEl = { style: { setProperty() {} } };
      let appliedRange = null;
      const renderer = { setAirportPriceFilter(range) { appliedRange = range; } };
      const gameState = { getState() { return testState; } };
      let airportPriceFilterExactMaxPrice = null;
      ${functions}
      applyAirportPriceFilterRange(minRaw, maxRaw, activeHandle);
      return {
        range: appliedRange,
        minRaw: Number(airportPriceFilterMinSliderEl.value),
        maxRaw: Number(airportPriceFilterMaxSliderEl.value)
      };
    `
  );
  return applyRange(state, minRaw, maxRaw, activeHandle);
}

function loadSnapPositionHelper() {
  const helperSource = extractFunction(clientGameSource, 'snapAirportPriceFilterPosition');
  return new Function(`${helperSource}; return snapAirportPriceFilterPosition;`)();
}

function getPointerRawValue(expectedRawValue) {
  const sliderRange = extractStops(clientGameSource).length - 1;
  const functionSource = extractFunction(clientGameSource, 'getAirportPriceFilterRawValueFromPointer');
  const getRawValue = new Function(
    'AIRPORT_PRICE_FILTER_STOPS',
    'airportPriceFilterSliderStackEl',
    `${functionSource}; return getAirportPriceFilterRawValueFromPointer;`
  )(
    extractStops(clientGameSource),
    { getBoundingClientRect: () => ({ top: 0, height: 100 }) }
  );
  return getRawValue({ clientY: (1 - expectedRawValue / sliderRange) * 100 });
}

test('price filter UI exposes the exact discrete stops', () => {
  const stops = extractStops(clientGameSource);
  assert.deepStrictEqual(stops, [
    { label: 'All', maxPrice: null },
    { label: '2.5B', maxPrice: 2500000000 },
    { label: '1B', maxPrice: 1000000000 },
    { label: '750M', maxPrice: 750000000 },
    { label: '500M', maxPrice: 500000000 },
    { label: '250M', maxPrice: 250000000 },
    { label: '100M', maxPrice: 100000000 },
    { label: '75M', maxPrice: 75000000 },
    { label: '50M', maxPrice: 50000000 },
    { label: '25M', maxPrice: 25000000 },
    { label: '10M', maxPrice: 10000000 },
    { label: '7.5M', maxPrice: 7500000 },
    { label: '5M', maxPrice: 5000000 },
    { label: '2.5M', maxPrice: 2500000 },
    { label: '1M', maxPrice: 1000000 },
    { label: '750K', maxPrice: 750000 },
    { label: '500K', maxPrice: 500000 },
    { label: '250K', maxPrice: 250000 },
    { label: 'Min', maxPrice: 0 }
  ]);
});

test('slider wires both handles to inclusive range bounds', () => {
  assert.ok(clientGameSource.includes("airportPriceFilterMinSliderEl.step = 'any'"));
  assert.ok(clientGameSource.includes("airportPriceFilterMaxSliderEl.step = 'any'"));
  assert.ok(clientGameSource.includes('minPrice: getAirportPriceFilterPriceAtStopPosition(minStopPosition)'));
  assert.ok(clientGameSource.includes(
    'getAirportPriceFilterPriceAtStopPosition(maxStopPosition, true)'
  ));
  assert.ok(clientGameSource.includes('airportPriceFilterMinSliderEl'));
  assert.ok(clientGameSource.includes('airportPriceFilterMaxSliderEl'));
  assert.ok(!clientGameSource.includes('airportPriceFilterMinSliderEl.max = String(maxRaw)'));
  assert.ok(!clientGameSource.includes('airportPriceFilterMaxSliderEl.min = String(minRaw)'));
  assert.ok(clientGameSource.includes("if (activeHandle === 'min' && minRaw > maxRaw)"));
  assert.ok(clientGameSource.includes('minRaw = maxRaw'));
  assert.ok(clientGameSource.includes("else if (activeHandle === 'max' && maxRaw < minRaw)"));
  assert.ok(clientGameSource.includes('maxRaw = minRaw'));
  // Top position must be "All": raw slider value is inverted so max raw = stop 0.
  assert.ok(clientGameSource.includes('const minStopPosition = maxSliderValue - minRaw'));
  assert.ok(clientGameSource.includes('const maxStopPosition = maxSliderValue - maxRaw'));
  assert.ok(clientGameSource.includes('const maxStopIndex = Math.ceil(maxStopPosition)'));
  assert.ok(clientGameSource.includes('return (1 - progress) * sliderRange'));
  assert.ok(!clientGameSource.includes('return Math.round((1 - progress) * sliderRange)'));
  assert.ok(clientGameSource.includes("airportPriceFilterMaxSliderEl.value = String(AIRPORT_PRICE_FILTER_STOPS.length - 1)"));
});

test('manual slider positions interpolate between finite monetary stops', () => {
  const { getAirportPriceFilterPriceAtStopPosition } = loadBudgetSliderHelpers();
  const maxSliderValue = extractStops(clientGameSource).length - 1;
  const upperStopPosition = 7;
  const lowerStopPosition = 8;
  const fraction = (68000000 - 75000000) / (50000000 - 75000000);
  const position = upperStopPosition + fraction;

  assert.equal(position, 7.28);
  assert.equal(getAirportPriceFilterPriceAtStopPosition(position), 68000000);
  assert.equal(getAirportPriceFilterPriceAtStopPosition(upperStopPosition), 75000000);
  assert.equal(getAirportPriceFilterPriceAtStopPosition(lowerStopPosition), 50000000);

  const pointerRaw = getPointerRawValue(maxSliderValue - position);
  assert.ok(Math.abs(pointerRaw - (maxSliderValue - position)) < 1e-12);
  const raw = maxSliderValue - position;
  const applied = applyAirportPriceRangeWithState(0, raw, { game: { airports: [] } });
  assert.equal(applied.range.minPrice, 0);
  assert.equal(applied.range.maxPrice, 68000000);
  assert.equal(applied.maxRaw, raw);
  assert.equal(isAirportVisibleAtPrice(airportAt(68000000), applied.range), true);
  assert.equal(isAirportVisibleAtPrice(airportAt(68000001), applied.range), false);

  const lowerHandleApplied = applyAirportPriceRangeWithState(
    maxSliderValue - 6.6,
    maxSliderValue,
    { game: { airports: [] } },
    'min'
  );
  assert.equal(lowerHandleApplied.range.minPrice, 85000000);
  assert.equal(lowerHandleApplied.range.maxPrice, null);
});

test('manual positions snap within 0.22 of a tick from either side, otherwise remain continuous', () => {
  const snapPosition = loadSnapPositionHelper();
  assert.equal(snapPosition(7.21), 7);
  assert.equal(snapPosition(6.79), 7);
  assert.equal(snapPosition(7.22), 7);
  assert.equal(snapPosition(7.23), 7.23);
  assert.equal(snapPosition(6.77), 6.77);

  const maxSliderValue = extractStops(clientGameSource).length - 1;
  const minNearTick = applyAirportPriceRangeWithState(
    maxSliderValue - 7.21,
    maxSliderValue,
    { game: { airports: [] } },
    'min'
  );
  assert.equal(maxSliderValue - minNearTick.minRaw, 7);
  assert.equal(minNearTick.range.minPrice, 75000000);

  const maxNearTick = applyAirportPriceRangeWithState(
    0,
    maxSliderValue - 6.79,
    { game: { airports: [] } },
    'max'
  );
  assert.equal(maxSliderValue - maxNearTick.maxRaw, 7);
  assert.equal(maxNearTick.range.maxPrice, 75000000);

  const maxOutsideSnapZone = applyAirportPriceRangeWithState(
    0,
    maxSliderValue - 7.23,
    { game: { airports: [] } },
    'max'
  );
  assert.equal(maxSliderValue - maxOutsideSnapZone.maxRaw, 7.23);
  assert.equal(maxOutsideSnapZone.range.maxPrice, 69250000);
});

test('snapping supports Min and All endpoints and preserves exact milestone prices', () => {
  const snapPosition = loadSnapPositionHelper();
  const maxSliderValue = extractStops(clientGameSource).length - 1;
  assert.equal(snapPosition(0.21), 0);
  assert.equal(snapPosition(maxSliderValue - 0.21), maxSliderValue);

  const allEndpoint = applyAirportPriceRangeWithState(
    0,
    maxSliderValue - 0.21,
    { game: { airports: [] } },
    'max'
  );
  assert.equal(allEndpoint.maxRaw, maxSliderValue);
  assert.equal(allEndpoint.range.maxPrice, null);

  const minEndpoint = applyAirportPriceRangeWithState(
    0.21,
    maxSliderValue,
    { game: { airports: [] } },
    'min'
  );
  assert.equal(minEndpoint.minRaw, 0);
  assert.equal(minEndpoint.range.minPrice, 0);
});

test('All-to-2.5B interpolation uses highest airport price as finite anchor; All remains unbounded', () => {
  const { getAirportPriceFilterPriceAtStopPosition } = loadBudgetSliderHelpers();
  const maximumAirportPrice = 5000000000;
  const gameState = { getState: () => ({ game: { airports: [{ basePrice: maximumAirportPrice }] } }) };
  const getPositionPrice = new Function(
    'AIRPORT_PRICE_FILTER_STOPS',
    'gameState',
    `${extractFunction(clientGameSource, 'getAirportPriceFilterAllSegmentFiniteMaximumPrice')}\n` +
      `${extractFunction(clientGameSource, 'getAirportPriceFilterPriceAtStopPosition')}\n` +
      'return getAirportPriceFilterPriceAtStopPosition;'
  )(extractStops(clientGameSource), gameState);

  assert.equal(getPositionPrice(0.5, true), 3750000000);
  assert.equal(getPositionPrice(1, true), 2500000000);
  assert.equal(getPositionPrice(0, true), null);
  assert.equal(getPositionPrice(0.5, false), 2500000000);
  assert.equal(getAirportPriceFilterPriceAtStopPosition(0.5, false), 2500000000);
});

test('continuous handles may coincide but cannot cross', () => {
  const state = { game: { airports: [] } };
  const minDraggedPastMax = applyAirportPriceRangeWithState(12.25, 10.75, state, 'min');
  assert.equal(minDraggedPastMax.minRaw, 10.75);
  assert.equal(minDraggedPastMax.maxRaw, 10.75);
  assert.equal(minDraggedPastMax.range.minPrice, 68750000);
  assert.equal(minDraggedPastMax.range.maxPrice, 68750000);

  const maxDraggedPastMin = applyAirportPriceRangeWithState(10.75, 9.25, state, 'max');
  assert.equal(maxDraggedPastMin.minRaw, 10.75);
  assert.equal(maxDraggedPastMin.maxRaw, 10.75);
  assert.equal(maxDraggedPastMin.range.minPrice, 68750000);
  assert.equal(maxDraggedPastMin.range.maxPrice, 68750000);

  const coincidentAtMin = applyAirportPriceRangeWithState(0, 0, state, 'max');
  assert.equal(coincidentAtMin.range.minPrice, 0);
  assert.equal(coincidentAtMin.range.maxPrice, 0);
});

test('Budget uses piecewise stop interpolation and retains exact cash limits', () => {
  const {
    getAirportPriceFilterStopPositionForPrice,
    getAirportPriceFilterMinimumRawValueForBudget
  } = loadBudgetSliderHelpers();
  const maxSliderValue = extractStops(clientGameSource).length - 1;
  const cash = 68000000;
  const stopPosition = getAirportPriceFilterStopPositionForPrice(cash);

  assert.equal(stopPosition, 7.28);
  assert.ok(Math.abs((maxSliderValue - stopPosition) - 10.72) < Number.EPSILON * 64);
  assert.equal(isAirportVisibleAtPrice(airportAt(cash), { minPrice: 0, maxPrice: cash }), true);
  assert.equal(isAirportVisibleAtPrice(airportAt(cash + 1), { minPrice: 0, maxPrice: cash }), false);

  const minAt75M = maxSliderValue - 7;
  assert.equal(getAirportPriceFilterMinimumRawValueForBudget(cash, minAt75M), maxSliderValue - 8);
  assert.equal(getAirportPriceFilterMinimumRawValueForBudget(cash, maxSliderValue - 9), maxSliderValue - 9);
});

test('Budget handles low and above-scale cash without treating All as numeric', () => {
  const {
    getAirportPriceFilterStopPositionForPrice,
    getAirportPriceFilterMinimumRawValueForBudget
  } = loadBudgetSliderHelpers();
  const maxSliderValue = extractStops(clientGameSource).length - 1;

  const lowCash = 100000;
  const lowPosition = getAirportPriceFilterStopPositionForPrice(lowCash);
  assert.equal(lowPosition, 17.6);
  assert.equal(getAirportPriceFilterMinimumRawValueForBudget(lowCash, 0), 0);

  const zeroCash = 0;
  assert.equal(getAirportPriceFilterStopPositionForPrice(zeroCash), maxSliderValue);
  assert.equal(getAirportPriceFilterMinimumRawValueForBudget(zeroCash, 0), 0);

  const highCash = 3000000000;
  assert.equal(getAirportPriceFilterStopPositionForPrice(highCash), 0);
  assert.equal(maxSliderValue - getAirportPriceFilterStopPositionForPrice(highCash), maxSliderValue);
  assert.equal(getAirportPriceFilterMinimumRawValueForBudget(highCash, 0), 0);
  assert.equal(
    isAirportVisibleAtPrice(airportAt(3000000000), { minPrice: 0, maxPrice: highCash }),
    true
  );
  assert.equal(
    isAirportVisibleAtPrice(airportAt(3000000001), { minPrice: 0, maxPrice: highCash }),
    false
  );
});

test('Budget reads current player capital and manual input or Reset clears its exact limit', () => {
  assert.match(
    clientGameSource,
    /const players = Array\.isArray\(state && state\.game && state\.game\.players\) \? state\.game\.players : \[\];/
  );
  assert.match(
    clientGameSource,
    /airportPriceFilterMinSliderEl\.addEventListener\('input', \(\) => \{\s*airportPriceFilterExactMaxPrice = null;/
  );
  assert.match(
    clientGameSource,
    /airportPriceFilterMaxSliderEl\.addEventListener\('input', \(\) => \{\s*airportPriceFilterExactMaxPrice = null;/
  );
  assert.match(
    clientGameSource,
    /airportPriceFilterHitDragHandle = minDistance < maxDistance \? 'min' : 'max';\s*airportPriceFilterHitDragPointerId = event\.pointerId;\s*airportPriceFilterExactMaxPrice = null;/
  );
  assert.match(
    clientGameSource,
    /airportPriceFilterResetButtonEl\.addEventListener\('click', \(\) => \{\s*airportPriceFilterExactMaxPrice = null;/
  );
  assert.ok(clientGameSource.includes('airportPriceFilterEl.appendChild(airportPriceFilterActionsEl)'));
  assert.ok(clientGameSource.includes('airportPriceFilterActionsEl.appendChild(airportPriceFilterBudgetButtonEl)'));
  assert.ok(clientGameSource.includes('airportPriceFilterActionsEl.appendChild(airportPriceFilterResetButtonEl)'));
});

test('Budget positioning does not snap a balance near a labeled milestone', () => {
  const result = clickBudgetButtonWithState({
    session: { playerId: 'local-player' },
    game: { players: [{ id: 'local-player', capital: 70000000 }] }
  });
  const maxSliderValue = extractStops(clientGameSource).length - 1;
  assert.equal(result.range.maxPrice, 70000000);
  assert.ok(Math.abs((maxSliderValue - result.maxRaw) - 7.2) < 1e-12);
});

test('Budget click applies local player exact capital from the live game-state shape', () => {
  const result = clickBudgetButtonWithState({
    session: { playerId: 'local-player' },
    game: {
      players: [
        { id: 'other-player', capital: 900000000 },
        { id: 'local-player', capital: 68000000 }
      ]
    }
  });

  assert.deepStrictEqual(result.range, {
    minPrice: 0,
    maxPrice: 68000000
  });
});

test('Reset restores the full Min-to-All range through the range update mechanism', () => {
  assert.ok(clientGameSource.includes("airportPriceFilterResetButtonEl.type = 'button'"));
  assert.ok(clientGameSource.includes("airportPriceFilterResetButtonEl.textContent = '↺'"));
  assert.ok(clientGameSource.includes("airportPriceFilterResetButtonEl.setAttribute('aria-label', 'Reset')"));
  assert.ok(clientGameSource.includes("airportPriceFilterResetButtonEl.title = 'Reset'"));
  assert.ok(clientGameSource.includes("airportPriceFilterResetButtonEl.addEventListener('click'"));
  assert.ok(clientGameSource.includes("airportPriceFilterMinSliderEl.value = '0'"));
  assert.ok(clientGameSource.includes(
    "airportPriceFilterMaxSliderEl.value = String(AIRPORT_PRICE_FILTER_STOPS.length - 1)"
  ));
  assert.match(
    clientGameSource,
    /airportPriceFilterResetButtonEl\.addEventListener\('click', \(\) => \{\s*airportPriceFilterExactMaxPrice = null;\s*airportPriceFilterMinSliderEl\.value = '0';\s*airportPriceFilterMaxSliderEl\.value = String\(AIRPORT_PRICE_FILTER_STOPS\.length - 1\);\s*applyAirportPriceFilterRange\(\s*airportPriceFilterMinSliderEl\.value,\s*airportPriceFilterMaxSliderEl\.value\s*\);/
  );
  assert.ok(clientGameSource.indexOf('airportPriceFilterActionsEl.appendChild(airportPriceFilterResetButtonEl)') <
    clientGameSource.indexOf('airportPriceFilterActionsEl.appendChild(airportPriceFilterBudgetButtonEl)'));

  const css = fs.readFileSync(path.join(__dirname, '../../client/style.css'), 'utf8');
  assert.match(css, /\.airport-price-filter-action-button\s*\{[^}]*pointer-events:\s*auto;/);
  assert.match(css, /\.airport-price-filter-action-button\s*\{[^}]*background:\s*#7dd3fc;/);
  assert.match(css, /\.airport-price-filter-action-button\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;/);
  assert.match(css, /\.airport-price-filter-action-button:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /\.airport-price-filter-reset\s*\{[^}]*flex:\s*1;/);
  assert.match(css, /\.airport-price-filter-budget\s*\{[^}]*flex:\s*1;/);
  assert.match(css, /\.airport-price-filter-actions\s*\{[^}]*display:\s*flex;/);
});

test('Cash button retains Budget action and has a compact visible label', () => {
  assert.ok(clientGameSource.includes("airportPriceFilterBudgetButtonEl.type = 'button'"));
  assert.ok(clientGameSource.includes("airportPriceFilterBudgetButtonEl.textContent = 'Cash'"));
  assert.ok(clientGameSource.includes("airportPriceFilterBudgetButtonEl.addEventListener('click'"));
  const css = fs.readFileSync(path.join(__dirname, '../../client/style.css'), 'utf8');
  assert.match(css, /\.airport-price-filter-budget\s*\{[^}]*font-size:\s*0\.48rem;/);
});

test('filter control sits directly above the left-side button column', () => {
  const filterIdx = clientGameSource.indexOf('hudBottomRightStackEl.appendChild(airportPriceFilterEl)');
  const buttonsIdx = clientGameSource.indexOf('hudBottomRightStackEl.appendChild(hudIconColumnEl)');
  assert.ok(filterIdx !== -1 && buttonsIdx !== -1);
  assert.ok(filterIdx < buttonsIdx);

  // DOM structure: label, then a track with fixed tick labels + two sliders.
  for (const cls of [
    'airport-price-filter',
    'airport-price-filter-label',
    'airport-price-filter-track',
    'airport-price-filter-ticks',
    'airport-price-filter-tick',
    'airport-price-filter-slider--min',
    'airport-price-filter-slider--max'
  ]) {
    assert.ok(clientGameSource.includes(cls), `missing ${cls}`);
  }
  assert.ok(clientGameSource.includes("airportPriceFilterLabelEl.textContent = 'Budget'"));
  assert.ok(clientGameSource.includes("stop.label.startsWith('$') ? stop.label.slice(1) : stop.label"));
  // One tick label per stop, generated from the same stops array.
  assert.ok(clientGameSource.includes('AIRPORT_PRICE_FILTER_STOPS.map((stop)'));
  assert.ok(!clientGameSource.includes('airportPriceFilterValueEl'),
    'dynamic selected-value element should be removed');
});

test('ticks inside the selected range get the active class', () => {
  // Ticks are generated in stop order (0 = All … last = 0).
  assert.ok(clientGameSource.includes(
    "tickIndex >= maxStopIndex && tickIndex <= minStopPosition"
  ));
  assert.ok(clientGameSource.includes("--airport-price-filter-range-bottom', `${(minRaw / sliderRange) * 100}%`"));
  // Initial handles select the entire range.
  assert.ok(clientGameSource.includes('applyAirportPriceFilterRange(airportPriceFilterMinSliderEl.value, airportPriceFilterMaxSliderEl.value)'));

  const css = fs.readFileSync(path.join(__dirname, '../../client/style.css'), 'utf8');
  const activeRule = css.match(/\.airport-price-filter-tick--active\s*\{([^}]*)\}/);
  const rangeRule = css.match(/\.airport-price-filter-range\s*\{([^}]*)\}/);
  assert.ok(activeRule, 'active tick rule should exist');
  assert.ok(rangeRule, 'range rule should exist');
  const rangeColor = rangeRule[1].match(/background:\s*([^;]+);/)[1].trim();
  assert.ok(activeRule[1].includes(`color: ${rangeColor}`), 'active tick color should reuse the visual range color');
});

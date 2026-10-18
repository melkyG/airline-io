const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME_SOURCE = fs.readFileSync(path.join(__dirname, '../../client/game.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const signaturePattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
  const match = signaturePattern.exec(source);
  if (!match) {
    throw new Error(`Could not find function ${functionName} in client/game.js`);
  }

  const signatureStart = match.index;
  let i = source.indexOf('(', signatureStart);
  let parenDepth = 1;
  i += 1;

  while (i < source.length && parenDepth > 0) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') parenDepth -= 1;
    i += 1;
  }

  while (i < source.length && source[i] !== '{') {
    i += 1;
  }

  if (i >= source.length) {
    throw new Error(`Could not find function body for ${functionName}`);
  }

  let braceDepth = 1;
  i += 1;
  const bodyStart = signatureStart;
  const bodyOpen = i - 1;

  while (i < source.length && braceDepth > 0) {
    const ch = source[i];
    if (ch === '{') braceDepth += 1;
    if (ch === '}') braceDepth -= 1;
    i += 1;
  }

  return source.slice(bodyStart, i);
}

function createQuantitySandbox() {
  const normalizeSource = extractFunctionSource(GAME_SOURCE, 'normalizeAircraftPurchaseQuantity');
  const applySource = extractFunctionSource(GAME_SOURCE, 'applyAuthoritativeAircraftMaxPurchasable');
  const commitSource = extractFunctionSource(GAME_SOURCE, 'commitAircraftQuantityInputChanged');

  const sandbox = {
    Number,
    String,
    Array,
    Math,
    console,
    aircraftMaxPurchasable: 0,
    aircraftPurchaseQuantity: 0,
    aircraftPurchaseQuantityRawInput: '',
    isAircraftPurchaseQuantityEditing: false,
    shopAircraftQuantityInputEl: { value: '' },
    gameState: { getState() { return {}; } },
    refreshShopAircraftInteractionPanel() {}
  };

  const script = `
${normalizeSource}
${applySource}
${commitSource}
`;

  vm.runInNewContext(script, sandbox);
  return sandbox;
}

test('applyAuthoritativeAircraftMaxPurchasable initializes quantity to 0 when max is 0', () => {
  const box = createQuantitySandbox();
  box.aircraftPurchaseQuantity = null;
  box.applyAuthoritativeAircraftMaxPurchasable(0);
  assert.equal(box.aircraftMaxPurchasable, 0);
  assert.equal(box.aircraftPurchaseQuantity, 0);
});

test('applyAuthoritativeAircraftMaxPurchasable restores quantity from 0 to 1 when max becomes 1', () => {
  const box = createQuantitySandbox();
  box.aircraftPurchaseQuantity = 0;
  box.applyAuthoritativeAircraftMaxPurchasable(1);
  assert.equal(box.aircraftPurchaseQuantity, 1);
});

test('applyAuthoritativeAircraftMaxPurchasable does not auto-increase from 1 to higher max', () => {
  const box = createQuantitySandbox();
  box.aircraftPurchaseQuantity = 1;
  box.applyAuthoritativeAircraftMaxPurchasable(5);
  assert.equal(box.aircraftPurchaseQuantity, 1);
});

test('applyAuthoritativeAircraftMaxPurchasable clamps quantity to 0 when affordability falls', () => {
  const box = createQuantitySandbox();
  box.aircraftPurchaseQuantity = 3;
  box.applyAuthoritativeAircraftMaxPurchasable(0);
  assert.equal(box.aircraftPurchaseQuantity, 0);
});

test('applyAuthoritativeAircraftMaxPurchasable clamps down but does not auto-bump non-zero quantities', () => {
  const box = createQuantitySandbox();
  box.aircraftPurchaseQuantity = 5;
  box.applyAuthoritativeAircraftMaxPurchasable(2);
  assert.equal(box.aircraftPurchaseQuantity, 2);
});

test('commitAircraftQuantityInputChanged turns manually committed 0 into 1 when max is >= 1', () => {
  const box = createQuantitySandbox();
  box.aircraftMaxPurchasable = 3;
  box.shopAircraftQuantityInputEl.value = '0';
  box.commitAircraftQuantityInputChanged();
  assert.equal(box.aircraftPurchaseQuantity, 1);
});

test('commitAircraftQuantityInputChanged clamps a high manual value to max and does not auto-increase', () => {
  const box = createQuantitySandbox();
  box.aircraftMaxPurchasable = 2;
  box.shopAircraftQuantityInputEl.value = '10';
  box.commitAircraftQuantityInputChanged();
  assert.equal(box.aircraftPurchaseQuantity, 2);
});

test('commitAircraftQuantityInputChanged restores empty input to 1 when max becomes >= 1', () => {
  const box = createQuantitySandbox();
  box.aircraftMaxPurchasable = 1;
  box.shopAircraftQuantityInputEl.value = '';
  box.commitAircraftQuantityInputChanged();
  assert.equal(box.aircraftPurchaseQuantity, 1);
});

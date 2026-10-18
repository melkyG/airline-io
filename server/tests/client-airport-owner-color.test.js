const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const clientGameSource = fs.readFileSync(
  path.join(__dirname, '../../client/game.js'),
  'utf8'
);

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

const getAuthoritativePlayerById = extractFunction(clientGameSource, 'getAuthoritativePlayerById');
const resolveAirportOwnerText = extractFunction(clientGameSource, 'resolveAirportOwnerText');
const applyAirportOwnerTextColor = extractFunction(clientGameSource, 'applyAirportOwnerTextColor');
const resolveOwnerText = new Function(
  'state',
  'airport',
  `${getAuthoritativePlayerById}\n${resolveAirportOwnerText}\n` +
    'return resolveAirportOwnerText(state, airport);'
);
const applyColor = new Function(
  'state',
  'airport',
  'ownerValueEl',
  `${getAuthoritativePlayerById}\n${applyAirportOwnerTextColor}\n` +
    'applyAirportOwnerTextColor(state, airport, ownerValueEl);'
);

function createOwnerValueElement(initialColor = '') {
  return {
    style: {
      color: initialColor,
      removeProperty(propertyName) {
        if (propertyName === 'color') {
          this.color = '';
        }
      }
    }
  };
}

test('airport owner text receives the selected color of the airport owner', () => {
  const ownerValueEl = createOwnerValueElement();
  const state = {
    game: {
      players: [
        { id: 'owner-a', username: 'Alice', colorHex: '#8b5cf6' },
        { id: 'owner-b', username: 'Bob', colorHex: '#0ea5e9' }
      ]
    }
  };

  applyColor(state, { ownerPlayerId: 'owner-a' }, ownerValueEl);
  assert.equal(ownerValueEl.style.color, '#8b5cf6');

  applyColor(state, { ownerPlayerId: 'owner-b' }, ownerValueEl);
  assert.equal(ownerValueEl.style.color, '#0ea5e9');
});

test('locally owned airport displays username followed by You; other and unowned labels remain unchanged', () => {
  const state = {
    session: { playerId: 'owner-a' },
    game: {
      players: [
        { id: 'owner-a', username: 'Alice', colorHex: '#8b5cf6' },
        { id: 'owner-b', username: 'Bob', colorHex: '#0ea5e9' }
      ]
    }
  };

  assert.equal(resolveOwnerText(state, { ownerPlayerId: 'owner-a' }), 'Alice (You)');
  assert.equal(resolveOwnerText(state, { ownerPlayerId: 'owner-b' }), 'Bob');
  assert.equal(resolveOwnerText(state, { ownerPlayerId: null }), 'Unowned');
  assert.equal(resolveOwnerText(state, { ownerPlayerId: 'missing-owner' }), 'Unknown');
});

test('unowned airports and missing or invalid colors retain the default text color', () => {
  const ownerValueEl = createOwnerValueElement('#8b5cf6');
  const state = {
    game: {
      players: [
        { id: 'owner-no-color', colorHex: null },
        { id: 'owner-invalid-color', colorHex: 'red' }
      ]
    }
  };

  applyColor(state, { ownerPlayerId: null }, ownerValueEl);
  assert.equal(ownerValueEl.style.color, '');

  ownerValueEl.style.color = '#0ea5e9';
  applyColor(state, { ownerPlayerId: 'owner-no-color' }, ownerValueEl);
  assert.equal(ownerValueEl.style.color, '');

  ownerValueEl.style.color = '#0ea5e9';
  applyColor(state, { ownerPlayerId: 'owner-invalid-color' }, ownerValueEl);
  assert.equal(ownerValueEl.style.color, '');

  ownerValueEl.style.color = '#0ea5e9';
  applyColor({ game: {} }, { ownerPlayerId: 'missing-owner' }, ownerValueEl);
  assert.equal(ownerValueEl.style.color, '');
});

test('Airport Details refresh applies owner color after refreshing owner text', () => {
  assert.match(
    clientGameSource,
    /ownerValueEl\.textContent = resolveAirportOwnerText\(state, airport\);\s*applyAirportOwnerTextColor\(state, airport, ownerValueEl\);/
  );
});

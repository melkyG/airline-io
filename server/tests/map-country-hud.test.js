const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
global.window = global;
require('../../client/map.js');

const clientMapSource = fs.readFileSync(
  path.join(__dirname, '../../client/map.js'),
  'utf8'
);
const clientGameSource = fs.readFileSync(
  path.join(__dirname, '../../client/game.js'),
  'utf8'
);
const clientRenderSource = fs.readFileSync(
  path.join(__dirname, '../../client/render.js'),
  'utf8'
);
const clientStyleSource = fs.readFileSync(
  path.join(__dirname, '../../client/style.css'),
  'utf8'
);

test('map renderer exposes a country-hover change handler fired from setHoveredCountry', () => {
  // The HUD reuses the existing hover detection: the callback fires inside
  // setHoveredCountry (the single place the hovered ADMIN changes), so no
  // extra MapLibre mousemove listener is needed.
  assert.ok(clientMapSource.includes('function setHoveredCountry(countryAdmin)'));
  assert.ok(clientMapSource.includes('countryHoverChangeHandler(normalizedAdmin)'));
  assert.ok(clientMapSource.includes('setCountryHoverChangeHandler'));
});

test('hover callback receives the normalized ADMIN and empty string on clear', () => {
  const setHoveredCountryBody = clientMapSource.slice(
    clientMapSource.indexOf('function setHoveredCountry(countryAdmin)'),
    clientMapSource.indexOf('function syncCountryProfitability')
  );
  // Normalization trims and empty clears to '' before the handler fires.
  assert.ok(setHoveredCountryBody.includes("String(countryAdmin).trim()"));
  assert.ok(setHoveredCountryBody.indexOf('hoveredCountryAdmin = normalizedAdmin') <
    setHoveredCountryBody.indexOf('countryHoverChangeHandler(normalizedAdmin)'));
});

test('game HUD renders the country name beside the simulation clock date', () => {
  assert.ok(clientGameSource.includes("simulationClockCountryEl.className = 'simulation-clock-country'"));
  assert.ok(clientGameSource.includes('simulationClockDateRowEl.appendChild(simulationClockCountryEl)'));
  // Country name sits in the same row container as the date text.
  assert.ok(clientGameSource.indexOf('simulationClockDateRowEl.appendChild(simulationClockDateEl)') <
    clientGameSource.indexOf('simulationClockDateRowEl.appendChild(simulationClockCountryEl)'));
  // The handler writes the hovered name (or '' when hover clears).
  assert.ok(clientGameSource.includes('renderer.setCountryHoverChangeHandler'));
  assert.ok(clientGameSource.includes('simulationClockCountryEl.textContent = String(countryName ||'));
});

test('render.js facade forwards setCountryHoverChangeHandler to the map renderer', () => {
  // Regression: game.js registers on window.createRenderer's facade, not on
  // createMapRenderer directly — without forwarding, the handler never
  // reaches setHoveredCountry and the HUD text stays empty forever.
  assert.ok(clientRenderSource.includes('function setCountryHoverChangeHandler(handler)'));
  assert.ok(clientRenderSource.includes('mapRenderer.setCountryHoverChangeHandler(handler)'));

  const returnBlock = clientRenderSource.slice(clientRenderSource.lastIndexOf('return {'));
  assert.ok(returnBlock.includes('setCountryHoverChangeHandler'));
});

test('country HUD text matches the elapsed-time styling without pill or border', () => {
  const row = clientStyleSource.match(/\.simulation-clock-date-row\s*\{([^}]*)\}/);
  const shared = clientStyleSource.match(/\.simulation-clock-date,\s*\.simulation-clock-country\s*\{([^}]*)\}/);

  assert.ok(row, '.simulation-clock-date-row should exist');
  assert.match(row[1], /display:\s*flex/);
  assert.match(row[1], /gap:\s*0\.9rem/); // modest horizontal gap

  assert.ok(shared, 'country text should share the date font styling');
  assert.match(shared[1], /font-size:\s*0\.72rem/);
  assert.match(shared[1], /color:\s*#64748b/);

  const country = clientStyleSource.match(/\.simulation-clock-country\s*\{([^}]*)\}/);
  assert.ok(country);
  assert.doesNotMatch(country[1], /background|border|border-radius/);
});

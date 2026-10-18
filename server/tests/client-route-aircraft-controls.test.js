const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAME_SOURCE = fs.readFileSync(path.join(__dirname, '../../client/game.js'), 'utf8');
const STYLE_SOURCE = fs.readFileSync(path.join(__dirname, '../../client/style.css'), 'utf8');

function extractFunctionSource(source, functionName) {
  const match = new RegExp(`function\\s+${functionName}\\s*\\(`).exec(source);
  if (!match) {
    throw new Error(`Could not find function ${functionName} in client/game.js`);
  }

  let index = source.indexOf('(', match.index) + 1;
  let parenthesisDepth = 1;
  while (index < source.length && parenthesisDepth > 0) {
    if (source[index] === '(') parenthesisDepth += 1;
    if (source[index] === ')') parenthesisDepth -= 1;
    index += 1;
  }

  while (index < source.length && source[index] !== '{') {
    index += 1;
  }

  if (index >= source.length) {
    throw new Error(`Could not find function body for ${functionName}`);
  }

  const bodyStart = index;
  let braceDepth = 1;
  index += 1;
  while (index < source.length && braceDepth > 0) {
    if (source[index] === '{') braceDepth += 1;
    if (source[index] === '}') braceDepth -= 1;
    index += 1;
  }

  if (braceDepth !== 0) {
    throw new Error(`Function body for ${functionName} is not balanced`);
  }

  return source.slice(match.index, index);
}

function createBulkOperationSandbox({ route, ownedAircraft } = {}) {
  const emitted = [];
  const refreshes = [];
  const sandbox = {
    Array,
    Date,
    Map,
    Number,
    Set,
    String,
    routeAircraftLearnedModelEditLocks: new Map(),
    routeAircraftManagementErrorMessage: 'previous message',
    routeAircraftManagementFeedbackKind: 'error',
    routeAircraftBulkOperation: null,
    pendingRouteAircraftAssignAircraftInstanceId: null,
    pendingRouteAircraftUnassignAircraftInstanceId: null,
    gameState: {
      getState() {
        return {
          game: {
            routes: route ? [route] : [],
            ownedAircraft: ownedAircraft || []
          }
        };
      }
    },
    refreshRoutesModal(state) {
      refreshes.push(state);
    },
    emitRouteAircraftAssignBulkRequest(routeId, aircraftInstanceIds) {
      emitted.push({ mode: 'assign', routeId, aircraftInstanceIds });
    },
    emitRouteAircraftUnassignBulkRequest(routeId, aircraftInstanceIds) {
      emitted.push({ mode: 'unassign', routeId, aircraftInstanceIds });
    }
  };

  const script = [
    'rememberRouteAircraftModelEditLock',
    'getRouteAircraftModelEditLocks',
    'startRouteAircraftBulkOperation'
  ].map((name) => extractFunctionSource(GAME_SOURCE, name)).join('\n');

  vm.runInNewContext(script, sandbox);
  sandbox.emitted = emitted;
  sandbox.refreshes = refreshes;
  return sandbox;
}

function createRoute(lockUntil, reconfiguringModelCatalogIds = []) {
  return {
    routeId: 'route-1',
    modelEditLockedUntilRealMs: lockUntil == null ? {} : { BOEING_747: lockUntil },
    reconfiguringModelCatalogIds
  };
}

function createOwnedAircraft() {
  return [{ aircraftInstanceId: 'aircraft-1', aircraftCatalogId: 'BOEING_747' }];
}

test('active snapshot deadline blocks bulk Assign without marking pending or showing an error', () => {
  const box = createBulkOperationSandbox({
    route: createRoute(Date.now() + 5000),
    ownedAircraft: createOwnedAircraft()
  });

  box.startRouteAircraftBulkOperation({
    mode: 'assign',
    routeId: 'route-1',
    aircraftInstanceIds: ['aircraft-1']
  });

  assert.equal(box.emitted.length, 0);
  assert.equal(box.pendingRouteAircraftAssignAircraftInstanceId, null);
  assert.equal(box.pendingRouteAircraftUnassignAircraftInstanceId, null);
  assert.equal(box.routeAircraftBulkOperation, null);
  assert.equal(box.routeAircraftManagementErrorMessage, '');
  assert.equal(box.refreshes.length, 1);
});

test('active snapshot deadline blocks bulk Unassign', () => {
  const box = createBulkOperationSandbox({
    route: createRoute(Date.now() + 5000),
    ownedAircraft: createOwnedAircraft()
  });

  box.startRouteAircraftBulkOperation({
    mode: 'unassign',
    routeId: 'route-1',
    aircraftInstanceIds: ['aircraft-1']
  });

  assert.equal(box.emitted.length, 0);
  assert.equal(box.pendingRouteAircraftAssignAircraftInstanceId, null);
  assert.equal(box.pendingRouteAircraftUnassignAircraftInstanceId, null);
  assert.equal(box.routeAircraftBulkOperation, null);
  assert.equal(box.refreshes.length, 1);
});

test('expired deadline permits a bulk operation and preserves pending-request state', () => {
  const box = createBulkOperationSandbox({
    route: createRoute(Date.now() - 1000),
    ownedAircraft: createOwnedAircraft()
  });

  box.startRouteAircraftBulkOperation({
    mode: 'assign',
    routeId: 'route-1',
    aircraftInstanceIds: ['aircraft-1']
  });

  assert.equal(box.emitted.length, 1);
  assert.equal(box.emitted[0].mode, 'assign');
  assert.equal(box.pendingRouteAircraftAssignAircraftInstanceId, '__BULK__');
  assert.equal(box.routeAircraftBulkOperation.mode, 'assign');
});

test('reconfiguration without a deadline permits rapid bulk operations', () => {
  const box = createBulkOperationSandbox({
    route: createRoute(null, ['BOEING_747']),
    ownedAircraft: createOwnedAircraft()
  });

  box.startRouteAircraftBulkOperation({
    mode: 'unassign',
    routeId: 'route-1',
    aircraftInstanceIds: ['aircraft-1']
  });

  assert.equal(box.emitted.length, 1);
  assert.equal(box.emitted[0].mode, 'unassign');
  assert.equal(box.pendingRouteAircraftUnassignAircraftInstanceId, '__BULK__');
});

test('remembered MODEL_EDIT_LOCKED deadline blocks a later bulk operation', () => {
  const box = createBulkOperationSandbox({
    route: createRoute(null),
    ownedAircraft: createOwnedAircraft()
  });

  box.rememberRouteAircraftModelEditLock({
    code: 'MODEL_EDIT_LOCKED',
    routeId: 'route-1',
    aircraftCatalogId: 'BOEING_747',
    lockedUntilRealMs: Date.now() + 5000
  });
  box.startRouteAircraftBulkOperation({
    mode: 'assign',
    routeId: 'route-1',
    aircraftInstanceIds: ['aircraft-1']
  });

  assert.equal(box.emitted.length, 0);
  assert.equal(box.routeAircraftBulkOperation, null);
  assert.equal(box.pendingRouteAircraftAssignAircraftInstanceId, null);
  assert.equal(box.refreshes.length, 1);
});

test('bulk dispatcher preserves the caller-selected quantity when no lock is known', () => {
  const box = createBulkOperationSandbox({
    route: createRoute(null),
    ownedAircraft: [
      { aircraftInstanceId: 'aircraft-1', aircraftCatalogId: 'BOEING_747' },
      { aircraftInstanceId: 'aircraft-2', aircraftCatalogId: 'BOEING_747' }
    ]
  });

  box.startRouteAircraftBulkOperation({
    mode: 'assign',
    routeId: 'route-1',
    aircraftInstanceIds: ['aircraft-1']
  });

  assert.equal(box.emitted.length, 1);
  assert.equal(Array.from(box.emitted[0].aircraftInstanceIds).join(','), 'aircraft-1');
});

function createBulkResultSandbox() {
  const sandbox = {
    Date,
    Map,
    Number,
    String,
    routeAircraftLearnedModelEditLocks: new Map(),
    routeAircraftManagementErrorMessage: '',
    routeAircraftManagementFeedbackKind: 'error'
  };
  const script = [
    'rememberRouteAircraftModelEditLock',
    'getRouteAircraftModelEditLocks',
    'getRouteAircraftManagementResultMessage',
    'setRouteAircraftBulkResultFeedback'
  ].map((name) => extractFunctionSource(GAME_SOURCE, name)).join('\n');

  vm.runInNewContext(script, sandbox);
  return sandbox;
}

for (const operation of ['assign', 'unassign']) {
  test(`bulk ${operation} MODEL_EDIT_LOCKED result remembers deadline and uses neutral feedback`, () => {
    const box = createBulkResultSandbox();
    const result = {
      success: false,
      code: 'MODEL_EDIT_LOCKED',
      routeId: 'route-1',
      aircraftCatalogId: 'BOEING_747',
      lockedUntilRealMs: Date.now() + 5000,
      message: 'Aircraft scheduling is temporarily locked while the route schedule stabilizes.'
    };

    box.rememberRouteAircraftModelEditLock(result);
    box.setRouteAircraftBulkResultFeedback(result, `Unable to ${operation} aircraft.`);

    assert.equal(box.routeAircraftManagementFeedbackKind, 'info');
    assert.equal(box.routeAircraftManagementErrorMessage, 'Roster updating — please try again shortly.');
    assert.equal(box.getRouteAircraftModelEditLocks(createRoute(null)).BOEING_747, result.lockedUntilRealMs);
    assert.notEqual(box.routeAircraftManagementFeedbackKind, 'success');

    const handlerStart = GAME_SOURCE.indexOf(`socket.on('route:aircraft:${operation}:bulk:result'`);
    const handlerEnd = GAME_SOURCE.indexOf("socket.on('", handlerStart + 1);
    const handlerSource = GAME_SOURCE.slice(handlerStart, handlerEnd);
    assert.match(handlerSource, /rememberRouteAircraftModelEditLock\(result\)/);
    assert.match(handlerSource, /setRouteAircraftBulkResultFeedback\(result,/);
    assert.match(handlerSource, /refreshRoutesModal\(gameState\.getState\(\)\)/);
  });
}

test('bulk result feedback keeps other failures red and successes successful', () => {
  const box = createBulkResultSandbox();

  box.setRouteAircraftBulkResultFeedback(
    { success: false, code: 'AIRCRAFT_NOT_AVAILABLE', message: 'Aircraft is not available.' },
    'Unable to assign aircraft.'
  );
  assert.equal(box.routeAircraftManagementFeedbackKind, 'error');
  assert.equal(box.routeAircraftManagementErrorMessage, 'Aircraft is not available. [AIRCRAFT_NOT_AVAILABLE]');

  box.setRouteAircraftBulkResultFeedback({ success: true }, 'Unable to assign aircraft.');
  assert.equal(box.routeAircraftManagementFeedbackKind, 'success');
  assert.equal(box.routeAircraftManagementErrorMessage, '');
});

test('neutral bulk feedback has dedicated non-error styling and rendering state', () => {
  assert.match(STYLE_SOURCE, /\.routes-aircraft-management-feedback--info\s*\{\s*color:\s*#[0-9a-fA-F]{6};\s*\}/);
  assert.match(GAME_SOURCE, /'routes-aircraft-management-feedback--info',\s*routeAircraftManagementFeedbackKind === 'info'/);
  assert.match(GAME_SOURCE, /routeAircraftManagementErrorMessage = '';\s*refreshRoutesModal\(gameState\.getState\(\)\)/);
});
const test = require('node:test');
const assert = require('node:assert/strict');

function createClassList() {
  return {
    values: new Set(),
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
    appendChild(node) {
      if (node && Array.isArray(node.children)) {
        this.children.push(...node.children);
      } else if (node) {
        this.children.push(node);
      }
    }
  };
}

function createMockDocument() {
  const elements = {
    mainContent: createMockElement(),
    connectionStatus: createMockElement(),
    lobbyPreview: createMockElement(),
    joinButton: createMockElement(),
    usernameInput: createMockElement(),
    statusText: createMockElement(),
    statusDots: createMockElement(),
    lobbyPlayerList: createMockElement(),
    statusMessage: createMockElement(),
    lobbyScreen: createMockElement(),
    gameScreen: createMockElement(),
    gameStatus: createMockElement(),
    leaderboard: createMockElement()
  };

  return {
    elements,
    querySelector(selector) {
      if (selector === '.main-content') {
        return elements.mainContent;
      }

      return null;
    },
    getElementById(id) {
      return elements[id];
    },
    createDocumentFragment() {
      return {
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

  return { renderer, elements: documentRef.elements };
}

test('renderer derives leaderboard from game players sorted by descending score', () => {
  const { renderer, elements } = createRendererUnderTest();
  const players = [
    { id: 'p1', username: 'Alice', capital: 1000000, score: 10 },
    { id: 'p2', username: 'Bob', capital: 2500000, score: 25 },
    { id: 'p3', username: 'Charlie', capital: 1000000, score: 10 },
    { id: 'p4', username: 'Dana', capital: 500000, score: 5 },
    { id: 'p5', username: 'Eli', capital: 1500000, score: 15 }
  ];

  const beforeOrder = players.map((player) => player.id);

  renderer.render({
    connection: { status: 'connected' },
    session: { joinPending: false, joined: true },
    lobby: { playerCount: 5, maxPlayers: 5, players: [], status: 'waiting', countdownSeconds: null },
    ui: { errorMessage: null, screen: 'game' },
    game: {
      id: 'game-1',
      status: 'active',
      createdAt: 123,
      players,
      airports: []
    },
    waitingAnimation: { step: 0 }
  });

  const rendered = elements.leaderboard.children.map((item) => item.textContent);

  assert.equal(rendered.length, 5);
  assert.deepEqual(rendered, [
    'Bob — 25',
    'Eli — 15',
    'Alice — 10',
    'Charlie — 10',
    'Dana — 5'
  ]);

  assert.deepEqual(players.map((player) => player.id), beforeOrder);

  delete global.window;
});

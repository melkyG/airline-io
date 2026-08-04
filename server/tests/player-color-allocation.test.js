const test = require('node:test');
const assert = require('node:assert/strict');
const GameManager = require('../GameManager');
const { PLAYER_COLOR_CATALOG } = require('../colors/palette');

function createIoCapture() {
  const emitted = [];
  const io = {
    to(roomName) {
      return {
        emit(eventName, payload) {
          emitted.push({ roomName, eventName, payload });
        }
      };
    }
  };

  return { io, emitted };
}

function createSocket(id) {
  return {
    id,
    connected: true,
    joinedRooms: new Set(),
    join(roomName) {
      this.joinedRooms.add(roomName);
    },
    leave(roomName) {
      this.joinedRooms.delete(roomName);
    }
  };
}

test('lobby colors are requested when available, fall back deterministically, and release on leave', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);

  const aliceSocket = createSocket('socket-alice');
  const bobSocket = createSocket('socket-bob');
  const carolSocket = createSocket('socket-carol');
  const daveSocket = createSocket('socket-dave');

  manager.registerConnection(aliceSocket);
  manager.registerConnection(bobSocket);
  manager.registerConnection(carolSocket);
  manager.registerConnection(daveSocket);

  const aliceJoinResult = manager.assignPlayerToLobby(aliceSocket.id, 'Alice', 'violet');
  assert.equal(aliceJoinResult.success, true);
  const lobby = aliceJoinResult.lobby;
  const lobbySnapshot = lobby.getPublicState();
  assert.equal(aliceJoinResult.lobby.players.get(aliceSocket.id).colorId, 'violet');
  assert.equal(aliceJoinResult.lobby.players.get(aliceSocket.id).colorHex, '#8b5cf6');
  assert.equal(Array.isArray(lobbySnapshot.palette), true);
  assert.equal(Array.isArray(lobbySnapshot.availableColorIds), true);
  assert.equal(lobbySnapshot.players.some((player) => player.id === aliceSocket.id), true);

  const bobJoinResult = manager.assignPlayerToLobby(bobSocket.id, 'Bob', 'violet');
  assert.equal(bobJoinResult.success, true);
  assert.equal(bobJoinResult.lobby.id, lobby.id);
  assert.equal(bobJoinResult.lobby.players.get(bobSocket.id).colorId, 'red');
  assert.equal(bobJoinResult.lobby.players.get(bobSocket.id).colorHex, '#ef4444');

  const leaveResult = manager.leaveLobby(aliceSocket.id);
  assert.equal(leaveResult.success, true);
  assert.equal(manager.players.get(aliceSocket.id).colorId, null);
  assert.equal(lobby.colorAssignments.has('violet'), false);

  const carolJoinResult = manager.assignPlayerToLobby(carolSocket.id, 'Carol', 'violet');
  assert.equal(carolJoinResult.success, true);
  assert.equal(carolJoinResult.lobby.id, lobby.id);
  assert.equal(carolJoinResult.lobby.players.get(carolSocket.id).colorId, 'violet');

  const otherLobby = manager.createLobby();
  const davePlayer = manager.createPlayer(daveSocket, 'Dave');
  assert.equal(manager.addPlayerToLobby(otherLobby, davePlayer, 'violet'), true);
  assert.equal(davePlayer.colorId, 'violet');
  assert.equal(otherLobby.colorAssignments.get('violet'), davePlayer.id);

  assert.equal(PLAYER_COLOR_CATALOG.length >= 15, true);

  manager.shutdown();
});

test('lobby color requests reassign in waiting lobbies and reject after game start', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);

  const sockets = Array.from({ length: 5 }, (_, index) => createSocket(`socket-${index + 1}`));
  sockets.forEach((socket) => manager.registerConnection(socket));

  const joinResults = [
    manager.assignPlayerToLobby(sockets[0].id, 'Alice', 'red'),
    manager.assignPlayerToLobby(sockets[1].id, 'Bob', 'orange'),
    manager.assignPlayerToLobby(sockets[2].id, 'Carol', 'amber'),
    manager.assignPlayerToLobby(sockets[3].id, 'Dave', 'yellow'),
    manager.assignPlayerToLobby(sockets[4].id, 'Eve', 'lime')
  ];

  joinResults.forEach((result) => {
    assert.equal(result.success, true);
  });

  const lobby = joinResults[0].lobby;
  const alice = manager.players.get(sockets[0].id);
  const bob = manager.players.get(sockets[1].id);

  const unavailableResult = manager.requestLobbyPlayerColor(alice.id, 'orange');
  assert.equal(unavailableResult.success, false);
  assert.equal(unavailableResult.code, 'COLOR_UNAVAILABLE');
  assert.equal(unavailableResult.playerId, alice.id);
  assert.equal(Array.isArray(unavailableResult.availableColorIds), true);
  assert.equal(alice.colorId, 'red');
  assert.equal(lobby.colorAssignments.get('red'), alice.id);
  assert.equal(lobby.colorAssignments.get('orange'), bob.id);

  const reassignedResult = manager.requestLobbyPlayerColor(alice.id, 'sky');
  assert.equal(reassignedResult.success, true);
  assert.equal(reassignedResult.colorId, 'sky');
  assert.equal(reassignedResult.colorHex, '#0ea5e9');
  assert.equal(reassignedResult.playerId, alice.id);
  assert.equal(Array.isArray(reassignedResult.availableColorIds), true);
  assert.equal(reassignedResult.availableColorIds.includes('red'), true);
  assert.equal(reassignedResult.availableColorIds.includes('sky'), false);
  assert.equal(alice.colorId, 'sky');
  assert.equal(lobby.colorAssignments.get('sky'), alice.id);
  assert.equal(lobby.colorAssignments.has('red'), false);

  const game = manager.convertLobbyToGame(lobby.id);
  assert.ok(game);

  const postStartResult = manager.requestLobbyPlayerColor(alice.id, 'violet');
  assert.equal(postStartResult.success, false);
  assert.equal(postStartResult.code, 'GAME_ALREADY_STARTED');
  assert.equal(postStartResult.playerId, alice.id);
  assert.equal(Array.isArray(postStartResult.availableColorIds), true);
  assert.equal(postStartResult.availableColorIds.length, 0);

  manager.shutdown();
});
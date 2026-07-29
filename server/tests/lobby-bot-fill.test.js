const test = require('node:test');
const assert = require('node:assert/strict');
const GameManager = require('../GameManager');

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

test('handleLobbyBotFillRequest fills remaining lobby slots with server-side bots', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const socket = createSocket('socket-1');

  manager.registerConnection(socket);
  const joinedResult = manager.assignPlayerToLobby(socket.id, 'Alice');
  assert.equal(joinedResult.success, true);

  const lobby = joinedResult.lobby;
  assert.equal(lobby.players.size, 1);

  const fillResult = manager.handleLobbyBotFillRequest(socket.id);

  assert.equal(fillResult.success, true);
  assert.equal(fillResult.code, 'OK');
  assert.equal(fillResult.addedCount, 4);
  assert.equal(lobby.players.size, 5);

  const lobbyPlayers = Array.from(lobby.players.values());
  const realPlayers = lobbyPlayers.filter((player) => !player.isBot);
  const botPlayers = lobbyPlayers.filter((player) => player.isBot);

  assert.equal(realPlayers.length, 1);
  assert.equal(botPlayers.length, 4);
  assert.equal(realPlayers[0].id, 'socket-1');

  botPlayers.forEach((player) => {
    assert.match(player.id, /^bot-/);
    assert.equal(player.connected, true);
    assert.equal(player.socket, null);
  });

  const botNames = botPlayers.map((player) => player.displayName);
  assert.equal(new Set(botNames).size, botNames.length);

  const publicSnapshot = lobby.getPublicState();
  assert.equal(publicSnapshot.playerCount, 5);
  assert.equal(publicSnapshot.players.filter((player) => player.isBot).length, 4);

  manager.shutdown();
});

test('handleLobbyBotFillRequest enforces waiting/full/processing validations', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const socket = createSocket('socket-2');

  manager.registerConnection(socket);
  const joinedResult = manager.assignPlayerToLobby(socket.id, 'Bob');
  assert.equal(joinedResult.success, true);

  const lobby = joinedResult.lobby;

  lobby.botFillInProgress = true;
  let result = manager.handleLobbyBotFillRequest(socket.id);
  assert.equal(result.success, false);
  assert.equal(result.code, 'BOT_FILL_BUSY');

  lobby.botFillInProgress = false;
  lobby.status = 'countdown';
  result = manager.handleLobbyBotFillRequest(socket.id);
  assert.equal(result.success, false);
  assert.equal(result.code, 'LOBBY_NOT_WAITING');

  lobby.status = 'waiting';
  lobby.maxPlayers = lobby.players.size;
  result = manager.handleLobbyBotFillRequest(socket.id);
  assert.equal(result.success, false);
  assert.equal(result.code, 'LOBBY_FULL');

  manager.shutdown();
});

test('leaving a waiting lobby with only bots remaining destroys the lobby and purges bots', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const socket = createSocket('socket-leave');

  manager.registerConnection(socket);
  const joinedResult = manager.assignPlayerToLobby(socket.id, 'Alice');
  assert.equal(joinedResult.success, true);

  const lobby = joinedResult.lobby;
  const lobbyId = lobby.id;

  const fillResult = manager.handleLobbyBotFillRequest(socket.id);
  assert.equal(fillResult.success, true);
  assert.equal(lobby.players.size, 5);
  assert.equal(manager.getLobbyRealPlayerCount(lobby), 1);

  const leaveResult = manager.leaveLobby(socket.id);
  assert.equal(leaveResult.success, true);

  assert.equal(manager.lobbies.has(lobbyId), false);
  assert.equal(lobby.players.size, 0);
  assert.equal(lobby.countdownInterval, null);
  assert.equal(lobby.botFillInProgress, false);

  const remainingBotPlayers = Array.from(manager.players.values()).filter((player) => player && player.isBot);
  assert.equal(remainingBotPlayers.length, 0);

  manager.shutdown();
});

test('disconnecting from waiting lobby with only bots remaining destroys the lobby and purges bots', () => {
  const { io } = createIoCapture();
  const manager = new GameManager(io);
  const socket = createSocket('socket-disconnect');

  manager.registerConnection(socket);
  const joinedResult = manager.assignPlayerToLobby(socket.id, 'Bob');
  assert.equal(joinedResult.success, true);

  const lobby = joinedResult.lobby;
  const lobbyId = lobby.id;

  const fillResult = manager.handleLobbyBotFillRequest(socket.id);
  assert.equal(fillResult.success, true);
  assert.equal(manager.getLobbyRealPlayerCount(lobby), 1);

  manager.handleDisconnect(socket.id);

  assert.equal(manager.lobbies.has(lobbyId), false);
  assert.equal(lobby.players.size, 0);
  assert.equal(lobby.countdownInterval, null);
  assert.equal(lobby.botFillInProgress, false);

  const remainingBotPlayers = Array.from(manager.players.values()).filter((player) => player && player.isBot);
  assert.equal(remainingBotPlayers.length, 0);

  manager.shutdown();
});

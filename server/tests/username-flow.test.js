const test = require('node:test');
const assert = require('node:assert/strict');
const Lobby = require('../Lobby');

test('addPlayer preserves a custom display name', () => {
  const manager = {
    broadcastLobbyPreviews() {},
    io: {
      to() {
        return {
          emit() {}
        };
      }
    }
  };

  const lobby = new Lobby('lobby-1', manager);
  const player = {
    id: 'player-1',
    displayName: 'Alice',
    lobbyId: null,
    connected: true,
    socket: {
      connected: true,
      leave() {}
    },
    setDisplayName(name) {
      this.displayName = name;
    },
    getPublicState() {
      return {
        id: this.id,
        displayName: this.displayName,
        connected: this.connected
      };
    }
  };

  const added = lobby.addPlayer(player);

  assert.equal(added, true);
  assert.equal(player.displayName, 'Alice');
  assert.equal(player.lobbyId, 'lobby-1');
});

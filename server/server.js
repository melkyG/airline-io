const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./GameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const gameManager = new GameManager(io);

app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

io.on('connection', (socket) => {
  gameManager.registerConnection(socket);

  socket.emit('connection:ready', { playerId: socket.id });
  gameManager.broadcastLobbyPreviews();

  socket.on('lobby:join', (payload = {}) => {
    const result = gameManager.assignPlayerToLobby(socket.id, payload.username);
    if (!result.success) {
      socket.emit('lobby:error', { message: result.message });
    }
  });

  socket.on('lobby:leave', () => {
    const result = gameManager.leaveLobby(socket.id);
    if (!result.success) {
      socket.emit('lobby:error', { message: result.message });
    }
  });

  socket.on('disconnect', () => {
    gameManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

// Render deployment will use process.env.PORT.
// Additional Render configuration will be added later.

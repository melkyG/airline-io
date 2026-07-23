const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./GameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const gameManager = new GameManager(io);
const clientDir = path.resolve(__dirname, '..', 'client');

app.use(express.static(clientDir));
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
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

  socket.on('dev:score:add', () => {
    gameManager.handleDeveloperScoreRequest(socket.id, 500);
  });

  socket.on('disconnect', () => {
    gameManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

server.listen(PORT, HOST, () => {
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Port: ${PORT}`);
  console.log(`Server started on ${HOST}:${PORT}`);
});

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully...`);

  gameManager.shutdown();
  io.close();

  server.close((error) => {
    if (error) {
      console.error('Shutdown error:', error);
      process.exit(1);
      return;
    }

    console.log('HTTP and Socket.IO server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

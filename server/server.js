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
    const result = gameManager.assignPlayerToLobby(socket.id, payload.username, payload.preferredColorId);
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

  socket.on('game:leave', () => {
    const result = gameManager.leaveGame(socket.id);
    if (!result.success) {
      socket.emit('lobby:error', { message: result.message });
    }
  });

  socket.on('lobby:bot-fill', () => {
    const result = gameManager.handleLobbyBotFillRequest(socket.id);
    socket.emit('lobby:bot-fill:result', result);
    if (!result.success) {
      socket.emit('lobby:error', { message: result.message });
    }
  });

  socket.on('lobby:color:request', (payload = {}) => {
    const result = gameManager.requestLobbyPlayerColor(socket.id, payload.colorId);
    socket.emit('lobby:color:result', result);
    if (!result.success && result.message) {
      socket.emit('lobby:error', { message: result.message });
    }
  });

  socket.on('dev:score:add', () => {
    gameManager.handleDeveloperScoreRequest(socket.id, 500);
  });

  socket.on('airport:purchase:request', (payload = {}) => {
    const result = gameManager.handleAirportPurchaseSocketRequest(socket.id, payload);
    socket.emit('airport:purchase:result', result);
  });

  socket.on('airport:list:request', (payload = {}) => {
    const result = gameManager.handleAirportListingSocketRequest(socket.id, payload);
    socket.emit('airport:list:result', result);
  });

  socket.on('airport:listing:cancel:request', (payload = {}) => {
    const result = gameManager.handleAirportListingCancelSocketRequest(socket.id, payload);
    socket.emit('airport:listing:cancel:result', result);
  });

  socket.on('airport:purchase-listed:request', (payload = {}) => {
    const result = gameManager.handleAirportListedPurchaseSocketRequest(socket.id, payload);
    socket.emit('airport:purchase-listed:result', result);
  });

  socket.on('airport:sell-to-game:request', (payload = {}) => {
    const result = gameManager.handleAirportSellToGameSocketRequest(socket.id, payload);
    socket.emit('airport:sell-to-game:result', result);
  });

  socket.on('route:create:request', (payload = {}) => {
    const result = gameManager.handleRouteCreateSocketRequest(socket.id, payload);
    socket.emit('route:create:result', result);
  });

  socket.on('route:remove:request', (payload = {}) => {
    const result = gameManager.handleRouteRemoveSocketRequest(socket.id, payload);
    socket.emit('route:remove:result', result);
  });

  socket.on('route:aircraft:assign:request', (payload = {}) => {
    const result = gameManager.handleRouteAircraftAssignSocketRequest(socket.id, payload);
    socket.emit('route:aircraft:assign:result', result);
  });

  socket.on('route:aircraft:unassign:request', (payload = {}) => {
    const result = gameManager.handleRouteAircraftUnassignSocketRequest(socket.id, payload);
    socket.emit('route:aircraft:unassign:result', result);
  });

  socket.on('aircraft:purchase:request', (payload = {}) => {
    const result = gameManager.handleAircraftPurchaseSocketRequest(socket.id, payload);
    socket.emit('aircraft:purchase:result', result);
  });

  socket.on('aircraft:sell:request', (payload = {}) => {
    const result = gameManager.handleAircraftSellSocketRequest(socket.id, payload);
    socket.emit('aircraft:sell:result', result);
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

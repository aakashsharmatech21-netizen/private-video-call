const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {};

io.on('connection', (socket) => {
  socket.on('chat-message', ({ roomId, message }) => {
  socket.to(roomId).emit('chat-message', message);
});

  socket.on('join-room', (roomId) => {
    if (!rooms[roomId]) rooms[roomId] = [];

    // Remove stale/disconnected sockets from room
    rooms[roomId] = rooms[roomId].filter(id => io.sockets.sockets.has(id));

    if (rooms[roomId].length >= 2) {
      socket.emit('room-full');
      return;
    }

    rooms[roomId].push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;

    const isInitiator = rooms[roomId].length === 2;
    socket.emit('joined', { isInitiator });

    if (isInitiator) {
      socket.to(roomId).emit('user-joined');
    }
  });

  socket.on('offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('offer', offer);
  });

  socket.on('answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('answer', answer);
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', candidate);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      socket.to(roomId).emit('user-left');
      if (rooms[roomId].length === 0) delete rooms[roomId];
    }
  });
});

server.listen(5000, () => console.log('Server running on port 5000'));
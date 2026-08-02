import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createRoom, joinRoom, leaveRoom, getRoomBySocket,
  startGame, handleGameAction, getLobbyState, getGameState,
  broadcastGame, startBotLoop,
} from './server/rooms.js';
import { PHASE } from './js/game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

app.use(express.static(__dirname));

app.get('/health', (_, res) => res.json({ ok: true }));

io.on('connection', (socket) => {
  socket.on('create-room', ({ name, maxPlayers }, cb) => {
    const room = createRoom(socket.id, name || 'Игрок', maxPlayers || 4);
    socket.join(room.code);
    cb?.({ ok: true, lobby: getLobbyState(room) });
    io.to(room.code).emit('lobby-update', getLobbyState(room));
  });

  socket.on('join-room', ({ code, name }, cb) => {
    const result = joinRoom(code, socket.id, name || 'Игрок');
    if (result.error) return cb?.({ ok: false, error: result.error });

    socket.join(result.room.code);
    cb?.({ ok: true, lobby: getLobbyState(result.room) });
    io.to(result.room.code).emit('lobby-update', getLobbyState(result.room));
  });

  socket.on('start-game', (cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });

    const result = startGame(room.code, socket.id);
    if (result.error) return cb?.({ ok: false, error: result.error });

    for (const member of room.members) {
      io.to(member.socketId).emit('game-start', getGameState(room, member.socketId));
    }

    cb?.({ ok: true });
    startBotLoop(room, io);
  });

  socket.on('game-action', (action, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !room.game) return cb?.({ ok: false, error: 'Игра не найдена' });

    const result = handleGameAction(room, socket.id, action);
    if (result.error) return cb?.({ ok: false, error: result.error });

    broadcastGame(room, io, room.code);
    cb?.({ ok: true });

    if (room.game.phase !== PHASE.GAME_OVER) {
      startBotLoop(room, io);
    }
  });

  socket.on('leave-room', () => {
    handleLeave(socket);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const result = leaveRoom(socket.id);
  if (!result) return;

  if (result.deleted) {
    io.to(result.code).emit('room-closed');
    return;
  }

  io.to(result.code).emit('lobby-update', getLobbyState(result.room));
}

httpServer.listen(PORT, () => {
  console.log(`💰 Капиталист онлайн: http://localhost:${PORT}`);
});

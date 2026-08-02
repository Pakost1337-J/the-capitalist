import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createRoom, joinRoom, leaveRoom, getRoomBySocket,
  startGame, handleGameAction, getLobbyState, getGameState,
  broadcastGame, startBotLoop, listPublicRooms, scheduleAuctionEnd, scheduleRentEnd, scheduleTurnTimers,
} from './server/rooms.js';
import { PHASE } from './js/game.js';
import { getCustomPayload, saveCustom, resetCustom } from './server/customize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));
app.use('/assets', express.static(join(__dirname, 'assets')));

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/api/theme', (_, res) => {
  res.json(getCustomPayload());
});

app.post('/api/theme', (req, res) => {
  try {
    const saved = saveCustom(req.body || {});
    io.emit('theme-update', saved);
    res.json({ ok: true, theme: saved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/theme/reset', (_, res) => {
  try {
    const theme = resetCustom();
    io.emit('theme-update', theme);
    res.json({ ok: true, theme });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function getOnlineCount() {
  return io.engine.clientsCount || 0;
}

function broadcastServerInfo() {
  io.emit('server-info', {
    online: getOnlineCount(),
    rooms: listPublicRooms(),
  });
}

io.on('connection', (socket) => {
  broadcastServerInfo();

  socket.on('get-server-info', (cb) => {
    const payload = {
      online: getOnlineCount(),
      rooms: listPublicRooms(),
    };
    cb?.(payload);
    socket.emit('server-info', payload);
  });

  socket.on('create-room', ({ name, maxPlayers }, cb) => {
    if (getRoomBySocket(socket.id)) {
      return cb?.({ ok: false, error: 'Сначала выйдите из текущей комнаты' });
    }

    const room = createRoom(socket.id, name || 'Игрок', maxPlayers || 4);
    socket.join(room.id);
    cb?.({ ok: true, lobby: getLobbyState(room) });
    io.to(room.id).emit('lobby-update', getLobbyState(room));
    broadcastServerInfo();
  });

  socket.on('join-room', ({ id, name }, cb) => {
    if (getRoomBySocket(socket.id)) {
      return cb?.({ ok: false, error: 'Сначала выйдите из текущей комнаты' });
    }

    const result = joinRoom(id, socket.id, name || 'Игрок');
    if (result.error) return cb?.({ ok: false, error: result.error });

    socket.join(result.room.id);
    cb?.({ ok: true, lobby: getLobbyState(result.room) });
    io.to(result.room.id).emit('lobby-update', getLobbyState(result.room));
    broadcastServerInfo();
  });

  socket.on('start-game', (data, cb) => {
    if (typeof data === 'function') {
      cb = data;
      data = {};
    }
    try {
      const room = getRoomBySocket(socket.id);
      if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });

      const result = startGame(room.id, socket.id);
      if (result.error) return cb?.({ ok: false, error: result.error });

      for (const member of room.members) {
        io.to(member.socketId).emit('game-start', getGameState(room, member.socketId));
      }

      cb?.({ ok: true });
      broadcastServerInfo();
      scheduleTurnTimers(room, io);
      startBotLoop(room, io);
    } catch (err) {
      console.error('start-game error:', err);
      cb?.({ ok: false, error: 'Ошибка запуска: ' + err.message });
    }
  });

  socket.on('game-action', (action, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !room.game) return cb?.({ ok: false, error: 'Игра не найдена' });

    const result = handleGameAction(room, socket.id, action);
    if (!result?.ok) return cb?.({ ok: false, error: result?.error || 'Ошибка' });

    if (room.game.phase === PHASE.AUCTION) {
      scheduleAuctionEnd(room, io);
    }
    // всегда: либо ставит таймер долга, либо снимает старый
    scheduleRentEnd(room, io);
    scheduleTurnTimers(room, io);

    broadcastGame(room, io);
    cb?.({ ok: true });

    if (room.game.phase === PHASE.GAME_OVER) {
      broadcastServerInfo();
    } else {
      startBotLoop(room, io);
    }
  });

  socket.on('chat', ({ text }) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const member = room.members.find(m => m.socketId === socket.id);
    const clean = String(text || '').trim().slice(0, 120);
    if (!clean) return;
    io.to(room.id).emit('chat-message', {
      from: socket.id,
      name: member?.name || 'Игрок',
      text: clean,
    });
  });

  socket.on('leave-room', () => {
    handleLeave(socket);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
    broadcastServerInfo();
  });
});

function handleLeave(socket) {
  const result = leaveRoom(socket.id);
  if (!result) {
    broadcastServerInfo();
    return;
  }

  if (result.deleted) {
    io.to(result.id).emit('room-closed');
  } else {
    io.to(result.id).emit('lobby-update', getLobbyState(result.room));
  }

  broadcastServerInfo();
}

httpServer.listen(PORT, () => {
  console.log(`💰 Капиталист онлайн: http://localhost:${PORT}`);
});

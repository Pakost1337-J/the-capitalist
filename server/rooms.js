import { createGame } from '../js/game.js';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_SLOTS } from '../js/config.js';
import { processBotChain } from './bot.js';

const rooms = new Map();
let roomSeq = 0;

function genRoomId() {
  roomSeq += 1;
  return `r${Date.now().toString(36)}${roomSeq}`;
}

export function createRoom(hostSocketId, hostName, maxPlayers = 4) {
  const id = genRoomId();
  const name = (hostName || 'Игрок').slice(0, 20);
  const room = {
    id,
    name: `Стол ${name}`,
    hostSocketId,
    maxPlayers: Math.min(Math.max(Number(maxPlayers) || 4, MIN_PLAYERS), MAX_PLAYERS),
    status: 'lobby',
    members: [{
      socketId: hostSocketId,
      name,
      slot: 0,
      isHost: true,
    }],
    game: null,
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(id) {
  return rooms.get(id);
}

export function joinRoom(id, socketId, name) {
  const room = getRoom(id);
  if (!room) return { error: 'Комната не найдена' };
  if (room.status !== 'lobby') return { error: 'Игра уже началась' };
  if (room.members.length >= room.maxPlayers) return { error: 'Комната заполнена' };
  if (room.members.some(m => m.socketId === socketId)) return { error: 'Вы уже в комнате' };

  const usedSlots = room.members.map(m => m.slot);
  const slot = PLAYER_SLOTS.find(s => !usedSlots.includes(s.id))?.id ?? room.members.length;

  room.members.push({
    socketId,
    name: (name || 'Игрок').slice(0, 20),
    slot,
    isHost: false,
  });

  return { room };
}

export function leaveRoom(socketId) {
  for (const [id, room] of rooms) {
    const idx = room.members.findIndex(m => m.socketId === socketId);
    if (idx === -1) continue;

    room.members.splice(idx, 1);

    if (room.members.length === 0) {
      rooms.delete(id);
      return { deleted: true, id };
    }

    if (room.hostSocketId === socketId) {
      room.hostSocketId = room.members[0].socketId;
      room.members[0].isHost = true;
      room.name = `Стол ${room.members[0].name}`;
    }

    return { room, id };
  }
  return null;
}

export function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.members.some(m => m.socketId === socketId)) return room;
  }
  return null;
}

export function startGame(id, socketId) {
  const room = getRoom(id);
  if (!room) return { error: 'Комната не найдена' };
  if (room.hostSocketId !== socketId) return { error: 'Только хост может начать игру' };
  if (room.members.length < MIN_PLAYERS) return { error: 'Нет игроков для старта' };
  if (room.status !== 'lobby') return { error: 'Игра уже началась' };

  const playerConfigs = [];
  for (let slot = 0; slot < room.maxPlayers; slot++) {
    const member = room.members.find(m => m.slot === slot);
    if (member) {
      playerConfigs.push({ name: member.name, socketId: member.socketId, isBot: false });
    } else {
      playerConfigs.push({ name: `Бот ${slot + 1}`, socketId: null, isBot: true });
    }
  }

  const game = createGame(playerConfigs);
  game.addLog('🎲 Игра началась!');
  game.addLog(`— Ход: ${game.currentPlayer.name} —`);

  room.game = game;
  room.status = 'playing';

  return { room };
}

export function handleGameAction(room, socketId, action) {
  const member = room.members.find(m => m.socketId === socketId);
  if (!member) return { error: 'Вы не в этой комнате' };

  const result = room.game.applyAction(action, member.slot);
  return result;
}

export function getLobbyState(room) {
  return {
    id: room.id,
    name: room.name,
    status: room.status,
    maxPlayers: room.maxPlayers,
    hostSocketId: room.hostSocketId,
    members: room.members.map(m => ({
      name: m.name,
      slot: m.slot,
      isHost: m.isHost,
      token: PLAYER_SLOTS[m.slot]?.token,
      color: PLAYER_SLOTS[m.slot]?.color,
    })),
  };
}

export function listPublicRooms() {
  return [...rooms.values()].map(room => ({
    id: room.id,
    name: room.name,
    status: room.status,
    players: room.members.length,
    maxPlayers: room.maxPlayers,
    hostName: room.members.find(m => m.isHost)?.name || room.members[0]?.name || '—',
    canJoin: room.status === 'lobby' && room.members.length < room.maxPlayers,
  })).sort((a, b) => {
    if (a.canJoin !== b.canJoin) return a.canJoin ? -1 : 1;
    return b.players - a.players;
  });
}

export function getGameState(room, socketId) {
  const member = room.members.find(m => m.socketId === socketId);
  const state = room.game.getState();
  return {
    ...state,
    roomId: room.id,
    roomName: room.name,
    mySlot: member?.slot ?? null,
    isMyTurn: member && state.players[state.currentPlayerIndex]?.id === member.slot,
  };
}

export function broadcastGame(room, io) {
  for (const member of room.members) {
    io.to(member.socketId).emit('game-state', getGameState(room, member.socketId));
  }
}

export function startBotLoop(room, io) {
  processBotChain(room.game, () => broadcastGame(room, io));
}

export function findMemberSlot(room, socketId) {
  return room.members.find(m => m.socketId === socketId)?.slot ?? null;
}

import { createGame } from '../js/game.js';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_SLOTS } from '../js/config.js';
import { processBotChain } from './bot.js';

const rooms = new Map();

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genRoomCode() : code;
}

export function createRoom(hostSocketId, hostName, maxPlayers = 4) {
  const code = genRoomCode();
  const room = {
    code,
    hostSocketId,
    maxPlayers: Math.min(Math.max(maxPlayers, MIN_PLAYERS), MAX_PLAYERS),
    status: 'lobby',
    members: [{
      socketId: hostSocketId,
      name: hostName.slice(0, 20),
      slot: 0,
      isHost: true,
    }],
    game: null,
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

export function joinRoom(code, socketId, name) {
  const room = getRoom(code);
  if (!room) return { error: 'Комната не найдена' };
  if (room.status !== 'lobby') return { error: 'Игра уже началась' };
  if (room.members.length >= room.maxPlayers) return { error: 'Комната заполнена' };
  if (room.members.some(m => m.socketId === socketId)) return { error: 'Вы уже в комнате' };

  const usedSlots = room.members.map(m => m.slot);
  const slot = PLAYER_SLOTS.find(s => !usedSlots.includes(s.id))?.id ?? room.members.length;

  room.members.push({
    socketId,
    name: name.slice(0, 20),
    slot,
    isHost: false,
  });

  return { room };
}

export function leaveRoom(socketId) {
  for (const [code, room] of rooms) {
    const idx = room.members.findIndex(m => m.socketId === socketId);
    if (idx === -1) continue;

    room.members.splice(idx, 1);

    if (room.members.length === 0) {
      rooms.delete(code);
      return { deleted: true, code };
    }

    if (room.hostSocketId === socketId) {
      room.hostSocketId = room.members[0].socketId;
      room.members[0].isHost = true;
    }

    return { room, code };
  }
  return null;
}

export function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.members.some(m => m.socketId === socketId)) return room;
  }
  return null;
}

export function startGame(code, socketId) {
  const room = getRoom(code);
  if (!room) return { error: 'Комната не найдена' };
  if (room.hostSocketId !== socketId) return { error: 'Только хост может начать игру' };
  if (room.members.length < MIN_PLAYERS) return { error: `Минимум ${MIN_PLAYERS} игрока` };
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
    code: room.code,
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

export function getGameState(room, socketId) {
  const member = room.members.find(m => m.socketId === socketId);
  const state = room.game.getState();
  return {
    ...state,
    roomCode: room.code,
    mySlot: member?.slot ?? null,
    isMyTurn: member && state.players[state.currentPlayerIndex]?.id === member.slot,
  };
}

export function broadcastGame(room, io, roomCode) {
  for (const member of room.members) {
    io.to(member.socketId).emit('game-state', getGameState(room, member.socketId));
  }
}

export function startBotLoop(room, io) {
  processBotChain(room.game, () => broadcastGame(room, io, room.code));
}

export function findMemberSlot(room, socketId) {
  return room.members.find(m => m.socketId === socketId)?.slot ?? null;
}

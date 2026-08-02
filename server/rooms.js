import { createGame } from '../js/game.js';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_SLOTS } from '../js/config.js';
import { pickBotNames } from '../js/names.js';
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

  const usedNames = room.members.map(m => m.name);
  const botSlots = [];
  for (let slot = 0; slot < room.maxPlayers; slot++) {
    if (!room.members.find(m => m.slot === slot)) botSlots.push(slot);
  }
  const botNames = pickBotNames(botSlots.length, usedNames);
  let botIdx = 0;

  const playerConfigs = [];
  for (let slot = 0; slot < room.maxPlayers; slot++) {
    const member = room.members.find(m => m.slot === slot);
    if (member) {
      playerConfigs.push({ name: member.name, socketId: member.socketId, isBot: false });
    } else {
      const botName = botNames[botIdx++] || 'Гость';
      playerConfigs.push({ name: `Бот - ${botName}`, socketId: null, isBot: true });
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
      chipName: PLAYER_SLOTS[m.slot]?.name,
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
  const me = member != null ? state.players[member.slot] : null;
  const isAuction = state.phase === 'auction';
  const deal = state.deal;
  const isDealParty = !!(deal && member && (deal.toId === member.slot || deal.fromId === member.slot));
  return {
    ...state,
    roomId: room.id,
    roomName: room.name,
    mySlot: member?.slot ?? null,
    isMyTurn: member && (
      isAuction
        ? !!(me && !me.bankrupt)
        : state.players[state.currentPlayerIndex]?.id === member.slot
    ),
    canRespondDeal: !!(deal && member && deal.toId === member.slot),
    isDealParty,
    canAuctionBid: !!(isAuction && me && !me.bankrupt && room.game.canPlayerAuctionBid?.(member.slot)),
    canAuctionLeave: !!(isAuction && me && !me.bankrupt
      && state.auction?.startedBy !== member.slot
      && state.auction?.highBidder !== member.slot
      && !(state.auction?.optedOut || []).includes(member.slot)),
    auctionSpectator: !!(isAuction && me && state.auction?.startedBy === member.slot),
    nextAuctionPrice: room.game.nextAuctionPrice?.() ?? null,
    dealableCompanies: room.game.dealableCompanies?.(member?.slot) || [],
    myTradeableCompanies: room.game.ownedTradeable?.(member?.slot) || [],
  };
}

export function scheduleAuctionEnd(room, io) {
  if (room._auctionTimer) {
    clearTimeout(room._auctionTimer);
    room._auctionTimer = null;
  }
  const auction = room.game?.auction;
  if (!auction || room.game.phase !== 'auction') return;

  const delay = Math.max(200, (auction.endsAt || Date.now()) - Date.now());
  room._auctionTimer = setTimeout(() => {
    room._auctionTimer = null;
    if (!room.game || room.game.phase !== 'auction') return;
    room.game.finishAuction();
    broadcastGame(room, io);
    startBotLoop(room, io);
  }, delay);
}

/** Таймер панелей buy / rent (1 мин) */
export function scheduleRentEnd(room, io) {
  if (room._rentTimer) {
    clearTimeout(room._rentTimer);
    room._rentTimer = null;
  }
  const pa = room.game?.pendingAction;
  if (!pa || room.game.phase !== 'action') return;
  if (pa.type !== 'rent' && pa.type !== 'buy' && pa.type !== 'tax' && pa.type !== 'force') return;

  const delay = Math.max(200, (pa.endsAt || Date.now()) - Date.now());
  const kind = pa.type;
  room._rentTimer = setTimeout(() => {
    room._rentTimer = null;
    if (!room.game || room.game.phase !== 'action') return;
    if (room.game.pendingAction?.type !== kind) return;
    if (kind === 'rent' || kind === 'tax' || kind === 'force') room.game.finishRentDebt();
    else if (kind === 'buy') room.game.finishBuyOffer();
    if (room.game.phase === 'auction') scheduleAuctionEnd(room, io);
    scheduleTurnTimers(room, io);
    broadcastGame(room, io);
    startBotLoop(room, io);
  }, delay);
}

/** Таймер хода (бросок) и ответа на сделку */
export function scheduleTurnTimers(room, io) {
  if (room._turnTimer) {
    clearTimeout(room._turnTimer);
    room._turnTimer = null;
  }
  if (room._dealTimer) {
    clearTimeout(room._dealTimer);
    room._dealTimer = null;
  }
  const game = room.game;
  if (!game) return;

  if (game.deal) {
    const delay = Math.max(200, (game.deal.endsAt || Date.now()) - Date.now());
    room._dealTimer = setTimeout(() => {
      room._dealTimer = null;
      if (!room.game?.deal) return;
      room.game.finishDealTimeout();
      scheduleTurnTimers(room, io);
      broadcastGame(room, io);
      startBotLoop(room, io);
    }, delay);
    return;
  }

  // Таймер хода идёт и при открытой сделке/акциях — по истечении автобросок / выкуп
  if (game.phase === 'roll' && game.turnEndsAt && !game.deal) {
    const delay = Math.max(200, game.turnEndsAt - Date.now());
    room._turnTimer = setTimeout(() => {
      room._turnTimer = null;
      if (!room.game || room.game.phase !== 'roll' || room.game.deal) return;
      const acted = room.game.finishTurnTimeout();
      if (acted) {
        scheduleRentEnd(room, io);
        if (room.game.phase === 'auction') scheduleAuctionEnd(room, io);
      }
      scheduleTurnTimers(room, io);
      broadcastGame(room, io);
      startBotLoop(room, io);
    }, delay);
  }
}

export function broadcastGame(room, io) {
  for (const member of room.members) {
    io.to(member.socketId).emit('game-state', getGameState(room, member.socketId));
  }
}

export function startBotLoop(room, io) {
  processBotChain(room.game, () => {
    if (room.game?.phase === 'auction') scheduleAuctionEnd(room, io);
    scheduleRentEnd(room, io);
    scheduleTurnTimers(room, io);
    broadcastGame(room, io);
  });
}

export function findMemberSlot(room, socketId) {
  return room.members.find(m => m.socketId === socketId)?.slot ?? null;
}

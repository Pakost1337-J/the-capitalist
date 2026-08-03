import { randomBytes } from 'crypto';
import { createGame } from '../js/game.js';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_SLOTS } from '../js/config.js';
import { pickBotNames } from '../js/names.js';
import { processBotChain } from './bot.js';

const rooms = new Map();
let roomSeq = 0;
/** Если за столом никого онлайн — через это время стол закрывается */
const EMPTY_ROOM_MS = 5 * 60_000;
/** Наблюдатели без reconnect */
const SPECTATOR_DROP_MS = 90_000;

function genRoomId() {
  roomSeq += 1;
  return `r${Date.now().toString(36)}${roomSeq}`;
}

function makeSessionToken() {
  return randomBytes(16).toString('hex');
}

function isLiveSocket(id) {
  return !!(id && !String(id).startsWith('pending:'));
}

export function createRoom(hostSocketId, hostName, maxPlayers = 4, fillBots = true, chipSlot = 0) {
  const id = genRoomId();
  const name = (hostName || 'Игрок').slice(0, 20);
  const sessionToken = makeSessionToken();
  const slot = clampChipSlot(chipSlot, []);
  const room = {
    id,
    name: `Стол ${name}`,
    hostSocketId,
    maxPlayers: Math.min(Math.max(Number(maxPlayers) || 4, MIN_PLAYERS), MAX_PLAYERS),
    fillBots: fillBots !== false && fillBots !== 0 && fillBots !== '0',
    status: 'lobby',
    members: [{
      socketId: hostSocketId,
      name,
      slot,
      chipSlot: slot,
      isHost: true,
      sessionToken,
      disconnectedAt: null,
    }],
    spectators: [],
    game: null,
    _reconnectTimers: new Map(),
  };
  rooms.set(id, room);
  return room;
}

function clampChipSlot(raw, usedSlots) {
  const n = Number(raw);
  const preferred = Number.isInteger(n) && n >= 0 && n < PLAYER_SLOTS.length ? n : 0;
  if (!usedSlots.includes(preferred)) return preferred;
  const free = PLAYER_SLOTS.find(s => !usedSlots.includes(s.id));
  return free?.id ?? 0;
}

export function getRoom(id) {
  return rooms.get(id);
}

export function joinRoom(id, socketId, name) {
  const room = getRoom(id);
  if (!room) return { error: 'Комната не найдена' };
  if (room.status !== 'lobby') return { error: 'Игра уже началась — можно только смотреть' };
  if (room.members.length >= room.maxPlayers) return { error: 'Комната заполнена' };
  if (room.members.some(m => m.socketId === socketId)) return { error: 'Вы уже в комнате' };

  const usedSlots = room.members.map(m => m.chipSlot ?? m.slot);
  const slot = clampChipSlot(undefined, usedSlots);
  const sessionToken = makeSessionToken();

  room.members.push({
    socketId,
    name: (name || 'Игрок').slice(0, 20),
    slot,
    chipSlot: slot,
    isHost: false,
    sessionToken,
    disconnectedAt: null,
  });

  return { room, sessionToken, slot };
}

/** Смена цвета фишки в лобби */
export function setMemberChip(roomId, socketId, chipSlot) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Комната не найдена' };
  if (room.status !== 'lobby') return { error: 'Игра уже началась' };
  const member = findMemberBySocket(room, socketId);
  if (!member) return { error: 'Вы не в комнате' };
  const used = room.members
    .filter(m => m.socketId !== socketId)
    .map(m => m.chipSlot ?? m.slot);
  const next = clampChipSlot(chipSlot, used);
  if (used.includes(next)) return { error: 'Этот цвет уже занят' };
  member.slot = next;
  member.chipSlot = next;
  return { room };
}

export function spectateRoom(id, socketId, name) {
  const room = getRoom(id);
  if (!room) return { error: 'Стол не найден' };
  if (room.status !== 'playing' || !room.game) return { error: 'Стол ещё не в игре' };
  if (getRoomBySocket(socketId)) return { error: 'Сначала выйдите из текущей комнаты' };

  const sessionToken = makeSessionToken();
  room.spectators.push({
    socketId,
    name: (name || 'Наблюдатель').slice(0, 20),
    sessionToken,
    disconnectedAt: null,
  });
  return { room, sessionToken };
}

function clearReconnectTimer(room, key) {
  const t = room._reconnectTimers?.get(key);
  if (t) clearTimeout(t);
  room._reconnectTimers?.delete(key);
}

function scheduleSpectatorDrop(room, spec) {
  if (!room._reconnectTimers) room._reconnectTimers = new Map();
  const key = `s:${spec.sessionToken}`;
  clearReconnectTimer(room, key);
  room._reconnectTimers.set(key, setTimeout(() => {
    room._reconnectTimers.delete(key);
    if (!rooms.has(room.id)) return;
    room.spectators = (room.spectators || []).filter(s => s.sessionToken !== spec.sessionToken);
  }, SPECTATOR_DROP_MS));
}

/** Место игрока держим до возврата; стол закрываем, только если онлайн никого нет */
function scheduleEmptyRoomCleanup(room, io) {
  if (!room._reconnectTimers) room._reconnectTimers = new Map();
  clearReconnectTimer(room, 'room-empty');
  if (room.members.some(m => isLiveSocket(m.socketId))) return;
  room._reconnectTimers.set('room-empty', setTimeout(() => {
    room._reconnectTimers.delete('room-empty');
    if (!rooms.has(room.id)) return;
    if (room.members.some(m => isLiveSocket(m.socketId))) return;
    for (const m of [...room.members]) abandonMember(room, m);
    room.members = [];
    afterMemberRemoved(room, io);
  }, EMPTY_ROOM_MS));
}

function abandonMember(room, member) {
  if (!room.game || member.slot == null) return;
  room.game.abandonPlayer(member.slot);
  const gp = room.game.players[member.slot];
  if (gp) {
    gp.socketId = null;
    gp.disconnected = false;
  }
}

function afterMemberRemoved(room, io) {
  if (room.members.length === 0) {
    for (const t of room._reconnectTimers?.values() || []) clearTimeout(t);
    const id = room.id;
    rooms.delete(id);
    io?.to(id).emit('room-closed');
    return { deleted: true, id };
  }

  if (!room.members.some(m => m.isHost && isLiveSocket(m.socketId))) {
    const nextHost = room.members.find(m => isLiveSocket(m.socketId)) || room.members[0];
    if (nextHost) {
      room.hostSocketId = nextHost.socketId;
      room.members.forEach(m => { m.isHost = m.sessionToken === nextHost.sessionToken; });
      if (room.status === 'lobby') room.name = `Стол ${nextHost.name}`;
    }
  }

  if (room.game && io) {
    scheduleAuctionEnd(room, io);
    scheduleMoveCommit(room, io);
    scheduleRentEnd(room, io);
    scheduleTurnTimers(room, io);
    broadcastGame(room, io);
    startBotLoop(room, io);
  } else if (io) {
    io.to(room.id).emit('lobby-update', getLobbyState(room));
  }
  return { room, id: room.id };
}

/**
 * intentional=true — выход кнопкой (сразу abandon)
 * intentional=false — обрыв сети / reload (grace + rejoin)
 */
export function leaveRoom(socketId, { intentional = true, io = null } = {}) {
  for (const room of rooms.values()) {
    const sIdx = (room.spectators || []).findIndex(s => s.socketId === socketId);
    if (sIdx !== -1) {
      const spec = room.spectators[sIdx];
      if (intentional || room.status !== 'playing') {
        clearReconnectTimer(room, `s:${spec.sessionToken}`);
        room.spectators.splice(sIdx, 1);
        return { room, id: room.id, spectatorLeft: true };
      }
      spec.socketId = `pending:${spec.sessionToken}`;
      spec.disconnectedAt = Date.now();
      scheduleSpectatorDrop(room, spec);
      return { room, id: room.id, disconnected: true, spectator: true };
    }
  }

  for (const [id, room] of rooms) {
    const idx = room.members.findIndex(m => m.socketId === socketId);
    if (idx === -1) continue;
    const member = room.members[idx];

    if (room.status === 'playing' && room.game) {
      if (intentional) {
        clearReconnectTimer(room, `p:${member.sessionToken}`);
        abandonMember(room, member);
        room.members.splice(idx, 1);
        const result = afterMemberRemoved(room, io);
        return { ...result, abandoned: true };
      }

      member.socketId = `pending:${member.sessionToken}`;
      member.disconnectedAt = Date.now();
      if (room.game.players[member.slot]) {
        room.game.players[member.slot].disconnected = true;
      }
      scheduleEmptyRoomCleanup(room, io);
      broadcastGame(room, io);
      return { room, id, disconnected: true };
    }

    // lobby
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

export function rejoinRoom(roomId, socketId, sessionToken) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Стол уже закрыт' };

  const member = room.members.find(m => m.sessionToken === sessionToken);
  if (member) {
    if (getRoomBySocket(socketId) && !room.members.some(m => m.socketId === socketId)) {
      return { error: 'Сначала выйдите из другой комнаты' };
    }
    clearReconnectTimer(room, `p:${member.sessionToken}`);
    clearReconnectTimer(room, 'room-empty');
    member.socketId = socketId;
    member.disconnectedAt = null;
    if (room.game?.players[member.slot]) {
      const gp = room.game.players[member.slot];
      if (gp.left || gp.bankrupt) {
        return { error: 'Вы уже покинули эту игру' };
      }
      gp.socketId = socketId;
      gp.disconnected = false;
    }
    if (member.isHost) room.hostSocketId = socketId;
    return {
      room,
      role: 'player',
      slot: member.slot,
      sessionToken: member.sessionToken,
      playing: room.status === 'playing',
    };
  }

  const spec = (room.spectators || []).find(s => s.sessionToken === sessionToken);
  if (spec) {
    clearReconnectTimer(room, `s:${spec.sessionToken}`);
    spec.socketId = socketId;
    spec.disconnectedAt = null;
    return {
      room,
      role: 'spectator',
      sessionToken: spec.sessionToken,
      playing: true,
    };
  }

  return { error: 'Сессия не найдена' };
}

export function getRoomBySocket(socketId) {
  if (!isLiveSocket(socketId)) return null;
  for (const room of rooms.values()) {
    if (room.members.some(m => m.socketId === socketId)) return room;
    if ((room.spectators || []).some(s => s.socketId === socketId)) return room;
  }
  return null;
}

export function findMemberBySocket(room, socketId) {
  return room.members.find(m => m.socketId === socketId) || null;
}

export function findSpectatorBySocket(room, socketId) {
  return (room.spectators || []).find(s => s.socketId === socketId) || null;
}

export function startGame(id, socketId) {
  const room = getRoom(id);
  if (!room) return { error: 'Комната не найдена' };
  if (room.hostSocketId !== socketId) return { error: 'Только хост может начать игру' };
  if (room.members.length < MIN_PLAYERS) return { error: 'Нет игроков для старта' };
  if (room.status !== 'lobby') return { error: 'Игра уже началась' };
  if (!room.fillBots && room.members.length < 2) {
    return { error: 'Без ботов нужно минимум 2 игрока' };
  }

  const usedNames = room.members.map(m => m.name);
  const seats = room.fillBots ? room.maxPlayers : room.members.length;
  const usedChips = new Set(room.members.map(m => m.chipSlot ?? m.slot));
  const freeChips = PLAYER_SLOTS.map(s => s.id).filter(id => !usedChips.has(id));

  const playerConfigs = room.members.map(m => ({
    name: m.name,
    socketId: m.socketId,
    isBot: false,
    chipSlot: m.chipSlot ?? m.slot,
  }));

  if (room.fillBots) {
    const botCount = Math.max(0, seats - playerConfigs.length);
    const botNames = pickBotNames(botCount, usedNames);
    for (let i = 0; i < botCount; i++) {
      playerConfigs.push({
        name: `Бот - ${botNames[i] || 'Гость'}`,
        socketId: null,
        isBot: true,
        chipSlot: freeChips[i] ?? ((playerConfigs.length + i) % PLAYER_SLOTS.length),
      });
    }
  }

  // Случайный порядок игроков (первый в списке + currentPlayerIndex в createGame)
  for (let i = playerConfigs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerConfigs[i], playerConfigs[j]] = [playerConfigs[j], playerConfigs[i]];
  }

  const game = createGame(playerConfigs);

  // member.slot = id игрока в партии (для действий); chipSlot сохраняем
  for (const m of room.members) {
    const p = game.players.find(pl => pl.socketId === m.socketId);
    if (!p) continue;
    m.chipSlot = p.chipSlot;
    m.slot = p.id;
  }

  game.addLog('Игра началась!');
  game.addLog(`— Ход: ${game.currentPlayer.name} —`);

  room.game = game;
  room.status = 'playing';
  room.spectators = room.spectators || [];

  return { room };
}

export function handleGameAction(room, socketId, action) {
  if (findSpectatorBySocket(room, socketId)) {
    return { error: 'Наблюдатель не может действовать' };
  }
  const member = findMemberBySocket(room, socketId);
  if (!member) return { error: 'Вы не в этой комнате' };
  if (member.disconnectedAt) return { error: 'Переподключение…' };

  const result = room.game.applyAction(action, member.slot);
  return result;
}

export function getLobbyState(room) {
  return {
    id: room.id,
    name: room.name,
    status: room.status,
    maxPlayers: room.maxPlayers,
    fillBots: !!room.fillBots,
    hostSocketId: room.hostSocketId,
    members: room.members.map(m => ({
      name: m.name,
      slot: m.slot,
      chipSlot: m.chipSlot ?? m.slot,
      isHost: m.isHost,
      token: PLAYER_SLOTS[m.chipSlot ?? m.slot]?.token,
      chipName: PLAYER_SLOTS[m.chipSlot ?? m.slot]?.name,
      color: PLAYER_SLOTS[m.chipSlot ?? m.slot]?.color,
      disconnected: !!m.disconnectedAt,
    })),
  };
}

export function listPublicRooms() {
  return [...rooms.values()].map(room => ({
    id: room.id,
    name: room.name,
    status: room.status,
    players: room.members.filter(m => !m.disconnectedAt || room.status === 'playing').length,
    maxPlayers: room.maxPlayers,
    hostName: room.members.find(m => m.isHost)?.name || room.members[0]?.name || '—',
    fillBots: !!room.fillBots,
    canJoin: room.status === 'lobby' && room.members.length < room.maxPlayers,
    canSpectate: room.status === 'playing' && !!room.game,
  })).sort((a, b) => {
    if (a.canJoin !== b.canJoin) return a.canJoin ? -1 : 1;
    return b.players - a.players;
  });
}

export function getGameState(room, socketId) {
  const member = findMemberBySocket(room, socketId);
  const spectator = findSpectatorBySocket(room, socketId);
  const state = room.game.getState();
  const isSpectator = !!spectator && !member;

  const players = state.players.map((p) => {
    const m = room.members.find(x => x.slot === p.id);
    return {
      ...p,
      disconnected: !!(m?.disconnectedAt) || !!p.disconnected,
      left: !!p.left,
    };
  });

  const me = member != null ? players[member.slot] : null;
  const isAuction = state.phase === 'auction';
  const deal = state.deal;
  const isDealParty = !!(deal && member && (deal.toId === member.slot || deal.fromId === member.slot));
  const isMyTurn = !!(
    member
    && me
    && !me.bankrupt
    && !me.left
    && !member.disconnectedAt
    && state.players[state.currentPlayerIndex]?.id === member.slot
  );

  return {
    ...state,
    players,
    roomId: room.id,
    roomName: room.name,
    mySlot: member?.slot ?? null,
    isSpectator,
    isMyTurn: isSpectator ? false : isMyTurn,
    canRespondDeal: !!(!isSpectator && deal && member && deal.toId === member.slot),
    isDealParty: isSpectator ? false : isDealParty,
    canAuctionBid: !!(!isSpectator && isAuction && me && !me.bankrupt && room.game.canPlayerAuctionBid?.(member.slot)),
    canAuctionLeave: !!(!isSpectator && isAuction && me && !me.bankrupt
      && state.auction?.startedBy !== member.slot
      && state.auction?.highBidder !== member.slot
      && !(state.auction?.optedOut || []).includes(member.slot)),
    auctionSpectator: !!(!isSpectator && isAuction && me && state.auction?.startedBy === member.slot),
    nextAuctionPrice: room.game.nextAuctionPrice?.() ?? null,
    dealableCompanies: isSpectator ? [] : (room.game.dealableCompanies?.(member?.slot) || []),
    myTradeableCompanies: isSpectator ? [] : (room.game.ownedTradeable?.(member?.slot) || []),
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

/** После анимации кубиков/хода — commitMove (эффект клетки) */
export function scheduleMoveCommit(room, io) {
  if (room._moveTimer) {
    clearTimeout(room._moveTimer);
    room._moveTimer = null;
  }
  const game = room.game;
  if (!game || game.phase !== 'moving' || game.moveAnimEndsAt == null) return;

  const delay = Math.max(50, game.moveAnimEndsAt - Date.now());
  room._moveTimer = setTimeout(() => {
    room._moveTimer = null;
    if (!room.game || room.game.phase !== 'moving') return;
    room.game.commitMove();
    if (room.game.phase === 'auction') scheduleAuctionEnd(room, io);
    scheduleRentEnd(room, io);
    scheduleTurnTimers(room, io);
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

  if (game.phase === 'roll' && game.turnEndsAt && !game.deal) {
    const delay = Math.max(200, game.turnEndsAt - Date.now());
    room._turnTimer = setTimeout(() => {
      room._turnTimer = null;
      if (!room.game || room.game.phase !== 'roll' || room.game.deal) return;
      const acted = room.game.finishTurnTimeout();
      if (acted) {
        scheduleMoveCommit(room, io);
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
    if (!isLiveSocket(member.socketId)) continue;
    io.to(member.socketId).emit('game-state', getGameState(room, member.socketId));
  }
  for (const s of room.spectators || []) {
    if (!isLiveSocket(s.socketId)) continue;
    io.to(s.socketId).emit('game-state', getGameState(room, s.socketId));
  }
}

export function startBotLoop(room, io) {
  processBotChain(room.game, () => {
    if (room.game?.phase === 'auction') scheduleAuctionEnd(room, io);
    scheduleMoveCommit(room, io);
    scheduleRentEnd(room, io);
    scheduleTurnTimers(room, io);
    broadcastGame(room, io);
  });
}

export function findMemberSlot(room, socketId) {
  return findMemberBySocket(room, socketId)?.slot ?? null;
}

/** Session payload for client localStorage */
export function sessionForSocket(room, socketId) {
  const member = findMemberBySocket(room, socketId);
  if (member) {
    return {
      roomId: room.id,
      sessionToken: member.sessionToken,
      slot: member.slot,
      name: member.name,
      role: 'player',
    };
  }
  const spec = findSpectatorBySocket(room, socketId);
  if (spec) {
    return {
      roomId: room.id,
      sessionToken: spec.sessionToken,
      slot: null,
      name: spec.name,
      role: 'spectator',
    };
  }
  return null;
}

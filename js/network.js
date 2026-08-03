import { PLAYER_SLOTS } from './config.js';

const NAME_KEY = 'capitalist-player-name';
const SESSION_KEY = 'capitalist-session-v1';
const CHIP_KEY = 'capitalist-chip-slot';

export function loadPlayerName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function savePlayerName(name) {
  try {
    localStorage.setItem(NAME_KEY, String(name || '').slice(0, 20));
  } catch { /* ignore */ }
}

export function loadChipSlot() {
  try {
    const n = Number(localStorage.getItem(CHIP_KEY));
    if (Number.isInteger(n) && n >= 0 && n < PLAYER_SLOTS.length) return n;
  } catch { /* ignore */ }
  return 0;
}

export function saveChipSlot(slot) {
  try {
    localStorage.setItem(CHIP_KEY, String(slot));
  } catch { /* ignore */ }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    if (!session) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}

export function clearSession() {
  saveSession(null);
}

export class Network {
  constructor() {
    this.socket = null;
    this.mySlot = null;
    this.roomId = null;
    this.sessionToken = null;
    this.role = null;
    this.onLobbyUpdate = null;
    this.onGameStart = null;
    this.onGameState = null;
    this.onRoomClosed = null;
    this.onServerInfo = null;
    this.onError = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io({ transports: ['websocket', 'polling'] });

      let booted = false;
      this.socket.on('connect', () => {
        this.socket.emit('get-server-info');
        if (!booted) {
          booted = true;
          resolve();
          return;
        }
        // Переподключение сокета без F5 — вернуть сессию
        const saved = loadSession();
        if (saved?.roomId && saved?.sessionToken) {
          this.rejoinRoom(saved.roomId, saved.sessionToken).then((res) => {
            if (res?.ok && res.playing && res.state) this.onGameState?.(res.state);
            else if (res?.ok && res.lobby) this.onLobbyUpdate?.(res.lobby);
          });
        }
      });
      this.socket.on('connect_error', (err) => reject(err));

      this.socket.on('lobby-update', (lobby) => this.onLobbyUpdate?.(lobby));
      this.socket.on('game-start', (state) => this.onGameStart?.(state));
      this.socket.on('game-state', (state) => this.onGameState?.(state));
      this.socket.on('room-closed', () => this.onRoomClosed?.());
      this.socket.on('server-info', (info) => this.onServerInfo?.(info));
    });
  }

  _applySession(session) {
    if (!session) return;
    this.roomId = session.roomId;
    this.sessionToken = session.sessionToken;
    this.mySlot = session.slot ?? null;
    this.role = session.role || 'player';
    saveSession(session);
  }

  createRoom(name, maxPlayers, fillBots = true, chipSlot = 0) {
    return new Promise((resolve) => {
      this.socket.emit('create-room', { name, maxPlayers, fillBots, chipSlot }, (res) => {
        if (res?.ok && res.session) this._applySession(res.session);
        resolve(res || { ok: false, error: 'Нет ответа' });
      });
    });
  }

  setChip(chipSlot) {
    return new Promise((resolve) => {
      this.socket.emit('set-chip', { chipSlot }, (res) => {
        if (res?.ok && res.session) this._applySession(res.session);
        resolve(res || { ok: false, error: 'Нет ответа' });
      });
    });
  }

  joinRoom(id, name) {
    return new Promise((resolve) => {
      this.socket.emit('join-room', { id, name }, (res) => {
        if (res?.ok && res.session) this._applySession(res.session);
        resolve(res || { ok: false, error: 'Нет ответа' });
      });
    });
  }

  spectateRoom(id, name) {
    return new Promise((resolve) => {
      this.socket.emit('spectate-room', { id, name }, (res) => {
        if (res?.ok && res.session) this._applySession(res.session);
        resolve(res || { ok: false, error: 'Нет ответа' });
      });
    });
  }

  rejoinRoom(roomId, sessionToken) {
    return new Promise((resolve) => {
      this.socket.emit('rejoin-room', { roomId, sessionToken }, (res) => {
        if (res?.ok && res.session) this._applySession(res.session);
        resolve(res || { ok: false, error: 'Нет ответа' });
      });
    });
  }

  startGame() {
    return new Promise((resolve) => {
      this.socket.emit('start-game', {}, (res) => {
        if (res?.ok && res.session) this._applySession(res.session);
        resolve(res || { ok: false, error: 'Нет ответа сервера' });
      });
    });
  }

  sendAction(action) {
    return new Promise((resolve) => {
      this.socket.emit('game-action', action, (res) => resolve(res));
    });
  }

  leaveRoom() {
    this.socket?.emit('leave-room');
    this.roomId = null;
    this.mySlot = null;
    this.sessionToken = null;
    this.role = null;
    clearSession();
  }
}

export class LobbyUI {
  constructor(network) {
    this.network = network;
    this.el = document.getElementById('lobby');
    this.selectedChip = loadChipSlot();
    this.setupEvents();
    this.restoreName();
    this.renderMenuChipPicker();
  }

  setupEvents() {
    document.getElementById('btn-create').addEventListener('click', () => this.create());
    document.getElementById('btn-start').addEventListener('click', () => this.start());
    document.getElementById('btn-leave').addEventListener('click', () => this.leave());
    document.getElementById('player-name')?.addEventListener('change', () => {
      savePlayerName(this.getPlayerName());
    });
  }

  renderMenuChipPicker() {
    const el = document.getElementById('chip-picker');
    if (!el) return;
    el.innerHTML = PLAYER_SLOTS.map((s) => `
      <button type="button" class="chip-picker__btn${this.selectedChip === s.id ? ' is-active' : ''}"
        data-chip="${s.id}" title="${escapeHtml(s.name)}" style="--chip:${s.color}" aria-pressed="${this.selectedChip === s.id}">
        <span class="chip-picker__swatch" style="background:${s.color}"></span>
        <span class="chip-picker__label">${escapeHtml(s.name)}</span>
      </button>
    `).join('');
    el.querySelectorAll('[data-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedChip = Number(btn.dataset.chip);
        saveChipSlot(this.selectedChip);
        this.renderMenuChipPicker();
      });
    });
  }

  renderRoomChipPicker(lobby) {
    const wrap = document.getElementById('room-chip-wrap');
    const el = document.getElementById('room-chip-picker');
    if (!wrap || !el) return;
    // В лобби slot = цвет фишки; после старта игры экран комнаты скрыт.
    const mine = lobby.members.find(m => m.slot === this.network.mySlot)
      || lobby.members.find(m => m.isHost && lobby.hostSocketId === this.network.socket?.id)
      || lobby.members.find(m => m.name === this.getPlayerName());
    const myChip = mine?.chipSlot ?? mine?.slot ?? this.selectedChip;
    const taken = new Set(
      lobby.members
        .filter(m => m !== mine)
        .map(m => m.chipSlot ?? m.slot),
    );
    wrap.hidden = false;
    el.innerHTML = PLAYER_SLOTS.map((s) => {
      const busy = taken.has(s.id);
      const active = myChip === s.id;
      return `
        <button type="button" class="chip-picker__btn${active ? ' is-active' : ''}${busy ? ' is-busy' : ''}"
          data-chip="${s.id}" title="${escapeHtml(s.name)}" style="--chip:${s.color}"
          ${busy ? 'disabled' : ''} aria-pressed="${active}">
          <span class="chip-picker__swatch" style="background:${s.color}"></span>
          <span class="chip-picker__label">${escapeHtml(s.name)}</span>
        </button>`;
    }).join('');
    el.querySelectorAll('[data-chip]:not(:disabled)').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const chipSlot = Number(btn.dataset.chip);
        const res = await this.network.setChip(chipSlot);
        if (!res?.ok) return this.showError(res?.error || 'Не удалось сменить цвет');
        this.selectedChip = chipSlot;
        saveChipSlot(chipSlot);
        if (res.lobby) this.renderRoom(res.lobby);
      });
    });
  }

  restoreName() {
    const input = document.getElementById('player-name');
    if (!input) return;
    const saved = loadPlayerName();
    if (saved) input.value = saved;
  }

  show() {
    this.el.hidden = false;
    this.el.style.display = '';
  }

  hide() {
    this.el.hidden = true;
    this.el.style.display = 'none';
  }

  showView(view) {
    document.getElementById('lobby-menu').hidden = view !== 'menu';
    document.getElementById('lobby-room').hidden = view !== 'room';
  }

  getPlayerName() {
    const name = document.getElementById('player-name').value.trim() || 'Игрок';
    savePlayerName(name);
    return name;
  }

  async create() {
    const name = this.getPlayerName();
    const maxPlayers = Number(document.getElementById('max-players').value);
    const fillBots = document.getElementById('fill-bots')?.value !== '0';
    const chipSlot = this.selectedChip;
    const res = await this.network.createRoom(name, maxPlayers, fillBots, chipSlot);
    if (!res.ok) return this.showError(res.error);
    this.showView('room');
    this.renderRoom(res.lobby);
  }

  async joinById(id) {
    const name = this.getPlayerName();
    const res = await this.network.joinRoom(id, name);
    if (!res.ok) return this.showError(res.error);
    this.showView('room');
    this.renderRoom(res.lobby);
  }

  async spectateById(id) {
    const name = this.getPlayerName();
    const res = await this.network.spectateRoom(id, name);
    if (!res.ok) return this.showError(res.error);
    return res;
  }

  async start() {
    const btn = document.getElementById('btn-start');
    btn.disabled = true;
    btn.textContent = '⏳ Запуск...';
    try {
      const res = await this.network.startGame();
      if (!res?.ok) {
        this.showError(res?.error || 'Не удалось начать игру');
        btn.disabled = false;
        btn.textContent = '🎲 Начать игру';
      }
    } catch (e) {
      this.showError(e.message || 'Ошибка сети');
      btn.disabled = false;
      btn.textContent = '🎲 Начать игру';
    }
  }

  leave() {
    this.network.leaveRoom();
    this.showView('menu');
    const btn = document.getElementById('btn-start');
    btn.disabled = false;
    btn.textContent = '🎲 Начать игру';
  }

  renderServerInfo(info) {
    const onlineEl = document.getElementById('online-count');
    if (onlineEl) onlineEl.textContent = info.online ?? 0;

    const list = document.getElementById('rooms-list');
    if (!list) return;

    const rooms = info.rooms || [];
    if (rooms.length === 0) {
      list.innerHTML = '<p class="rooms-empty">Пока нет столов — создайте первый!</p>';
      return;
    }

    const saved = loadSession();

    list.innerHTML = rooms.map(room => {
      const status = room.status === 'lobby'
        ? (room.canJoin ? 'Ожидание' : 'Полный')
        : 'В игре';
      const statusClass = room.status === 'lobby'
        ? (room.canJoin ? 'room-card__status--open' : 'room-card__status--full')
        : 'room-card__status--play';

      const canRejoin = !!(
        saved?.roomId === room.id
        && saved?.sessionToken
        && saved?.role === 'player'
        && room.status === 'playing'
      );

      let actions = '';
      if (canRejoin) {
        actions = `
          <button class="btn btn--club room-card__join" data-rejoin="${room.id}">Подключиться</button>
          ${room.canSpectate ? `<button class="btn btn--club-muted room-card__join" data-spectate="${room.id}">Смотреть</button>` : ''}
        `;
      } else if (room.canJoin) {
        actions = `<button class="btn btn--club room-card__join" data-join="${room.id}">Войти</button>`;
      } else if (room.canSpectate) {
        actions = `<button class="btn btn--club room-card__join" data-spectate="${room.id}">Смотреть</button>`;
      } else {
        actions = `<button class="btn btn--club-muted room-card__join" disabled>${room.status === 'playing' ? 'Идёт' : 'Полный'}</button>`;
      }

      const botsLabel = room.fillBots === false ? 'без ботов' : 'с ботами';
      return `
        <div class="room-card">
          <div class="room-card__info">
            <div class="room-card__name">${escapeHtml(room.name)}</div>
            <div class="room-card__meta">
              👤 ${room.players}/${room.maxPlayers}
              · ${botsLabel}
              · <span class="room-card__status ${statusClass}">${status}</span>
            </div>
          </div>
          <div class="room-card__actions">${actions}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-join]').forEach(btn => {
      btn.addEventListener('click', () => this.joinById(btn.dataset.join));
    });
    list.querySelectorAll('[data-rejoin]').forEach(btn => {
      btn.addEventListener('click', () => this.onRejoin?.(btn.dataset.rejoin));
    });
    list.querySelectorAll('[data-spectate]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.spectateById(btn.dataset.spectate).then((res) => {
          if (res?.ok) this.onSpectate?.(res);
        });
      });
    });
  }

  renderRoom(lobby) {
    document.getElementById('room-name').textContent = lobby.name || 'Стол';
    const mode = lobby.fillBots === false ? 'без ботов' : 'с ботами';
    document.getElementById('room-count').textContent =
      `${lobby.members.length} / ${lobby.maxPlayers} · ${mode}`;

    const isHost = lobby.hostSocketId === this.network.socket.id;
    document.getElementById('btn-start').hidden = !isHost;
    document.getElementById('host-hint').hidden = isHost;

    document.getElementById('room-players').innerHTML = lobby.members.map(m => `
      <div class="lobby-player" style="--pc: ${m.color}">
        <span class="chip lobby-player__token" style="background:${m.color}" title="${escapeHtml(m.chipName || '')}"></span>
        <span class="lobby-player__name">${escapeHtml(m.name)}${m.isHost ? ' 👑' : ''}${m.disconnected ? ' · нет сети' : ''}</span>
      </div>
    `).join('');

    const emptyLabel = lobby.fillBots === false
      ? 'Ожидание игрока'
      : '🤖 Свободное место (бот)';
    for (let i = lobby.members.length; i < lobby.maxPlayers; i++) {
      document.getElementById('room-players').innerHTML += `
        <div class="lobby-player lobby-player--empty">
          <span>${emptyLabel}</span>
        </div>`;
    }

    this.renderRoomChipPicker(lobby);
  }

  showError(msg) {
    const el = document.getElementById('lobby-error');
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 3000);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

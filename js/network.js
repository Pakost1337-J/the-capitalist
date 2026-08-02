export class Network {
  constructor() {
    this.socket = null;
    this.mySlot = null;
    this.roomId = null;
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

      this.socket.on('connect', () => {
        this.socket.emit('get-server-info');
        resolve();
      });
      this.socket.on('connect_error', (err) => reject(err));

      this.socket.on('lobby-update', (lobby) => this.onLobbyUpdate?.(lobby));
      this.socket.on('game-start', (state) => this.onGameStart?.(state));
      this.socket.on('game-state', (state) => this.onGameState?.(state));
      this.socket.on('room-closed', () => this.onRoomClosed?.());
      this.socket.on('server-info', (info) => this.onServerInfo?.(info));
    });
  }

  createRoom(name, maxPlayers) {
    return new Promise((resolve) => {
      this.socket.emit('create-room', { name, maxPlayers }, (res) => {
        if (res?.ok) this.roomId = res.lobby.id;
        resolve(res || { ok: false, error: 'Нет ответа' });
      });
    });
  }

  joinRoom(id, name) {
    return new Promise((resolve) => {
      this.socket.emit('join-room', { id, name }, (res) => {
        if (res?.ok) this.roomId = res.lobby.id;
        resolve(res || { ok: false, error: 'Нет ответа' });
      });
    });
  }

  startGame() {
    return new Promise((resolve) => {
      this.socket.emit('start-game', {}, (res) =>
        resolve(res || { ok: false, error: 'Нет ответа сервера' })
      );
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
  }
}

export class LobbyUI {
  constructor(network) {
    this.network = network;
    this.el = document.getElementById('lobby');
    this.setupEvents();
  }

  setupEvents() {
    document.getElementById('btn-create').addEventListener('click', () => this.create());
    document.getElementById('btn-start').addEventListener('click', () => this.start());
    document.getElementById('btn-leave').addEventListener('click', () => this.leave());
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
    return document.getElementById('player-name').value.trim() || 'Игрок';
  }

  async create() {
    const name = this.getPlayerName();
    const maxPlayers = Number(document.getElementById('max-players').value);
    const res = await this.network.createRoom(name, maxPlayers);
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

    list.innerHTML = rooms.map(room => {
      const status = room.status === 'lobby'
        ? (room.canJoin ? 'Ожидание' : 'Полный')
        : 'В игре';
      const statusClass = room.status === 'lobby'
        ? (room.canJoin ? 'room-card__status--open' : 'room-card__status--full')
        : 'room-card__status--play';

      return `
        <div class="room-card">
          <div class="room-card__info">
            <div class="room-card__name">${escapeHtml(room.name)}</div>
            <div class="room-card__meta">
              👤 ${room.players}/${room.maxPlayers}
              · <span class="room-card__status ${statusClass}">${status}</span>
            </div>
          </div>
          ${room.canJoin
            ? `<button class="btn btn--end room-card__join" data-join="${room.id}">Войти</button>`
            : `<button class="btn btn--pass room-card__join" disabled>${room.status === 'playing' ? 'Идёт' : 'Полный'}</button>`
          }
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-join]').forEach(btn => {
      btn.addEventListener('click', () => this.joinById(btn.dataset.join));
    });
  }

  renderRoom(lobby) {
    document.getElementById('room-name').textContent = lobby.name || 'Стол';
    document.getElementById('room-count').textContent =
      `${lobby.members.length} / ${lobby.maxPlayers}`;

    const isHost = lobby.hostSocketId === this.network.socket.id;
    document.getElementById('btn-start').hidden = !isHost;
    document.getElementById('host-hint').hidden = isHost;

    document.getElementById('room-players').innerHTML = lobby.members.map(m => `
      <div class="lobby-player" style="--pc: ${m.color}">
        <span class="lobby-player__token">${m.token}</span>
        <span class="lobby-player__name">${escapeHtml(m.name)}${m.isHost ? ' 👑' : ''}</span>
      </div>
    `).join('');

    for (let i = lobby.members.length; i < lobby.maxPlayers; i++) {
      document.getElementById('room-players').innerHTML += `
        <div class="lobby-player lobby-player--empty">
          <span>🤖 Будет бот</span>
        </div>`;
    }
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

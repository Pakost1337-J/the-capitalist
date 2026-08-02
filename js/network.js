import { formatMoney } from './utils.js';

export class Network {
  constructor() {
    this.socket = null;
    this.mySlot = null;
    this.roomCode = null;
    this.onLobbyUpdate = null;
    this.onGameStart = null;
    this.onGameState = null;
    this.onRoomClosed = null;
    this.onError = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io({ transports: ['websocket', 'polling'] });

      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', (err) => reject(err));

      this.socket.on('lobby-update', (lobby) => this.onLobbyUpdate?.(lobby));
      this.socket.on('game-start', (state) => this.onGameStart?.(state));
      this.socket.on('game-state', (state) => this.onGameState?.(state));
      this.socket.on('room-closed', () => this.onRoomClosed?.());
    });
  }

  createRoom(name, maxPlayers) {
    return new Promise((resolve) => {
      this.socket.emit('create-room', { name, maxPlayers }, (res) => {
        if (res.ok) {
          this.roomCode = res.lobby.code;
          resolve(res);
        } else {
          resolve(res);
        }
      });
    });
  }

  joinRoom(code, name) {
    return new Promise((resolve) => {
      this.socket.emit('join-room', { code: code.toUpperCase(), name }, (res) => {
        if (res.ok) {
          this.roomCode = res.lobby.code;
          resolve(res);
        } else {
          resolve(res);
        }
      });
    });
  }

  startGame() {
    return new Promise((resolve) => {
      this.socket.emit('start-game', (res) => resolve(res));
    });
  }

  sendAction(action) {
    return new Promise((resolve) => {
      this.socket.emit('game-action', action, (res) => resolve(res));
    });
  }

  leaveRoom() {
    this.socket?.emit('leave-room');
    this.roomCode = null;
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
    document.getElementById('btn-join').addEventListener('click', () => this.join());
    document.getElementById('btn-start').addEventListener('click', () => this.start());
    document.getElementById('btn-leave').addEventListener('click', () => this.leave());

    document.getElementById('join-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
  }

  show() { this.el.hidden = false; }
  hide() { this.el.hidden = true; }

  showView(view) {
    document.getElementById('lobby-menu').hidden = view !== 'menu';
    document.getElementById('lobby-room').hidden = view !== 'room';
  }

  async create() {
    const name = document.getElementById('player-name').value.trim() || 'Игрок';
    const maxPlayers = Number(document.getElementById('max-players').value);
    const res = await this.network.createRoom(name, maxPlayers);
    if (!res.ok) return this.showError(res.error);
    this.showView('room');
    this.renderRoom(res.lobby);
  }

  async join() {
    const name = document.getElementById('player-name').value.trim() || 'Игрок';
    const code = document.getElementById('join-code').value.trim();
    if (code.length < 4) return this.showError('Введите код комнаты');
    const res = await this.network.joinRoom(code, name);
    if (!res.ok) return this.showError(res.error);
    this.showView('room');
    this.renderRoom(res.lobby);
  }

  async start() {
    const res = await this.network.startGame();
    if (!res.ok) this.showError(res.error);
  }

  leave() {
    this.network.leaveRoom();
    this.showView('menu');
    document.getElementById('join-code').value = '';
  }

  renderRoom(lobby) {
    document.getElementById('room-code').textContent = lobby.code;
    document.getElementById('room-count').textContent =
      `${lobby.members.length} / ${lobby.maxPlayers}`;

    const isHost = lobby.hostSocketId === this.network.socket.id;
    document.getElementById('btn-start').hidden = !isHost;
    document.getElementById('host-hint').hidden = isHost;

    document.getElementById('room-players').innerHTML = lobby.members.map(m => `
      <div class="lobby-player" style="--pc: ${m.color}">
        <span class="lobby-player__token">${m.token}</span>
        <span class="lobby-player__name">${m.name}${m.isHost ? ' 👑' : ''}</span>
      </div>
    `).join('');

    for (let i = lobby.members.length; i < lobby.maxPlayers; i++) {
      document.getElementById('room-players').innerHTML += `
        <div class="lobby-player lobby-player--empty">
          <span>⏳ Ожидание игрока...</span>
        </div>`;
    }

    const shareUrl = `${location.origin}?room=${lobby.code}`;
    const shareEl = document.getElementById('share-url');
    if (shareEl) shareEl.textContent = shareUrl;
  }

  showError(msg) {
    const el = document.getElementById('lobby-error');
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 3000);
  }
}

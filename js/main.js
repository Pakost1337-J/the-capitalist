import { Network, LobbyUI } from './network.js';
import { UI } from './ui.js';
import { PHASE } from './game.js';
import { applyTheme } from './config.js';
import { initLayoutTweak } from './layout-tweak.js';

const network = new Network();
const lobby = new LobbyUI(network);
let ui = null;

async function loadTheme() {
  try {
    const res = await fetch('/api/theme');
    if (res.ok) applyTheme(await res.json());
  } catch (_) {}
}

function startLayoutPreview() {
  const lobbyEl = document.getElementById('lobby');
  const gameEl = document.getElementById('game-layout');
  if (lobbyEl) {
    lobbyEl.hidden = true;
    lobbyEl.style.display = 'none';
  }
  if (gameEl) {
    gameEl.hidden = false;
    gameEl.style.display = 'flex';
  }
  // Доска без сетевой игры — только для правки лого/флагов
  ui = new UI(null, null);
  ui.fitLayout();
  document.body.classList.add('layout-preview');
}

async function init() {
  await loadTheme();

  const editMode = new URLSearchParams(location.search).has('edit');
  if (editMode) {
    startLayoutPreview();
    initLayoutTweak();
    return;
  }

  initLayoutTweak();

  try {
    await network.connect();
  } catch (e) {
    document.getElementById('lobby-error').textContent =
      'Не удалось подключиться к серверу. Перезагрузите страницу.';
    document.getElementById('lobby-error').hidden = false;
    return;
  }

  lobby.show();
  lobby.showView('menu');

  network.onServerInfo = (info) => lobby.renderServerInfo(info);
  network.socket.on('theme-update', (theme) => applyTheme(theme));

  network.onLobbyUpdate = (state) => {
    lobby.renderRoom(state);
  };

  network.onGameStart = (state) => {
    lobby.hide();
    startGameUI(state);
  };

  network.onGameState = (state) => {
    if (ui) ui.render(state);
  };

  network.onRoomClosed = () => {
    showToast('Комната закрыта');
    setTimeout(() => location.reload(), 1200);
  };
}

function showToast(text) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function startGameUI(state) {
  const lobbyEl = document.getElementById('lobby');
  const gameEl = document.getElementById('game-layout');
  lobbyEl.hidden = true;
  lobbyEl.style.display = 'none';
  gameEl.hidden = false;
  gameEl.style.display = 'flex';

  ui = new UI(null, network);
  ui.mySlot = state.mySlot;
  ui.fitLayout();
  ui.render(state);
}

init();

export { network, ui, PHASE };

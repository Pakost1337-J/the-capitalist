import { Network, LobbyUI } from './network.js';
import { UI } from './ui.js';
import { PHASE } from './game.js';
import { applyTheme } from './config.js';

const network = new Network();
const lobby = new LobbyUI(network);
let ui = null;

async function loadTheme() {
  try {
    const res = await fetch('/api/theme');
    if (res.ok) applyTheme(await res.json());
  } catch (_) {}
}

async function init() {
  await loadTheme();

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
    alert('Комната закрыта');
    location.reload();
  };
}

function startGameUI(state) {
  const lobbyEl = document.getElementById('lobby');
  const gameEl = document.getElementById('game-layout');
  lobbyEl.hidden = true;
  lobbyEl.style.display = 'none';
  gameEl.hidden = false;
  gameEl.style.display = '';

  ui = new UI(null, network);
  ui.mySlot = state.mySlot;
  ui.render(state);
}

init();

export { network, ui, PHASE };

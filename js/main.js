import { Network, LobbyUI } from './network.js';
import { UI } from './ui.js';
import { PHASE } from './game.js';

const network = new Network();
const lobby = new LobbyUI(network);
let ui = null;

async function init() {
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

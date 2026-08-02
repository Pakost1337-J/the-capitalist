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

  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) {
    document.getElementById('join-code').value = urlRoom.toUpperCase();
  }

  network.onLobbyUpdate = (state) => {
    lobby.renderRoom(state);
    history.replaceState(null, '', `?room=${state.code}`);
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
  document.getElementById('game-layout').hidden = false;

  ui = new UI(null, network);
  ui.mySlot = state.mySlot;
  ui.render(state);
}

init();

export { network, ui, PHASE };

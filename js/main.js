import { Network, LobbyUI, loadSession, clearSession } from './network.js';
import { UI } from './ui.js';
import { PHASE } from './game.js';
import { applyTheme, PLAYER_SLOTS } from './config.js';

const network = new Network();
const lobby = new LobbyUI(network);
let ui = null;

async function loadTheme() {
  try {
    const res = await fetch('/api/theme');
    if (res.ok) applyTheme(await res.json());
  } catch (_) {}
}

function preventGamePagePan(e) {
  if (!document.body.classList.contains('is-playing')) return;
  const allow = e.target.closest?.(
    'button, input, select, textarea, a, .hub__actions, .hub__chat-messages, .deal-panel__list, .choice-panel, .hub__choice, .company-info, .game-dialog, .cell-tip'
  );
  if (!allow) e.preventDefault();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryRestoreSession() {
  const saved = loadSession();
  if (!saved?.roomId || !saved?.sessionToken) return false;

  let lastErr = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await sleep(350);
    const res = await network.rejoinRoom(saved.roomId, saved.sessionToken);
    if (res?.ok) {
      if (res.playing && res.state) {
        lobby.hide();
        startGameUI(res.state);
        return true;
      }
      if (res.lobby) {
        lobby.show();
        lobby.showView('room');
        lobby.renderRoom(res.lobby);
        return true;
      }
    }
    lastErr = res?.error || '';
    // стол точно мёртв — забываем сессию
    if (/закрыт|не найден|покинул/i.test(lastErr)) {
      clearSession();
      return false;
    }
  }
  // Сессию оставляем — в списке столов будет «Подключиться»
  return false;
}

async function init() {
  await loadTheme();
  document.addEventListener('touchmove', preventGamePagePan, { passive: false });

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
  lobby.onSpectate = (res) => {
    if (res?.state) {
      lobby.hide();
      startGameUI(res.state);
    }
  };

  network.socket.on('theme-update', (theme) => {
    applyTheme(theme);
    if (ui?.lastState?.players) {
      for (const p of ui.lastState.players) {
        const slot = PLAYER_SLOTS[p.chipSlot ?? p.id];
        if (!slot) continue;
        p.color = slot.color;
        p.colorSoft = slot.colorSoft;
        p.ownTop = slot.ownTop;
        p.ownRight = slot.ownRight;
        p.ownBottom = slot.ownBottom;
        p.ownLeft = slot.ownLeft;
      }
      ui.renderHouses(ui.lastState);
      ui.renderPlayers?.(ui.lastState);
    }
  });

  network.onLobbyUpdate = (state) => {
    lobby.renderRoom(state);
  };

  network.onGameStart = (state) => {
    if (state?.session) network._applySession(state.session);
    lobby.hide();
    startGameUI(state);
  };

  lobby.onRejoin = async (roomId) => {
    const saved = loadSession();
    if (!saved?.sessionToken || saved.roomId !== roomId) {
      lobby.showError('Нет сохранённой сессии для этого стола');
      return;
    }
    const res = await network.rejoinRoom(saved.roomId, saved.sessionToken);
    if (!res?.ok) {
      lobby.showError(res?.error || 'Не удалось подключиться');
      if (/закрыт|не найден|покинул/i.test(res?.error || '')) clearSession();
      return;
    }
    if (res.playing && res.state) {
      lobby.hide();
      startGameUI(res.state);
      return;
    }
    if (res.lobby) {
      lobby.showView('room');
      lobby.renderRoom(res.lobby);
    }
  };

  network.onGameState = (state) => {
    if (ui) ui.render(state);
  };

  network.onRoomClosed = () => {
    clearSession();
    showToast('Комната закрыта');
    setTimeout(() => location.reload(), 1200);
  };

  const restored = await tryRestoreSession();
  if (!restored) {
    lobby.show();
    lobby.showView('menu');
  }
}

function showToast(text) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function confirmExitGame(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  if (!ui) return;
  // уже открыт — не сбрасываем таймер 3с
  if (ui.gameDialog && !ui.gameDialog.hidden) return;
  const isSpec = network.role === 'spectator' || ui?.lastState?.isSpectator;
  ui.showExitDialog({
    isSpectator: isSpec,
    onConfirm: () => {
      network.leaveRoom();
      location.reload();
    },
  });
}

function bindExitButton() {
  const exitBtn = document.getElementById('btn-exit-game');
  if (!exitBtn || exitBtn.dataset.bound) return;
  exitBtn.dataset.bound = '1';
  exitBtn.addEventListener('click', confirmExitGame);
}

function startGameUI(state) {
  const lobbyEl = document.getElementById('lobby');
  const gameEl = document.getElementById('game-layout');
  lobbyEl.hidden = true;
  lobbyEl.style.display = 'none';
  gameEl.hidden = false;
  gameEl.style.display = 'flex';
  document.body.classList.add('is-playing');
  document.body.classList.toggle('is-spectator', !!state.isSpectator);

  ui = new UI(null, network);
  ui.mySlot = state.mySlot;
  ui.isSpectator = !!state.isSpectator;
  ui.tryLockLandscape();
  ui._syncOrientation();
  ui.fitLayout();
  ui.render(state);

  bindExitButton();
}

init();

export { network, ui, PHASE };

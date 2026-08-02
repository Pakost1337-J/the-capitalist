import { PLAYER_SLOTS, applyTheme, normalizeHexColor } from './config.js';

let theme = { players: [] };
let selectedId = null;

const statusEl = document.getElementById('status');
const panelEmpty = document.getElementById('panel-empty');
const panelForm = document.getElementById('panel-form');
const editLabel = document.getElementById('edit-label');
const playersStrip = document.getElementById('players-strip');
const ownPreview = document.getElementById('own-preview');

const fieldColor = document.getElementById('field-color');
const fieldTop = document.getElementById('field-own-top');
const fieldRight = document.getElementById('field-own-right');
const fieldBottom = document.getElementById('field-own-bottom');
const fieldLeft = document.getElementById('field-own-left');

function setStatus(text) {
  statusEl.textContent = text;
}

function getPlayerData(id) {
  return theme.players.find(p => p.id === id) || {
    id,
    color: PLAYER_SLOTS[id].color,
    ownTop: PLAYER_SLOTS[id].ownTop || PLAYER_SLOTS[id].color,
    ownRight: PLAYER_SLOTS[id].ownRight || PLAYER_SLOTS[id].color,
    ownBottom: PLAYER_SLOTS[id].ownBottom || PLAYER_SLOTS[id].color,
    ownLeft: PLAYER_SLOTS[id].ownLeft || PLAYER_SLOTS[id].color,
  };
}

function chipLabel(id) {
  return PLAYER_SLOTS[id]?.name || `Фишка ${id + 1}`;
}

function renderPlayers() {
  playersStrip.innerHTML = theme.players.map(p => {
    const color = normalizeHexColor(p.color, '#888');
    const selectedCls = selectedId === p.id ? 'ctor-chip--selected' : '';
    return `
      <button type="button" class="ctor-chip ${selectedCls}" data-player="${p.id}" style="border-color:${color}; --chip:${color}">
        <span class="ctor-chip__swatch" style="background:${color}"></span>
        <span>${chipLabel(p.id)}</span>
      </button>
    `;
  }).join('');

  playersStrip.querySelectorAll('[data-player]').forEach(btn => {
    btn.addEventListener('click', () => selectPlayer(Number(btn.dataset.player)));
  });
}

function paintPreview(p) {
  if (!ownPreview) return;
  const map = {
    top: p.ownTop || p.color,
    right: p.ownRight || p.color,
    bottom: p.ownBottom || p.color,
    left: p.ownLeft || p.color,
  };
  ownPreview.querySelectorAll('.ctor-preview-own__cell').forEach((el) => {
    const side = el.dataset.side;
    el.style.setProperty('--own-tint', normalizeHexColor(map[side], p.color));
    el.dataset.side = side;
  });
}

function selectPlayer(id) {
  selectedId = id;
  renderPlayers();
  const data = getPlayerData(id);
  panelEmpty.hidden = true;
  panelForm.hidden = false;
  editLabel.textContent = chipLabel(id);
  fieldColor.value = normalizeHexColor(data.color, '#888888');
  fieldTop.value = normalizeHexColor(data.ownTop || data.color, data.color);
  fieldRight.value = normalizeHexColor(data.ownRight || data.color, data.color);
  fieldBottom.value = normalizeHexColor(data.ownBottom || data.color, data.color);
  fieldLeft.value = normalizeHexColor(data.ownLeft || data.color, data.color);
  paintPreview(data);
}

function applyCurrent() {
  if (selectedId == null) return;
  const p = theme.players.find(x => x.id === selectedId);
  if (!p) return;
  p.color = fieldColor.value;
  p.colorSoft = fieldColor.value;
  p.ownTop = fieldTop.value;
  p.ownRight = fieldRight.value;
  p.ownBottom = fieldBottom.value;
  p.ownLeft = fieldLeft.value;
  renderPlayers();
  paintPreview(p);
  setStatus(`Обновлено: ${chipLabel(p.id)}`);
}

function fillAllFromMain() {
  if (selectedId == null) return;
  const c = fieldColor.value;
  fieldTop.value = c;
  fieldRight.value = c;
  fieldBottom.value = c;
  fieldLeft.value = c;
  applyCurrent();
}

async function load() {
  const res = await fetch('/api/theme');
  const data = await res.json();
  const list = Array.isArray(data.players) ? data.players : [];
  theme.players = PLAYER_SLOTS.map((slot) => {
    const ov = list.find(p => p.id === slot.id) || {};
    const color = normalizeHexColor(ov.color || slot.color, slot.color);
    return {
      id: slot.id,
      color,
      colorSoft: normalizeHexColor(ov.colorSoft || color, color),
      ownTop: normalizeHexColor(ov.ownTop || color, color),
      ownRight: normalizeHexColor(ov.ownRight || color, color),
      ownBottom: normalizeHexColor(ov.ownBottom || color, color),
      ownLeft: normalizeHexColor(ov.ownLeft || color, color),
    };
  });
  applyTheme({ players: theme.players });
  renderPlayers();
  setStatus('Выберите фишку');
  selectPlayer(0);
}

async function save() {
  setStatus('Сохранение…');
  applyCurrent();
  const res = await fetch('/api/theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players: theme.players }),
  });
  const data = await res.json();
  if (data.ok) {
    applyTheme(data.theme || { players: theme.players });
    setStatus('Сохранено на сервере');
  } else {
    setStatus(data.error || 'Ошибка');
  }
}

async function reset() {
  if (!confirm('Сбросить цвета к стандартным?')) return;
  const res = await fetch('/api/theme/reset', { method: 'POST' });
  const data = await res.json();
  if (!data.ok) return setStatus('Ошибка сброса');
  location.reload();
}

fieldColor.addEventListener('input', applyCurrent);
fieldTop.addEventListener('input', applyCurrent);
fieldRight.addEventListener('input', applyCurrent);
fieldBottom.addEventListener('input', applyCurrent);
fieldLeft.addEventListener('input', applyCurrent);
document.getElementById('btn-apply').addEventListener('click', applyCurrent);
document.getElementById('btn-fill-all').addEventListener('click', fillAllFromMain);
document.getElementById('btn-save').addEventListener('click', save);
document.getElementById('btn-reset').addEventListener('click', reset);

load().catch(err => setStatus(String(err.message || err)));

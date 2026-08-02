import { BOARD, GROUP_COLORS, PLAYER_SLOTS, getGridPosition, applyTheme } from './config.js';
import { iconHTML, resolveIconSrc } from './icons.js';

const EMOJIS = [
  '🍋', '🏪', '🚕', '🚌', '☕', '🍽️', '🏨', '🛒', '🏬', '🏢',
  '🏭', '⚙️', '💻', '🚀', '🏦', '📈', '🛢️', '👑', '💎', '⚡',
  '💧', '🚂', '❓', '🔒', '👮', '🅿️', '🏁', '💰', '🚗', '🚢',
  '🎩', '🐕', '🏠', '⭐', '🔥', '🎯', '🃏', '📌',
];

let theme = { board: [], players: [] };
let selected = null; // { type: 'cell'|'player', id }

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const panelEmpty = document.getElementById('panel-empty');
const panelForm = document.getElementById('panel-form');
const previewEl = document.getElementById('preview');
const editLabel = document.getElementById('edit-label');
const fieldName = document.getElementById('field-name');
const fieldIcon = document.getElementById('field-icon');
const emojiPicker = document.getElementById('emoji-picker');
const playersStrip = document.getElementById('players-strip');

const cells = {};

function setStatus(text) {
  statusEl.textContent = text;
}

function getCellData(id) {
  return theme.board.find(c => c.id === id) || { id, name: BOARD[id].name, icon: BOARD[id].icon };
}

function getPlayerData(id) {
  return theme.players.find(p => p.id === id) || {
    id,
    token: PLAYER_SLOTS[id].token,
    tokenImage: PLAYER_SLOTS[id].tokenImage || '',
  };
}

function renderPreview(icon) {
  const src = resolveIconSrc(icon);
  if (src) {
    previewEl.innerHTML = `<img src="${src}" alt="" onerror="this.parentElement.textContent='❓'" />`;
  } else {
    previewEl.textContent = icon || '⬜';
  }
}

function buildBoard() {
  for (let i = 0; i < 40; i++) {
    const pos = getGridPosition(i);
    const base = BOARD[i];
    const data = getCellData(i);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cell cell--${base.type}`;
    el.dataset.id = i;
    el.style.gridRow = pos.row + 1;
    el.style.gridColumn = pos.col + 1;
    if (base.group) el.style.setProperty('--group-color', GROUP_COLORS[base.group]);

    el.innerHTML = cellHTML(data, i);
    el.addEventListener('click', () => selectCell(i));
    boardEl.appendChild(el);
    cells[i] = el;
  }
}

function cellHTML(data, index) {
  const isCorner = [0, 12, 20, 32].includes(index);
  const isSide = (index >= 13 && index <= 20) || (index >= 33 && index <= 39);
  const base = BOARD[index];
  const colorBar = base.group ? `<div class="cell__color-bar"></div>` : '';
  const country = base.country || '';
  const price = base.price
    ? `<span class="cell__price">$${Math.round(base.price / 1000)}K</span>`
    : '';

  return `
    ${colorBar}
    <div class="cell__body ${isSide ? 'cell__body--side' : ''} ${isCorner ? 'cell__body--corner' : ''}">
      ${base.flag ? `<span class="cell__flag">${base.flag}</span>` : iconHTML(data.icon, 'cell__icon')}
      ${country ? `<span class="cell__country">${escapeHtml(country)}</span>` : ''}
      <span class="cell__company">${escapeHtml(data.name)}</span>
      ${price}
    </div>
  `;
}

function refreshCell(id) {
  const el = cells[id];
  if (!el) return;
  el.innerHTML = cellHTML(getCellData(id), id);
  el.classList.toggle('cell--selected', selected?.type === 'cell' && selected.id === id);
}

function refreshAllCells() {
  for (let i = 0; i < 40; i++) refreshCell(i);
}

function chipLabel(id) {
  return PLAYER_SLOTS[id]?.name || `Фишка ${id + 1}`;
}

function renderPlayers() {
  playersStrip.innerHTML = theme.players.map(p => {
    const icon = p.tokenImage || p.token;
    const src = resolveIconSrc(icon);
    const color = PLAYER_SLOTS[p.id]?.color || '#888';
    const iconInner = src
      ? `<img src="${src}" alt="" />`
      : `<span class="chip" style="background:${color}"></span>`;
    const selectedCls = selected?.type === 'player' && selected.id === p.id ? 'ctor-chip--selected' : '';
    return `
      <button type="button" class="ctor-chip ${selectedCls}" data-player="${p.id}" style="border-color:${color}">
        <span class="ctor-chip__icon">${iconInner}</span>
        <span>${chipLabel(p.id)}</span>
      </button>
    `;
  }).join('');

  playersStrip.querySelectorAll('[data-player]').forEach(btn => {
    btn.addEventListener('click', () => selectPlayer(Number(btn.dataset.player)));
  });
}

function selectCell(id) {
  selected = { type: 'cell', id };
  document.querySelectorAll('.cell--selected').forEach(c => c.classList.remove('cell--selected'));
  cells[id]?.classList.add('cell--selected');
  renderPlayers();

  const data = getCellData(id);
  panelEmpty.hidden = true;
  panelForm.hidden = false;
  editLabel.textContent = `Клетка #${id}`;
  fieldName.value = data.name || '';
  fieldName.disabled = false;
  fieldIcon.value = data.icon || '';
  fieldName.placeholder = 'Название клетки';
  fieldIcon.placeholder = '🍋 или cafe.png';
  renderPreview(data.icon);
}

function selectPlayer(id) {
  selected = { type: 'player', id };
  document.querySelectorAll('.cell--selected').forEach(c => c.classList.remove('cell--selected'));
  renderPlayers();

  const data = getPlayerData(id);
  panelEmpty.hidden = true;
  panelForm.hidden = false;
  editLabel.textContent = `Фишка игрока ${id + 1}`;
  fieldName.value = data.token || '';
  fieldName.disabled = false;
  fieldName.placeholder = 'Эмодзи фишки';
  fieldIcon.value = data.tokenImage || '';
  fieldIcon.placeholder = 'player1.png (необязательно)';
  renderPreview(data.tokenImage || data.token);
}

function applyCurrent() {
  if (!selected) return;

  if (selected.type === 'cell') {
    const cell = theme.board.find(c => c.id === selected.id);
    if (!cell) return;
    cell.name = fieldName.value.trim() || cell.name;
    cell.icon = fieldIcon.value.trim() || cell.icon;
    refreshCell(selected.id);
    renderPreview(cell.icon);
    setStatus(`Обновлено: ${cell.name}`);
  } else {
    const p = theme.players.find(x => x.id === selected.id);
    if (!p) return;
    p.token = fieldName.value.trim() || p.token;
    p.tokenImage = fieldIcon.value.trim();
    renderPlayers();
    renderPreview(p.tokenImage || p.token);
    setStatus(`Фишка игрока ${p.id + 1} обновлена`);
  }
}

function buildEmojiPicker() {
  emojiPicker.innerHTML = EMOJIS.map(e =>
    `<button type="button" class="ctor-emoji" data-emoji="${e}">${e}</button>`
  ).join('');

  emojiPicker.querySelectorAll('[data-emoji]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selected) return;
      if (selected.type === 'cell') {
        fieldIcon.value = btn.dataset.emoji;
      } else {
        // для фишки эмодзи идёт в token (название-поле), картинка отдельно
        fieldName.value = btn.dataset.emoji;
        fieldIcon.value = '';
      }
      renderPreview(btn.dataset.emoji);
      applyCurrent();
    });
  });
}

async function load() {
  const res = await fetch('/api/theme');
  const data = await res.json();
  theme.board = data.board.map(c => ({ id: c.id, name: c.name, icon: c.icon || '' }));
  theme.players = data.players.map(p => ({
    id: p.id,
    token: p.token || '',
    tokenImage: p.tokenImage || '',
  }));
  applyTheme(data);
  buildBoard();
  renderPlayers();
  buildEmojiPicker();
  setStatus('Готово — кликните клетку');
}

async function save() {
  setStatus('Сохранение…');
  // синхронизировать текущую форму
  applyCurrent();
  const res = await fetch('/api/theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(theme),
  });
  const data = await res.json();
  if (data.ok) {
    setStatus('✅ Сохранено для всех игроков');
  } else {
    setStatus('❌ ' + (data.error || 'Ошибка'));
  }
}

async function reset() {
  if (!confirm('Сбросить все названия и иконки?')) return;
  const res = await fetch('/api/theme/reset', { method: 'POST' });
  const data = await res.json();
  if (!data.ok) return setStatus('❌ Ошибка сброса');
  location.reload();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

fieldIcon.addEventListener('input', () => {
  if (selected?.type === 'cell') renderPreview(fieldIcon.value);
  else renderPreview(fieldIcon.value || fieldName.value);
});

fieldName.addEventListener('input', () => {
  if (selected?.type === 'player') renderPreview(fieldIcon.value || fieldName.value);
});

fieldName.addEventListener('change', applyCurrent);
fieldIcon.addEventListener('change', applyCurrent);
document.getElementById('btn-apply').addEventListener('click', applyCurrent);
document.getElementById('btn-save').addEventListener('click', save);
document.getElementById('btn-reset').addEventListener('click', reset);

load().catch(err => setStatus('❌ ' + err.message));

/**
 * Per-CELL layout editor (logo / flag / price / tax) + ownership fill colors.
 * Drag = move. Wheel = scale that element only.
 */
import { PLAYER_SLOTS, applyTheme, normalizeHexColor, playerOwnTint } from './config.js';

const STORAGE_KEY = 'capitalist-layout-cells-v3';

const PART_SEL = {
  logo: '.cell__logo',
  flag: '.cell__country-slot',
  price: '.cell__price',
  tax: '.cell__tax',
};

const PART_MAP = {
  cell__logo: 'logo',
  'cell__country-slot': 'flag',
  cell__price: 'price',
  cell__tax: 'tax',
};

let editOn = false;
let drag = null;
let focus = null;
let styleEl = null;
let panelTab = 'layout';
let ownPlayerId = 0;
let ownDraft = null;

function boardEl() {
  return document.getElementById('board');
}
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}
function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function ensureStyle() {
  if (styleEl) return styleEl;
  styleEl = document.createElement('style');
  styleEl.id = 'layout-cell-overrides';
  document.head.appendChild(styleEl);
  return styleEl;
}

function getCellPart(data, cellId, part) {
  const cell = data[String(cellId)] || {};
  const p = cell[part] || {};
  return { x: Number(p.x || 0), y: Number(p.y || 0), s: Number(p.s != null ? p.s : 1) };
}

function setCellPart(data, cellId, part, vals) {
  const id = String(cellId);
  if (!data[id]) data[id] = {};
  data[id][part] = {
    x: Number(vals.x || 0),
    y: Number(vals.y || 0),
    s: Number(vals.s != null ? vals.s : 1),
  };
}

function exportCss(data) {
  const lines = ['/* Per-cell layout — paste into css/layout-tweak.css */'];
  for (const id of Object.keys(data).sort((a, b) => Number(a) - Number(b))) {
    const cell = data[id];
    for (const part of Object.keys(cell)) {
      if (!PART_SEL[part]) continue;
      const p = cell[part];
      const x = Number(p.x || 0);
      const y = Number(p.y || 0);
      const s = Number(p.s != null ? p.s : 1);
      if (!x && !y && s === 1) continue;
      lines.push(
        `.cell[data-id="${id}"] ${PART_SEL[part]} { transform: translate(${x}px, ${y}px) scale(${s}); }`,
      );
    }
  }
  return lines.join('\n');
}

function applyAll(data) {
  const style = ensureStyle();
  const chunks = [];
  for (const id of Object.keys(data)) {
    const cell = data[id];
    for (const part of Object.keys(cell)) {
      if (!PART_SEL[part]) continue;
      const p = getCellPart(data, id, part);
      chunks.push(
        `.cell[data-id="${id}"] ${PART_SEL[part]}{transform:translate(${p.x}px,${p.y}px) scale(${p.s}) !important}`,
      );
    }
  }
  style.textContent = chunks.join('\n');
  const ta = document.getElementById('layout-css');
  if (ta) ta.value = exportCss(data);
}

function hideAllOwnership() {
  document.querySelectorAll('[data-owner]').forEach((el) => {
    el.hidden = true;
    el.style.backgroundImage = '';
    el.style.removeProperty('--own-tint');
    el.classList.remove('layout-own-preview');
  });
  document.querySelectorAll('.cell--layout-own').forEach((c) => {
    c.classList.remove('cell--layout-own');
  });
}

function slotToDraft(slot) {
  const color = normalizeHexColor(slot.color, '#888888');
  return {
    id: slot.id,
    color,
    colorSoft: normalizeHexColor(slot.colorSoft || color, color),
    ownTop: normalizeHexColor(slot.ownTop || color, color),
    ownRight: normalizeHexColor(slot.ownRight || color, color),
    ownBottom: normalizeHexColor(slot.ownBottom || color, color),
    ownLeft: normalizeHexColor(slot.ownLeft || color, color),
  };
}

function syncOwnDraftFromSlots() {
  ownDraft = PLAYER_SLOTS.map(slotToDraft);
}

function getOwnDraft(id) {
  if (!ownDraft) syncOwnDraftFromSlots();
  return ownDraft.find((p) => p.id === id) || slotToDraft(PLAYER_SLOTS[id] || PLAYER_SLOTS[0]);
}

function paintOwnershipPreview() {
  const p = getOwnDraft(ownPlayerId);
  applyTheme({ players: [p] });
  document.querySelectorAll('[data-owner]').forEach((el) => {
    const cell = el.closest('.cell[data-id]');
    if (!cell) return;
    const side = el.dataset.side || 'top';
    el.hidden = false;
    el.classList.add('layout-own-preview');
    el.style.setProperty('--own-tint', playerOwnTint(p, side));
    cell.classList.add('cell--layout-own');
  });
}

function setOwnStatus(text) {
  const el = document.getElementById('layout-own-status');
  if (el) el.textContent = text;
}

function renderOwnPlayers() {
  const box = document.getElementById('layout-own-players');
  if (!box) return;
  box.innerHTML = PLAYER_SLOTS.map((slot) => {
    const p = getOwnDraft(slot.id);
    const sel = slot.id === ownPlayerId ? ' layout-own-chip--selected' : '';
    return `<button type="button" class="layout-own-chip${sel}" data-own-player="${slot.id}" style="--chip:${p.color}">
      <span class="layout-own-chip__swatch" style="background:${p.color}"></span>
      <span>${slot.name}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-own-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ownPlayerId = Number(btn.dataset.ownPlayer);
      fillOwnFields();
      renderOwnPlayers();
      paintOwnershipPreview();
    });
  });
}

function fillOwnFields() {
  const p = getOwnDraft(ownPlayerId);
  const map = {
    'layout-own-color': p.color,
    'layout-own-top': p.ownTop,
    'layout-own-right': p.ownRight,
    'layout-own-bottom': p.ownBottom,
    'layout-own-left': p.ownLeft,
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.value = normalizeHexColor(val, '#888888');
  }
}

function readOwnFieldsIntoDraft() {
  const p = getOwnDraft(ownPlayerId);
  p.color = document.getElementById('layout-own-color').value;
  p.colorSoft = p.color;
  p.ownTop = document.getElementById('layout-own-top').value;
  p.ownRight = document.getElementById('layout-own-right').value;
  p.ownBottom = document.getElementById('layout-own-bottom').value;
  p.ownLeft = document.getElementById('layout-own-left').value;
  applyTheme({ players: [p] });
  paintOwnershipPreview();
  renderOwnPlayers();
  setOwnStatus(`Превью · ${PLAYER_SLOTS[ownPlayerId]?.name || ''}`);
}

async function saveOwnColors() {
  readOwnFieldsIntoDraft();
  setOwnStatus('Сохранение…');
  try {
    const res = await fetch('/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: ownDraft }),
    });
    const data = await res.json();
    if (!data.ok) {
      setOwnStatus(data.error || 'Ошибка');
      return;
    }
    applyTheme(data.theme || { players: ownDraft });
    syncOwnDraftFromSlots();
    fillOwnFields();
    paintOwnershipPreview();
    setOwnStatus('Цвета сохранены');
  } catch (err) {
    setOwnStatus(String(err.message || err));
  }
}

function setPanelTab(tab) {
  panelTab = tab;
  document.body.classList.toggle('layout-edit--own', editOn && tab === 'own');
  document.body.classList.toggle('layout-edit--layout', editOn && tab === 'layout');
  const layoutSec = document.getElementById('layout-tab-layout');
  const ownSec = document.getElementById('layout-tab-own');
  if (layoutSec) layoutSec.hidden = tab !== 'layout';
  if (ownSec) ownSec.hidden = tab !== 'own';
  document.querySelectorAll('[data-layout-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.layoutTab === tab);
  });
  if (tab === 'own') {
    if (!ownDraft) syncOwnDraftFromSlots();
    renderOwnPlayers();
    fillOwnFields();
    paintOwnershipPreview();
  } else {
    hideAllOwnership();
  }
}

function ensureUi() {
  if (document.getElementById('layout-panel')) return;
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'layout-fab';
  fab.className = 'layout-fab';
  fab.textContent = 'Layout (E)';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'layout-panel';
  panel.className = 'layout-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <h2>Редактор доски</h2>
    <div class="layout-panel__tabs">
      <button type="button" data-layout-tab="layout" class="is-active">Лого / текст</button>
      <button type="button" data-layout-tab="own">Закрас</button>
    </div>
    <div id="layout-tab-layout">
      <p class="layout-panel__hint">Кликни элемент на клетке. Тяни — сдвиг. Колёсико — размер.</p>
      <div class="layout-panel__focus" id="layout-focus">Кликни лого / флаг / цену на клетке</div>
      <div id="layout-sliders"></div>
      <div class="layout-panel__row">
        <button type="button" id="layout-copy">Копировать CSS</button>
        <button type="button" class="secondary" id="layout-save">Сохранить</button>
        <button type="button" class="danger" id="layout-reset">Сброс</button>
      </div>
      <textarea id="layout-css" readonly></textarea>
    </div>
    <div id="layout-tab-own" hidden>
      <p class="layout-panel__hint">Цвет фишки и 4 варианта закраса по сторонам. Превью на всех клетках.</p>
      <div class="layout-own-players" id="layout-own-players"></div>
      <label class="layout-own-field"><span>Основной</span><input type="color" id="layout-own-color" /></label>
      <label class="layout-own-field"><span>Верх</span><input type="color" id="layout-own-top" /></label>
      <label class="layout-own-field"><span>Право</span><input type="color" id="layout-own-right" /></label>
      <label class="layout-own-field"><span>Низ</span><input type="color" id="layout-own-bottom" /></label>
      <label class="layout-own-field"><span>Лево</span><input type="color" id="layout-own-left" /></label>
      <div class="layout-panel__row">
        <button type="button" id="layout-own-fill">Залить 4 стороны</button>
        <button type="button" class="secondary" id="layout-own-save">Сохранить цвета</button>
      </div>
      <p class="layout-own-status" id="layout-own-status">Выберите фишку</p>
      <a class="layout-own-link" href="/editor.html">Открыть полный редактор закраса →</a>
    </div>
  `;
  document.body.appendChild(panel);

  const box = panel.querySelector('#layout-sliders');
  for (const axis of ['x', 'y', 's']) {
    const label = document.createElement('label');
    label.dataset.axis = axis;
    const isS = axis === 's';
    label.innerHTML =
      '<span>axis</span><span class="layout-panel__val">0</span>' +
      `<input type="range" min="${isS ? '0.4' : '-40'}" max="${isS ? '2.5' : '40'}"` +
      ` step="${isS ? '0.05' : '1'}" value="${isS ? '1' : '0'}" />`;
    box.appendChild(label);
  }

  fab.addEventListener('click', () => toggleEdit());
  panel.querySelectorAll('[data-layout-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setPanelTab(btn.dataset.layoutTab));
  });
  panel.querySelector('#layout-copy').addEventListener('click', async () => {
    const css = panel.querySelector('#layout-css').value;
    try {
      await navigator.clipboard.writeText(css);
      panel.querySelector('#layout-copy').textContent = 'Скопировано!';
      setTimeout(() => {
        panel.querySelector('#layout-copy').textContent = 'Копировать CSS';
      }, 1200);
    } catch (e) {
      panel.querySelector('#layout-css').select();
    }
  });
  panel.querySelector('#layout-save').addEventListener('click', () => {
    applyAll(loadSaved());
    panel.querySelector('#layout-save').textContent = 'OK';
    setTimeout(() => {
      panel.querySelector('#layout-save').textContent = 'Сохранить';
    }, 1000);
  });
  panel.querySelector('#layout-reset').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    ensureStyle().textContent = '';
    focus = null;
    updateFocusLabel();
    document.getElementById('layout-css').value = '';
  });
  box.addEventListener('input', () => {
    if (!focus) return;
    const data = loadSaved();
    const vals = {};
    box.querySelectorAll('label').forEach((label) => {
      const axis = label.dataset.axis;
      vals[axis] = Number(label.querySelector('input').value);
      label.querySelector('.layout-panel__val').textContent = String(vals[axis]);
    });
    setCellPart(data, focus.cellId, focus.part, vals);
    save(data);
    applyAll(data);
  });

  [
    'layout-own-color',
    'layout-own-top',
    'layout-own-right',
    'layout-own-bottom',
    'layout-own-left',
  ].forEach((id) => {
    document.getElementById(id).addEventListener('input', readOwnFieldsIntoDraft);
  });
  document.getElementById('layout-own-fill').addEventListener('click', () => {
    const c = document.getElementById('layout-own-color').value;
    document.getElementById('layout-own-top').value = c;
    document.getElementById('layout-own-right').value = c;
    document.getElementById('layout-own-bottom').value = c;
    document.getElementById('layout-own-left').value = c;
    readOwnFieldsIntoDraft();
  });
  document.getElementById('layout-own-save').addEventListener('click', saveOwnColors);
}

function updateFocusLabel() {
  const el = document.getElementById('layout-focus');
  if (!el) return;
  el.textContent = focus
    ? `Клетка #${focus.cellId} · ${focus.part}`
    : 'Кликни лого / флаг / цену на клетке';
}

function setFocus(cellId, part, node) {
  focus = { cellId: String(cellId), part };
  updateFocusLabel();
  document.querySelectorAll('.is-focus').forEach((n) => n.classList.remove('is-focus'));
  if (node) node.classList.add('is-focus');
  const p = getCellPart(loadSaved(), cellId, part);
  document.querySelectorAll('#layout-sliders label').forEach((label) => {
    const axis = label.dataset.axis;
    const val = p[axis];
    label.querySelector('input').value = String(val);
    label.querySelector('.layout-panel__val').textContent = String(val);
    label.querySelector('span').textContent = `#${cellId} ${part}.${axis}`;
  });
}

function toggleEdit(force) {
  ensureUi();
  editOn = force == null ? !editOn : !!force;
  document.body.classList.toggle('layout-edit', editOn);
  const panel = document.getElementById('layout-panel');
  if (panel) panel.hidden = !editOn;
  if (editOn) {
    applyAll(loadSaved());
    setPanelTab(panelTab || 'layout');
  } else {
    document.body.classList.remove('layout-edit--own', 'layout-edit--layout');
    hideAllOwnership();
  }
}

function partOf(el) {
  for (const cls of Object.keys(PART_MAP)) {
    if (el.classList.contains(cls)) return PART_MAP[cls];
  }
  return null;
}

function onPointerDown(e) {
  if (!editOn || panelTab !== 'layout') return;
  const t = e.target.closest('.cell__logo, .cell__country-slot, .cell__price, .cell__tax');
  if (!t) return;
  const cell = t.closest('.cell[data-id]');
  if (!cell) return;
  e.preventDefault();
  e.stopPropagation();
  const part = partOf(t);
  if (!part) return;
  const cellId = cell.dataset.id;
  setFocus(cellId, part, t);
  const p = getCellPart(loadSaved(), cellId, part);
  drag = {
    cellId,
    part,
    startX: e.clientX,
    startY: e.clientY,
    baseX: p.x,
    baseY: p.y,
    baseS: p.s,
  };
}

function onPointerMove(e) {
  if (!drag) return;
  const data = loadSaved();
  const x = drag.baseX + Math.round(e.clientX - drag.startX);
  const y = drag.baseY + Math.round(e.clientY - drag.startY);
  setCellPart(data, drag.cellId, drag.part, { x, y, s: drag.baseS });
  save(data);
  applyAll(data);
  if (focus && focus.cellId === drag.cellId && focus.part === drag.part) {
    document.querySelectorAll('#layout-sliders label').forEach((label) => {
      const axis = label.dataset.axis;
      if (axis === 's') return;
      const val = axis === 'x' ? x : y;
      label.querySelector('input').value = String(val);
      label.querySelector('.layout-panel__val').textContent = String(val);
    });
  }
}

function onPointerUp() {
  drag = null;
}

function onWheel(e) {
  if (!editOn || panelTab !== 'layout') return;
  const t = e.target.closest('.cell__logo, .cell__country-slot, .cell__price, .cell__tax');
  if (!t) return;
  const cell = t.closest('.cell[data-id]');
  if (!cell) return;
  e.preventDefault();
  const part = partOf(t);
  if (!part) return;
  const cellId = cell.dataset.id;
  setFocus(cellId, part, t);
  const data = loadSaved();
  const p = getCellPart(data, cellId, part);
  const step = e.shiftKey ? 0.1 : 0.05;
  let s = p.s + (e.deltaY < 0 ? step : -step);
  s = Math.max(0.4, Math.min(2.5, Math.round(s * 100) / 100));
  setCellPart(data, cellId, part, { x: p.x, y: p.y, s });
  save(data);
  applyAll(data);
  document.querySelectorAll('#layout-sliders label').forEach((label) => {
    if (label.dataset.axis !== 's') return;
    label.querySelector('input').value = String(s);
    label.querySelector('.layout-panel__val').textContent = String(s);
  });
}

export function initLayoutTweak() {
  ensureUi();
  syncOwnDraftFromSlots();
  const saved = loadSaved();
  if (Object.keys(saved).length) {
    const boot = () => {
      if (!boardEl()) {
        setTimeout(boot, 200);
        return;
      }
      applyAll(saved);
    };
    boot();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E') {
      if (e.target.matches && e.target.matches('input, textarea')) return;
      toggleEdit();
    }
    if (e.key === 'Escape' && editOn) toggleEdit(false);
  });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  if (new URLSearchParams(location.search).has('edit')) {
    const start = () => {
      if (boardEl()) toggleEdit(true);
      else setTimeout(start, 300);
    };
    start();
  }
}

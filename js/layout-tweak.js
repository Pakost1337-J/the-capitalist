/**
 * Per-CELL layout editor (logo / flag / price / tax).
 * Drag = move. Wheel = scale that element only.
 */
const STORAGE_KEY = 'capitalist-layout-cells-v3';

const PART_SEL = {
  logo: '.cell__logo',
  flag: '.cell__country-slot',
  price: '.cell__price',
  tax: '.cell__tax',
};

const PART_MAP = {
  'cell__logo': 'logo',
  'cell__country-slot': 'flag',
  'cell__price': 'price',
  'cell__tax': 'tax',
};

let editOn = false;
let drag = null;
let focus = null;
let styleEl = null;

function boardEl() { return document.getElementById('board'); }
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch (e) { return {}; }
}
function save(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

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
  data[id][part] = { x: Number(vals.x || 0), y: Number(vals.y || 0), s: Number(vals.s != null ? vals.s : 1) };
}

function exportCss(data) {
  const lines = ['/* Per-cell layout — paste into css/layout-tweak.css */'];
  for (const id of Object.keys(data).sort((a, b) => Number(a) - Number(b))) {
    const cell = data[id];
    for (const part of Object.keys(cell)) {
      if (!PART_SEL[part]) continue;
      const p = cell[part];
      const x = Number(p.x || 0), y = Number(p.y || 0), s = Number(p.s != null ? p.s : 1);
      if (!x && !y && s === 1) continue;
      lines.push('.cell[data-id="' + id + '"] ' + PART_SEL[part] + ' { transform: translate(' + x + 'px, ' + y + 'px) scale(' + s + '); }');
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
      chunks.push('.cell[data-id="' + id + '"] ' + PART_SEL[part] + '{transform:translate(' + p.x + 'px,' + p.y + 'px) scale(' + p.s + ') !important}');
    }
  }
  style.textContent = chunks.join('\n');
  const ta = document.getElementById('layout-css');
  if (ta) ta.value = exportCss(data);
}

function hideAllOwnership() {
  document.querySelectorAll('[data-owner]').forEach(function (el) {
    el.hidden = true;
    el.style.backgroundImage = '';
    el.classList.remove('layout-own-preview');
  });
  document.querySelectorAll('.cell--layout-own').forEach(function (c) {
    c.classList.remove('cell--layout-own');
  });
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
  panel.innerHTML =
    '<h2>Правка лого / текста</h2>' +
    '<p class="layout-panel__hint">Кликни элемент на клетке. Тяни — сдвиг. Колёсико — размер только его.</p>' +
    '<div class="layout-panel__focus" id="layout-focus">Кликни лого / флаг / цену на клетке</div>' +
    '<div id="layout-sliders"></div>' +
    '<div class="layout-panel__row">' +
    '<button type="button" id="layout-copy">Копировать CSS</button>' +
    '<button type="button" class="secondary" id="layout-save">Сохранить</button>' +
    '<button type="button" class="danger" id="layout-reset">Сброс</button>' +
    '</div><textarea id="layout-css" readonly></textarea>';
  document.body.appendChild(panel);

  const box = panel.querySelector('#layout-sliders');
  for (const axis of ['x', 'y', 's']) {
    const label = document.createElement('label');
    label.dataset.axis = axis;
    const isS = axis === 's';
    label.innerHTML =
      '<span>axis</span><span class="layout-panel__val">0</span>' +
      '<input type="range" min="' + (isS ? '0.4' : '-40') + '" max="' + (isS ? '2.5' : '40') +
      '" step="' + (isS ? '0.05' : '1') + '" value="' + (isS ? '1' : '0') + '" />';
    box.appendChild(label);
  }

  fab.addEventListener('click', function () { toggleEdit(); });
  panel.querySelector('#layout-copy').addEventListener('click', async function () {
    const css = panel.querySelector('#layout-css').value;
    try {
      await navigator.clipboard.writeText(css);
      panel.querySelector('#layout-copy').textContent = 'Скопировано!';
      setTimeout(function () { panel.querySelector('#layout-copy').textContent = 'Копировать CSS'; }, 1200);
    } catch (e) { panel.querySelector('#layout-css').select(); }
  });
  panel.querySelector('#layout-save').addEventListener('click', function () {
    applyAll(loadSaved());
    panel.querySelector('#layout-save').textContent = 'OK';
    setTimeout(function () { panel.querySelector('#layout-save').textContent = 'Сохранить'; }, 1000);
  });
  panel.querySelector('#layout-reset').addEventListener('click', function () {
    localStorage.removeItem(STORAGE_KEY);
    ensureStyle().textContent = '';
    focus = null;
    updateFocusLabel();
    document.getElementById('layout-css').value = '';
  });
  box.addEventListener('input', function () {
    if (!focus) return;
    const data = loadSaved();
    const vals = {};
    box.querySelectorAll('label').forEach(function (label) {
      const axis = label.dataset.axis;
      vals[axis] = Number(label.querySelector('input').value);
      label.querySelector('.layout-panel__val').textContent = String(vals[axis]);
    });
    setCellPart(data, focus.cellId, focus.part, vals);
    save(data);
    applyAll(data);
  });
}

function updateFocusLabel() {
  const el = document.getElementById('layout-focus');
  if (!el) return;
  el.textContent = focus
    ? ('Клетка #' + focus.cellId + ' · ' + focus.part)
    : 'Кликни лого / флаг / цену на клетке';
}

function setFocus(cellId, part, node) {
  focus = { cellId: String(cellId), part: part };
  updateFocusLabel();
  document.querySelectorAll('.is-focus').forEach(function (n) { n.classList.remove('is-focus'); });
  if (node) node.classList.add('is-focus');
  const p = getCellPart(loadSaved(), cellId, part);
  document.querySelectorAll('#layout-sliders label').forEach(function (label) {
    const axis = label.dataset.axis;
    const val = p[axis];
    label.querySelector('input').value = String(val);
    label.querySelector('.layout-panel__val').textContent = String(val);
    label.querySelector('span').textContent = '#' + cellId + ' ' + part + '.' + axis;
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
  if (!editOn) return;
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
  drag = { cellId: cellId, part: part, startX: e.clientX, startY: e.clientY, baseX: p.x, baseY: p.y, baseS: p.s };
}

function onPointerMove(e) {
  if (!drag) return;
  const data = loadSaved();
  const x = drag.baseX + Math.round(e.clientX - drag.startX);
  const y = drag.baseY + Math.round(e.clientY - drag.startY);
  setCellPart(data, drag.cellId, drag.part, { x: x, y: y, s: drag.baseS });
  save(data);
  applyAll(data);
  if (focus && focus.cellId === drag.cellId && focus.part === drag.part) {
    document.querySelectorAll('#layout-sliders label').forEach(function (label) {
      const axis = label.dataset.axis;
      if (axis === 's') return;
      const val = axis === 'x' ? x : y;
      label.querySelector('input').value = String(val);
      label.querySelector('.layout-panel__val').textContent = String(val);
    });
  }
}

function onPointerUp() { drag = null; }

function onWheel(e) {
  if (!editOn) return;
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
  setCellPart(data, cellId, part, { x: p.x, y: p.y, s: s });
  save(data);
  applyAll(data);
  document.querySelectorAll('#layout-sliders label').forEach(function (label) {
    if (label.dataset.axis !== 's') return;
    label.querySelector('input').value = String(s);
    label.querySelector('.layout-panel__val').textContent = String(s);
  });
}

export function initLayoutTweak() {
  ensureUi();
  const saved = loadSaved();
  if (Object.keys(saved).length) {
    const boot = function () {
      if (!boardEl()) { setTimeout(boot, 200); return; }
      applyAll(saved);
    };
    boot();
  }
  document.addEventListener('keydown', function (e) {
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
    const start = function () { if (boardEl()) toggleEdit(true); else setTimeout(start, 300); };
    start();
  }
}

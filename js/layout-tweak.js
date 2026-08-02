/**
 * Per-CELL layout editor: logo / flag / price / tax / ownership fill.
 * Drag = move. Wheel = scale that element only.
 */
import { PLAYER_SLOTS, playerOwnTint } from './config.js';

const STORAGE_KEY = 'capitalist-layout-cells-v3';

const PART_SEL = {
  logo: '.cell__logo',
  flag: '.cell__country-slot',
  price: '.cell__price',
  tax: '.cell__tax',
  own: '.cell__owner',
};

const PART_MAP = {
  cell__logo: 'logo',
  'cell__country-slot': 'flag',
  cell__price: 'price',
  cell__tax: 'tax',
  cell__owner: 'own',
};

let editOn = false;
let drag = null;
let focus = null;
let styleEl = null;
let panelTab = 'layout';

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
  syncCssTextareas();
}

function hideAllOwnership() {
  document.querySelectorAll('[data-owner]').forEach((el) => {
    el.hidden = true;
    el.style.removeProperty('--own-tint');
    el.classList.remove('layout-own-preview', 'is-focus');
  });
  document.querySelectorAll('.cell--layout-own').forEach((c) => {
    c.classList.remove('cell--layout-own');
  });
}

function paintOwnershipPreview() {
  const slot = PLAYER_SLOTS[0];
  document.querySelectorAll('[data-owner]').forEach((el) => {
    const cell = el.closest('.cell[data-id]');
    if (!cell) return;
    const side = el.dataset.side || 'top';
    el.hidden = false;
    el.classList.add('layout-own-preview');
    el.style.setProperty('--own-tint', playerOwnTint(slot, side));
    cell.classList.add('cell--layout-own');
  });
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
    paintOwnershipPreview();
    focus = null;
    updateFocusLabel();
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
      <p class="layout-panel__hint">Кликни лого / флаг / цену. Тяни — сдвиг. Колёсико — размер.</p>
      <div class="layout-panel__focus" id="layout-focus">Кликни элемент на клетке</div>
      <div id="layout-sliders"></div>
      <div class="layout-panel__row">
        <button type="button" id="layout-copy">Копировать CSS</button>
        <button type="button" class="secondary" id="layout-save">Сохранить</button>
        <button type="button" class="danger" id="layout-reset">Сброс</button>
      </div>
      <textarea id="layout-css" readonly></textarea>
    </div>
    <div id="layout-tab-own" hidden>
      <p class="layout-panel__hint">Кликни закрас на клетке. Тяни — сдвиг. Колёсико — размер. Цвета — в отдельном редакторе.</p>
      <div class="layout-panel__focus" id="layout-own-focus">Кликни закрас на клетке</div>
      <div id="layout-own-sliders"></div>
      <div class="layout-panel__row">
        <button type="button" id="layout-own-copy">Копировать CSS</button>
        <button type="button" class="secondary" id="layout-own-save">Сохранить</button>
        <button type="button" class="danger" id="layout-own-reset">Сброс закраса</button>
      </div>
      <textarea id="layout-own-css" readonly></textarea>
      <a class="layout-own-link" href="/editor.html">Цвета закраса →</a>
    </div>
  `;
  document.body.appendChild(panel);

  for (const boxId of ['layout-sliders', 'layout-own-sliders']) {
    const box = panel.querySelector('#' + boxId);
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
    box.addEventListener('input', () => onSliderInput(box));
  }

  fab.addEventListener('click', () => toggleEdit());
  panel.querySelectorAll('[data-layout-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setPanelTab(btn.dataset.layoutTab));
  });

  bindCopySaveReset('layout-copy', 'layout-save', 'layout-reset', 'layout-css', false);
  bindCopySaveReset('layout-own-copy', 'layout-own-save', 'layout-own-reset', 'layout-own-css', true);
}

function bindCopySaveReset(copyId, saveId, resetId, cssId, ownOnly) {
  const panel = document.getElementById('layout-panel');
  panel.querySelector('#' + copyId).addEventListener('click', async () => {
    const css = panel.querySelector('#' + cssId).value;
    try {
      await navigator.clipboard.writeText(css);
      const btn = panel.querySelector('#' + copyId);
      btn.textContent = 'Скопировано!';
      setTimeout(() => { btn.textContent = 'Копировать CSS'; }, 1200);
    } catch (e) {
      panel.querySelector('#' + cssId).select();
    }
  });
  panel.querySelector('#' + saveId).addEventListener('click', () => {
    applyAll(loadSaved());
    const btn = panel.querySelector('#' + saveId);
    btn.textContent = 'OK';
    setTimeout(() => { btn.textContent = 'Сохранить'; }, 1000);
  });
  panel.querySelector('#' + resetId).addEventListener('click', () => {
    if (ownOnly) {
      const data = loadSaved();
      for (const id of Object.keys(data)) {
        if (data[id]?.own) delete data[id].own;
        if (data[id] && !Object.keys(data[id]).length) delete data[id];
      }
      save(data);
      applyAll(data);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      ensureStyle().textContent = '';
      applyAll({});
    }
    focus = null;
    updateFocusLabel();
    if (panelTab === 'own') paintOwnershipPreview();
  });
}

function syncCssTextareas() {
  const css = exportCss(loadSaved());
  const a = document.getElementById('layout-css');
  const b = document.getElementById('layout-own-css');
  if (a) a.value = css;
  if (b) b.value = css;
}

function onSliderInput(box) {
  if (!focus) return;
  if (panelTab === 'own' && focus.part !== 'own') return;
  if (panelTab === 'layout' && focus.part === 'own') return;
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
}

function focusLabelEl() {
  return document.getElementById(panelTab === 'own' ? 'layout-own-focus' : 'layout-focus');
}

function sliderBox() {
  return document.getElementById(panelTab === 'own' ? 'layout-own-sliders' : 'layout-sliders');
}

function updateFocusLabel() {
  const el = focusLabelEl();
  if (!el) return;
  if (panelTab === 'own') {
    el.textContent = focus?.part === 'own'
      ? `Клетка #${focus.cellId} · закрас`
      : 'Кликни закрас на клетке';
    return;
  }
  el.textContent = focus && focus.part !== 'own'
    ? `Клетка #${focus.cellId} · ${focus.part}`
    : 'Кликни лого / флаг / цену на клетке';
}

function setFocus(cellId, part, node) {
  focus = { cellId: String(cellId), part };
  updateFocusLabel();
  document.querySelectorAll('.is-focus').forEach((n) => n.classList.remove('is-focus'));
  if (node) node.classList.add('is-focus');
  const p = getCellPart(loadSaved(), cellId, part);
  const box = sliderBox();
  if (!box) return;
  box.querySelectorAll('label').forEach((label) => {
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
  if (!editOn) return;
  let t;
  if (panelTab === 'own') {
    t = e.target.closest('.cell__owner');
  } else {
    t = e.target.closest('.cell__logo, .cell__country-slot, .cell__price, .cell__tax');
  }
  if (!t) return;
  const cell = t.closest('.cell[data-id]');
  if (!cell) return;
  e.preventDefault();
  e.stopPropagation();
  const part = partOf(t);
  if (!part) return;
  if (panelTab === 'own' && part !== 'own') return;
  if (panelTab === 'layout' && part === 'own') return;
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
    const box = sliderBox();
    box?.querySelectorAll('label').forEach((label) => {
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
  if (!editOn) return;
  let t;
  if (panelTab === 'own') {
    t = e.target.closest('.cell__owner');
  } else {
    t = e.target.closest('.cell__logo, .cell__country-slot, .cell__price, .cell__tax');
  }
  if (!t) return;
  const cell = t.closest('.cell[data-id]');
  if (!cell) return;
  e.preventDefault();
  const part = partOf(t);
  if (!part) return;
  if (panelTab === 'own' && part !== 'own') return;
  if (panelTab === 'layout' && part === 'own') return;
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
  sliderBox()?.querySelectorAll('label').forEach((label) => {
    if (label.dataset.axis !== 's') return;
    label.querySelector('input').value = String(s);
    label.querySelector('.layout-panel__val').textContent = String(s);
  });
}

export function initLayoutTweak() {
  ensureUi();
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

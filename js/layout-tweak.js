/**
 * Apply saved per-cell layout transforms (no editor UI).
 */
const STORAGE_KEY = 'capitalist-layout-cells-v3';

const PART_SEL = {
  logo: '.cell__logo',
  flag: '.cell__country-slot',
  price: '.cell__price',
  tax: '.cell__tax',
  own: '.cell__owner',
};

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function ensureStyle() {
  let styleEl = document.getElementById('layout-cell-overrides');
  if (styleEl) return styleEl;
  styleEl = document.createElement('style');
  styleEl.id = 'layout-cell-overrides';
  document.head.appendChild(styleEl);
  return styleEl;
}

function applyAll(data) {
  const style = ensureStyle();
  const chunks = [];
  for (const id of Object.keys(data)) {
    const cell = data[id] || {};
    for (const part of Object.keys(cell)) {
      if (!PART_SEL[part]) continue;
      const p = cell[part] || {};
      const x = Number(p.x || 0);
      const y = Number(p.y || 0);
      const s = Number(p.s != null ? p.s : 1);
      if (!x && !y && s === 1) continue;
      chunks.push(
        `.cell[data-id="${id}"] ${PART_SEL[part]}{transform:translate(${x}px,${y}px) scale(${s}) !important}`,
      );
    }
  }
  style.textContent = chunks.join('\n');
}

/** Apply saved cell tweaks; editor panel removed. */
export function initLayoutTweak() {
  const saved = loadSaved();
  if (!Object.keys(saved).length) return;
  const boot = () => {
    if (!document.getElementById('board')) {
      setTimeout(boot, 200);
      return;
    }
    applyAll(saved);
  };
  boot();
}

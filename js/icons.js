/**
 * Иконки клеток и фишек игроков.
 */

export const DEFAULT_PLAYER_TOKENS = [
  { id: 0, color: '#e11d48', token: 'pawn', tokenImage: '' },
  { id: 1, color: '#2563eb', token: 'pawn', tokenImage: '' },
  { id: 2, color: '#ca8a04', token: 'pawn', tokenImage: '' },
  { id: 3, color: '#16a34a', token: 'pawn', tokenImage: '' },
  { id: 4, color: '#db2777', token: 'pawn', tokenImage: '' },
];

/** Дефолтные иконки для клеток (id → icon) — доска по референсу */
export const DEFAULT_CELL_ICONS = {
  0: '🏁',
  1: '🚗',
  2: '🛒',
  3: '🛢️',
  4: '📺',
  5: '⚠',
  6: '📱',
  7: '❓',
  8: '🥛',
  9: '🍾',
  10: '💻',
  11: '💄',
  12: '🔒',
  13: '🛋️',
  14: '🚙',
  15: '👔',
  16: '%',
  17: '👗',
  18: '🏎️',
  19: '🅿️',
  20: '🎧',
  21: '📡',
  22: '📷',
  23: '🚙',
  24: '⚠',
  25: '🚗',
  26: '❓',
  27: '⚙️',
  28: '👟',
  29: '📱',
  30: '🚘',
  31: '👮',
  32: '🍫',
  33: '⌚',
  34: '%',
  35: '🍔',
  36: '🏰',
  37: '🥤',
};

export function resolveIconSrc(icon) {
  if (!icon) return null;
  const s = String(icon).trim();
  if (!s) return null;

  if (
    s.startsWith('/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('assets/') ||
    /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(s)
  ) {
    if (s.startsWith('http') || s.startsWith('/')) return s;
    if (s.startsWith('assets/')) return '/' + s;
    return '/assets/icons/' + s.replace(/^\/+/, '');
  }

  return null;
}

export function iconHTML(icon, className = 'icon') {
  const src = resolveIconSrc(icon);
  if (src) {
    return `<img class="${className} ${className}--img" src="${src}" alt="" />`;
  }
  return `<span class="${className} ${className}--emoji">${icon || ''}</span>`;
}

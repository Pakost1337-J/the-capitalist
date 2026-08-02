/**
 * Иконки клеток и фишек игроков.
 *
 * Как задать иконку:
 * 1) Эмодзи: "🍋"
 * 2) Картинка из папки assets/icons/: "kiosk.png"
 *    (файл положите в assets/icons/kiosk.png)
 * 3) Полный путь: "/assets/icons/kiosk.png"
 *
 * Редактор: откройте /editor.html на сайте
 */

export const DEFAULT_PLAYER_TOKENS = [
  { id: 0, color: '#ef4444', token: '🚗', tokenImage: '' },
  { id: 1, color: '#3b82f6', token: '🚢', tokenImage: '' },
  { id: 2, color: '#22c55e', token: '🎩', tokenImage: '' },
  { id: 3, color: '#f59e0b', token: '🐕', tokenImage: '' },
  { id: 4, color: '#a855f7', token: '🚀', tokenImage: '' },
];

/** Дефолтные иконки для клеток (id → icon) */
export const DEFAULT_CELL_ICONS = {
  0: '🏁',
  1: '🍋',
  2: '❓',
  3: '🏪',
  4: '💸',
  5: '🚂',
  6: '🚕',
  7: '❓',
  8: '🚌',
  9: '🚐',
  10: '🔒',
  11: '☕',
  12: '⚡',
  13: '🍽️',
  14: '🏨',
  15: '🚂',
  16: '🛒',
  17: '❓',
  18: '🏬',
  19: '🏢',
  20: '🅿️',
  21: '🏭',
  22: '❓',
  23: '⚙️',
  24: '🏗️',
  25: '🚂',
  26: '💻',
  27: '🚀',
  28: '💧',
  29: '🏛️',
  30: '👮',
  31: '🏦',
  32: '📈',
  33: '❓',
  34: '💼',
  35: '🚂',
  36: '❓',
  37: '🛢️',
  38: '💎',
  39: '👑',
};

export function resolveIconSrc(icon) {
  if (!icon) return null;
  const s = String(icon).trim();
  if (!s) return null;

  // Картинка по имени файла или пути
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

  return null; // эмодзи / текст
}

export function iconHTML(icon, className = 'icon') {
  const src = resolveIconSrc(icon);
  if (src) {
    return `<img class="${className} ${className}--img" src="${src}" alt="" />`;
  }
  return `<span class="${className} ${className}--emoji">${icon || ''}</span>`;
}

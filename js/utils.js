export function formatMoney(value) {
  if (value < 0) return '-$' + formatMoney(-value).slice(1);
  if (value >= 1e9) return '$' + (value / 1e9).toFixed(1) + 'B';
  return '$' + Math.floor(value).toLocaleString('ru-RU');
}

/** Короткий формат цены на клетке: $60K, $1.5M */
export function formatPriceShort(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1e6) {
    const m = v / 1e6;
    return `${sign}$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (v >= 1000) {
    const k = v / 1000;
    return `${sign}$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(0)}K`;
  }
  return `${sign}$${v}`;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

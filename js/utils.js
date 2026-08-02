export function formatMoney(value) {
  if (value < 0) return '-$' + formatMoney(-value).slice(1);
  if (value >= 1e9) return '$' + (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e4) return '$' + Math.floor(value).toLocaleString('ru-RU');
  return '$' + value;
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

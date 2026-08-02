import { sleep } from './utils.js';

/** Итоговый поворот куба, чтобы грань N смотрела на камеру */
export const DIE_FACE_ROT = {
  1: { x: 0, y: 0 },
  2: { x: -90, y: 0 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  5: { x: 90, y: 0 },
  6: { x: 0, y: 180 },
};

export function makeDieFaceHTML(n) {
  const pips = Array.from({ length: 9 }, () => '<span class="die__pip"></span>').join('');
  return `<div class="die-face die-face--${n}" data-face="${n}">${pips}</div>`;
}

export function makeDieCubeHTML() {
  return [1, 2, 3, 4, 5, 6].map(makeDieFaceHTML).join('');
}

/**
 * Реалистичный бросок: падение + кувырок + отскок, затем фиксация грани.
 */
export async function throwDice(dieThrowEls, cubes, values, { doubles = false } = {}) {
  const [v1, v2] = values.map(v => Math.min(6, Math.max(1, Number(v) || 1)));

  await Promise.all([
    throwOneDie(dieThrowEls[0], cubes[0], v1, 0, doubles),
    throwOneDie(dieThrowEls[1], cubes[1], v2, 90, doubles),
  ]);
}

async function throwOneDie(throwEl, cube, value, delayMs, doubles) {
  if (!throwEl || !cube) return;

  const face = DIE_FACE_ROT[value] || DIE_FACE_ROT[1];
  const spinsX = 360 * (3 + Math.floor(Math.random() * 3));
  const spinsY = 360 * (2 + Math.floor(Math.random() * 4));
  const landX = spinsX + face.x;
  const landY = spinsY + face.y;
  const drift = (Math.random() - 0.5) * 36;

  throwEl.classList.toggle('die-throw--doubles', !!doubles);
  throwEl.classList.remove('die-throw--landing', 'die-throw--idle');
  throwEl.classList.add('die-throw--air');

  cube.style.transition = 'none';
  cube.style.transform = `rotateX(${face.x - 40}deg) rotateY(${face.y + 20}deg)`;
  throwEl.style.setProperty('--drift', `${drift}px`);
  void cube.offsetWidth;

  if (delayMs) await sleep(delayMs);

  // Фаза кувырка в воздухе
  cube.style.transition = 'transform 0.85s cubic-bezier(0.15, 0.75, 0.2, 1)';
  cube.style.transform = `rotateX(${landX}deg) rotateY(${landY}deg)`;

  throwEl.classList.remove('die-throw--air');
  void throwEl.offsetWidth;
  throwEl.classList.add('die-throw--landing');

  await sleep(950);

  // Зафиксировать без лишних оборотов (нормализуем)
  cube.style.transition = 'none';
  cube.style.transform = `rotateX(${face.x}deg) rotateY(${face.y}deg)`;
  throwEl.classList.remove('die-throw--landing');
  throwEl.classList.add('die-throw--idle');
  void cube.offsetWidth;
}

/** Путь по полю вперёд от from до to (по часовой, 0..39) */
export function boardPath(from, to) {
  const start = ((from % 40) + 40) % 40;
  const end = ((to % 40) + 40) % 40;
  const steps = (end - start + 40) % 40;
  const path = [];
  for (let i = 1; i <= steps; i++) path.push((start + i) % 40);
  return path;
}

export function boardPathBack(from, stepsBack) {
  const start = ((from % 40) + 40) % 40;
  const path = [];
  for (let i = 1; i <= stepsBack; i++) path.push((start - i + 40) % 40);
  return path;
}

export function resolveMovePath(from, to, diceSum) {
  const forward = (to - from + 40) % 40;
  const back = (from - to + 40) % 40;

  if (forward === 0) return { path: [], teleport: false };

  // Обычный ход по кубикам
  if (diceSum > 0 && forward === diceSum) {
    return { path: boardPath(from, to), teleport: false };
  }

  // Назад на 1–3 клетки
  if (back > 0 && back <= 3 && forward > 20) {
    return { path: boardPathBack(from, back), teleport: false };
  }

  // Телепорт (тюрьма, парковка и т.п.)
  if (forward > 12) {
    return { path: [to], teleport: true };
  }

  return { path: boardPath(from, to), teleport: false };
}

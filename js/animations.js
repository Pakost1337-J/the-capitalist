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
 * Реалистичный бросок на стол: замах → полёт с кувырком → несколько отскоков → остановка.
 */
export async function throwDice(dieThrowEls, cubes, values, { doubles = false, stageEl = null } = {}) {
  const [v1, v2] = values.map(v => Math.min(6, Math.max(1, Number(v) || 1)));
  stageEl?.classList.add('table-toss--throwing');

  await Promise.all([
    throwOneDie(dieThrowEls[0], cubes[0], v1, 0, doubles),
    throwOneDie(dieThrowEls[1], cubes[1], v2, 120, doubles),
  ]);

  stageEl?.classList.remove('table-toss--throwing');
  stageEl?.classList.add('table-toss--landed');
  setTimeout(() => stageEl?.classList.remove('table-toss--landed'), 800);
}

async function throwOneDie(throwEl, cube, value, delayMs, doubles) {
  if (!throwEl || !cube) return;

  const face = DIE_FACE_ROT[value] || DIE_FACE_ROT[1];
  const spinsX = 360 * (4 + Math.floor(Math.random() * 3));
  const spinsY = 360 * (3 + Math.floor(Math.random() * 3));
  const spinsZ = 180 * (1 + Math.floor(Math.random() * 2));
  const landX = spinsX + face.x;
  const landY = spinsY + face.y;
  const startX = (Math.random() - 0.5) * 80;
  const endX = (Math.random() - 0.5) * 50;
  const endRot = (Math.random() - 0.5) * 18;

  throwEl.classList.toggle('die-throw--doubles', !!doubles);
  throwEl.classList.remove('die-throw--idle', 'die-throw--bounce');
  throwEl.style.setProperty('--sx', `${startX}px`);
  throwEl.style.setProperty('--ex', `${endX}px`);
  throwEl.style.setProperty('--erot', `${endRot}deg`);

  // Старт: в «руке» над столом
  cube.style.transition = 'none';
  throwEl.style.transition = 'none';
  cube.style.transform = `rotateX(${-20}deg) rotateY(${30}deg) rotateZ(0deg)`;
  throwEl.style.transform = `translate3d(${startX}px, -120px, 40px) scale(0.75)`;
  throwEl.style.opacity = '0.4';
  void cube.offsetWidth;

  if (delayMs) await sleep(delayMs);

  // Полёт + кувырок
  throwEl.style.transition = 'transform 0.55s cubic-bezier(0.15, 0.6, 0.25, 1), opacity 0.2s ease';
  cube.style.transition = 'transform 0.55s cubic-bezier(0.12, 0.7, 0.2, 1)';
  throwEl.style.opacity = '1';
  throwEl.style.transform = `translate3d(${endX * 0.4}px, 8px, 0) scale(1.05)`;
  cube.style.transform = `rotateX(${landX * 0.55}deg) rotateY(${landY * 0.55}deg) rotateZ(${spinsZ * 0.5}deg)`;

  await sleep(520);

  // Первый отскок
  throwEl.style.transition = 'transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)';
  cube.style.transition = 'transform 0.18s linear';
  throwEl.style.transform = `translate3d(${endX * 0.7}px, -22px, 0) scale(1)`;
  cube.style.transform = `rotateX(${landX * 0.78}deg) rotateY(${landY * 0.78}deg) rotateZ(${spinsZ * 0.75}deg)`;
  await sleep(170);

  // Второй отскок
  throwEl.style.transition = 'transform 0.16s cubic-bezier(0.3, 0.8, 0.3, 1)';
  throwEl.style.transform = `translate3d(${endX * 0.9}px, 4px, 0) scale(1.02)`;
  cube.style.transform = `rotateX(${landX * 0.92}deg) rotateY(${landY * 0.92}deg) rotateZ(${spinsZ * 0.92}deg)`;
  await sleep(150);

  // Третий мелкий
  throwEl.style.transition = 'transform 0.14s ease-out';
  throwEl.style.transform = `translate3d(${endX}px, -8px, 0) rotate(${endRot * 0.5}deg)`;
  await sleep(130);

  // Фиксация на столе
  throwEl.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.85, 0.3, 1)';
  cube.style.transition = 'transform 0.25s ease-out';
  throwEl.style.transform = `translate3d(${endX}px, 0, 0) rotate(${endRot}deg)`;
  cube.style.transform = `rotateX(${landX}deg) rotateY(${landY}deg) rotateZ(${spinsZ}deg)`;
  await sleep(260);

  // Нормализуем грань без лишних оборотов
  cube.style.transition = 'none';
  cube.style.transform = `rotateX(${face.x}deg) rotateY(${face.y}deg) rotateZ(0deg)`;
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

  if (diceSum > 0 && forward === diceSum) {
    return { path: boardPath(from, to), teleport: false };
  }

  if (back > 0 && back <= 3 && forward > 20) {
    return { path: boardPathBack(from, back), teleport: false };
  }

  if (forward > 12) {
    return { path: [to], teleport: true };
  }

  return { path: boardPath(from, to), teleport: false };
}

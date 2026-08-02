import { BOARD_SIZE } from './config.js';
import { sleep } from './utils.js';

/**
 * Поворот куба, чтобы грань N была СВЕРХУ.
 * Грани: 1 front, 2 top, 3 right, 4 left, 5 bottom, 6 back.
 */
export const DIE_TOP_ROT = {
  1: { x: 90, y: 0 },
  2: { x: 0, y: 0 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  5: { x: 180, y: 0 },
  6: { x: -90, y: 0 },
};

/** @deprecated */
export const DIE_FACE_ROT = DIE_TOP_ROT;

export function makeDieFaceHTML(n) {
  const pips = Array.from({ length: 9 }, () => '<span class="die__pip"></span>').join('');
  return `<div class="die-face die-face--${n}" data-face="${n}">${pips}</div>`;
}

export function makeDieCubeHTML() {
  return [1, 2, 3, 4, 5, 6].map(makeDieFaceHTML).join('');
}

export function dieRestPose(value, { restZ = 0, restX = 0 } = {}) {
  const face = DIE_TOP_ROT[value] || DIE_TOP_ROT[1];
  return {
    cube: `rotateX(${face.x}deg) rotateY(${face.y}deg)`,
    throw: `translate3d(${restX}px, 0, 0) rotateZ(${restZ}deg)`,
    face,
  };
}

/**
 * Короткий чистый бросок: вверх → вниз с одним оборотом → стоп.
 * Без хаотичных мультиспинов.
 */
export async function throwDice(dieThrowEls, cubes, values, { doubles = false, stageEl = null } = {}) {
  const [v1, v2] = values.map(v => Math.min(6, Math.max(1, Number(v) || 1)));
  stageEl?.classList.remove('table-toss--landed');
  stageEl?.classList.add('table-toss--throwing');

  await Promise.all([
    throwOneDie(dieThrowEls[0], cubes[0], v1, 0, doubles, { restZ: -6, restX: -10 }),
    throwOneDie(dieThrowEls[1], cubes[1], v2, 90, doubles, { restZ: 10, restX: 12 }),
  ]);

  stageEl?.classList.remove('table-toss--throwing');
  stageEl?.classList.add('table-toss--landed');
}

async function throwOneDie(throwEl, cube, value, delayMs, doubles, rest) {
  if (!throwEl || !cube) return;

  const face = DIE_TOP_ROT[value] || DIE_TOP_ROT[1];
  const endX = rest.restX;
  const endRot = rest.restZ;
  const shadow = throwEl.querySelector('.die-shadow');

  // Ровно один оборот по X/Y + выход на нужную грань
  const landX = 360 + face.x;
  const landY = 360 + face.y;

  throwEl.classList.toggle('die-throw--doubles', !!doubles);
  throwEl.classList.remove('die-throw--idle');
  throwEl.dataset.restZ = String(endRot);
  throwEl.dataset.restX = String(endX);

  const setShadow = (opacity, scale) => {
    if (!shadow) return;
    shadow.style.opacity = String(opacity);
    shadow.style.transform = `translateX(-50%) scale(${scale})`;
  };

  const clearT = () => {
    cube.style.transition = 'none';
    throwEl.style.transition = 'none';
    if (shadow) shadow.style.transition = 'none';
  };

  // Старт чуть над столом
  clearT();
  cube.style.transform = `rotateX(${face.x}deg) rotateY(${face.y + 20}deg)`;
  throwEl.style.transform = `translate3d(${endX}px, -4px, 0) rotate(${endRot}deg) scale(0.96)`;
  throwEl.style.opacity = '1';
  setShadow(0.4, 0.7);
  void cube.offsetWidth;

  if (delayMs) await sleep(delayMs);

  // Подброс
  throwEl.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.82, 0.28, 1)';
  cube.style.transition = 'transform 0.28s ease-out';
  if (shadow) shadow.style.transition = 'opacity 0.28s ease, transform 0.28s ease';
  throwEl.style.transform = `translate3d(${endX * 0.5}px, -88px, 0) rotate(${endRot * 0.4}deg) scale(1)`;
  cube.style.transform = `rotateX(${landX * 0.4}deg) rotateY(${landY * 0.4}deg)`;
  setShadow(0.18, 0.45);
  await sleep(280);

  // Падение и посадка на нужную грань
  throwEl.style.transition = 'transform 0.42s cubic-bezier(0.35, 0.12, 0.2, 1)';
  cube.style.transition = 'transform 0.42s cubic-bezier(0.3, 0.15, 0.2, 1)';
  throwEl.style.transform = `translate3d(${endX}px, 0, 0) rotate(${endRot}deg)`;
  cube.style.transform = `rotateX(${landX}deg) rotateY(${landY}deg)`;
  setShadow(0.85, 1);
  await sleep(420);

  // Нормализуем угол к короткому повороту (без 360+), чтобы idle не «прыгал»
  clearT();
  cube.style.transform = `rotateX(${face.x}deg) rotateY(${face.y}deg)`;
  throwEl.style.transform = `translate3d(${endX}px, 0, 0) rotate(${endRot}deg)`;
  void cube.offsetWidth;

  throwEl.classList.add('die-throw--idle');
}

export function boardPath(from, to) {
  const n = BOARD_SIZE;
  const start = ((from % n) + n) % n;
  const end = ((to % n) + n) % n;
  const steps = (end - start + n) % n;
  const path = [];
  for (let i = 1; i <= steps; i++) path.push((start + i) % n);
  return path;
}

export function boardPathBack(from, stepsBack) {
  const n = BOARD_SIZE;
  const start = ((from % n) + n) % n;
  const path = [];
  for (let i = 1; i <= stepsBack; i++) path.push((start - i + n) % n);
  return path;
}

export function resolveMovePath(from, to, diceSum) {
  const n = BOARD_SIZE;
  const forward = (to - from + n) % n;
  const back = (from - to + n) % n;

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

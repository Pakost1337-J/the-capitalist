import { BOARD_SIZE } from './config.js';
import { sleep } from './utils.js';

/**
 * Поворот куба, чтобы грань N оказалась СВЕРХУ.
 * Разметка граней: 1 front, 2 top, 3 right, 4 left, 5 bottom, 6 back.
 * Камера ¾ задаётся на .die-wrap в CSS.
 */
export const DIE_TOP_ROT = {
  1: { x: 90, y: 0 },
  2: { x: 0, y: 0 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  5: { x: 180, y: 0 },
  6: { x: -90, y: 0 },
};

/** @deprecated используйте DIE_TOP_ROT — оставлено для совместимости */
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
 * Бросок как на референсе: полёт → удары → остановка в ¾,
 * с лёгким естественным разворотом на столе.
 */
export async function throwDice(dieThrowEls, cubes, values, { doubles = false, stageEl = null } = {}) {
  const [v1, v2] = values.map(v => Math.min(6, Math.max(1, Number(v) || 1)));
  stageEl?.classList.remove('table-toss--landed');
  stageEl?.classList.add('table-toss--throwing');

  await Promise.all([
    throwOneDie(dieThrowEls[0], cubes[0], v1, 0, doubles, { restZ: -10, restX: -6 }),
    throwOneDie(dieThrowEls[1], cubes[1], v2, 90, doubles, { restZ: 16, restX: 10 }),
  ]);

  stageEl?.classList.remove('table-toss--throwing');
  stageEl?.classList.add('table-toss--landed');
}

async function throwOneDie(throwEl, cube, value, delayMs, doubles, rest) {
  if (!throwEl || !cube) return;

  const face = DIE_TOP_ROT[value] || DIE_TOP_ROT[1];
  const spinsX = 360 * (5 + Math.floor(Math.random() * 3));
  const spinsY = 360 * (4 + Math.floor(Math.random() * 3));
  const spinsZ = 180 * (2 + Math.floor(Math.random() * 2));
  const landX = spinsX + face.x;
  const landY = spinsY + face.y;
  const landZ = spinsZ + (rest.restZ || 0) * 0.15;

  const startX = (Math.random() - 0.5) * 120;
  const endX = rest.restX + (Math.random() - 0.5) * 18;
  const endRot = rest.restZ + (Math.random() - 0.5) * 8;
  const shadow = throwEl.querySelector('.die-shadow');

  throwEl.classList.toggle('die-throw--doubles', !!doubles);
  throwEl.classList.remove('die-throw--idle');
  throwEl.dataset.restZ = String(endRot);
  throwEl.dataset.restX = String(endX);

  cube.style.transition = 'none';
  throwEl.style.transition = 'none';
  if (shadow) {
    shadow.style.transition = 'none';
    shadow.style.opacity = '0.12';
    shadow.style.transform = 'translateX(-50%) scale(0.45)';
  }
  cube.style.transform = `rotateX(${-40 + Math.random() * 20}deg) rotateY(${30 + Math.random() * 40}deg) rotateZ(${-25}deg)`;
  throwEl.style.transform = `translate3d(${startX}px, -150px, 80px) scale(0.65)`;
  throwEl.style.opacity = '0.25';
  void cube.offsetWidth;

  if (delayMs) await sleep(delayMs);

  // Полёт
  throwEl.style.transition = 'transform 0.55s cubic-bezier(0.15, 0.7, 0.2, 1), opacity 0.12s ease';
  cube.style.transition = 'transform 0.55s cubic-bezier(0.12, 0.75, 0.2, 1)';
  throwEl.style.opacity = '1';
  throwEl.style.transform = `translate3d(${endX * 0.3}px, 4px, 0) scale(1.08)`;
  cube.style.transform = `rotateX(${landX * 0.48}deg) rotateY(${landY * 0.48}deg) rotateZ(${landZ * 0.4}deg)`;
  if (shadow) {
    shadow.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    shadow.style.opacity = '0.55';
    shadow.style.transform = 'translateX(-30%) scale(1.15)';
  }
  await sleep(520);

  // Удар 1
  throwEl.style.transition = 'transform 0.14s cubic-bezier(0.2, 0.95, 0.35, 1)';
  cube.style.transition = 'transform 0.14s linear';
  throwEl.style.transform = `translate3d(${endX * 0.55}px, -34px, 0) scale(1)`;
  cube.style.transform = `rotateX(${landX * 0.7}deg) rotateY(${landY * 0.7}deg) rotateZ(${landZ * 0.65}deg)`;
  if (shadow) {
    shadow.style.opacity = '0.28';
    shadow.style.transform = 'translateX(-40%) scale(0.65)';
  }
  await sleep(140);

  // Отскок 2
  throwEl.style.transition = 'transform 0.16s cubic-bezier(0.25, 0.9, 0.35, 1)';
  throwEl.style.transform = `translate3d(${endX * 0.8}px, 2px, 0) scale(1.03)`;
  cube.style.transform = `rotateX(${landX * 0.86}deg) rotateY(${landY * 0.86}deg) rotateZ(${landZ * 0.85}deg)`;
  if (shadow) {
    shadow.style.opacity = '0.7';
    shadow.style.transform = 'translateX(-35%) scale(1.05)';
  }
  await sleep(150);

  // Мелкий отскок
  throwEl.style.transition = 'transform 0.12s ease-out';
  throwEl.style.transform = `translate3d(${endX * 0.95}px, -12px, 0) rotate(${endRot * 0.35}deg)`;
  cube.style.transform = `rotateX(${landX * 0.95}deg) rotateY(${landY * 0.95}deg) rotateZ(${landZ * 0.95}deg)`;
  if (shadow) {
    shadow.style.opacity = '0.42';
    shadow.style.transform = 'translateX(-38%) scale(0.8)';
  }
  await sleep(115);

  // Остановка — оставляем ¾ вид (грань сверху), без снапа «в камеру»
  throwEl.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.85, 0.3, 1)';
  cube.style.transition = 'transform 0.32s cubic-bezier(0.2, 0.8, 0.3, 1)';
  throwEl.style.transform = `translate3d(${endX}px, 0, 0) rotate(${endRot}deg)`;
  cube.style.transform = `rotateX(${face.x}deg) rotateY(${face.y}deg)`;
  if (shadow) {
    shadow.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    shadow.style.opacity = '0.88';
    shadow.style.transform = 'translateX(-28%) scale(1)';
  }
  await sleep(300);

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

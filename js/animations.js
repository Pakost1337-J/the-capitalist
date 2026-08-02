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
 * Реалистичный бросок на кожаный стол:
 * замах → полёт/кувырок → удар → отскоки → остановка.
 */
export async function throwDice(dieThrowEls, cubes, values, { doubles = false, stageEl = null } = {}) {
  const [v1, v2] = values.map(v => Math.min(6, Math.max(1, Number(v) || 1)));
  stageEl?.classList.remove('table-toss--landed');
  stageEl?.classList.add('table-toss--throwing');

  await Promise.all([
    throwOneDie(dieThrowEls[0], cubes[0], v1, 0, doubles),
    throwOneDie(dieThrowEls[1], cubes[1], v2, 110, doubles),
  ]);

  stageEl?.classList.remove('table-toss--throwing');
  stageEl?.classList.add('table-toss--landed');
}

async function throwOneDie(throwEl, cube, value, delayMs, doubles) {
  if (!throwEl || !cube) return;

  const face = DIE_FACE_ROT[value] || DIE_FACE_ROT[1];
  const spinsX = 360 * (4 + Math.floor(Math.random() * 3));
  const spinsY = 360 * (3 + Math.floor(Math.random() * 4));
  const spinsZ = 180 * (1 + Math.floor(Math.random() * 2));
  const landX = spinsX + face.x;
  const landY = spinsY + face.y;

  const startX = (Math.random() - 0.5) * 100;
  const endX = (Math.random() - 0.5) * 56;
  const endRot = (Math.random() - 0.5) * 16;
  const shadow = throwEl.querySelector('.die-shadow');

  throwEl.classList.toggle('die-throw--doubles', !!doubles);
  throwEl.classList.remove('die-throw--idle');

  // Замах над столом
  cube.style.transition = 'none';
  throwEl.style.transition = 'none';
  if (shadow) {
    shadow.style.transition = 'none';
    shadow.style.opacity = '0.15';
    shadow.style.transform = 'translateX(-50%) scale(0.5)';
  }
  cube.style.transform = `rotateX(${-35}deg) rotateY(${45}deg) rotateZ(${-20}deg)`;
  throwEl.style.transform = `translate3d(${startX}px, -130px, 50px) scale(0.7)`;
  throwEl.style.opacity = '0.35';
  void cube.offsetWidth;

  if (delayMs) await sleep(delayMs);

  // Полёт + кувырок
  throwEl.style.transition = 'transform 0.52s cubic-bezier(0.12, 0.65, 0.22, 1), opacity 0.15s ease';
  cube.style.transition = 'transform 0.52s cubic-bezier(0.1, 0.7, 0.2, 1)';
  throwEl.style.opacity = '1';
  throwEl.style.transform = `translate3d(${endX * 0.35}px, 6px, 0) scale(1.06)`;
  cube.style.transform = `rotateX(${landX * 0.5}deg) rotateY(${landY * 0.5}deg) rotateZ(${spinsZ * 0.45}deg)`;
  if (shadow) {
    shadow.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    shadow.style.opacity = '0.7';
    shadow.style.transform = 'translateX(-50%) scale(1.1)';
  }
  await sleep(500);

  // Удар + сильный отскок
  throwEl.style.transition = 'transform 0.16s cubic-bezier(0.2, 0.95, 0.3, 1)';
  cube.style.transition = 'transform 0.16s linear';
  throwEl.style.transform = `translate3d(${endX * 0.6}px, -28px, 0) scale(1)`;
  cube.style.transform = `rotateX(${landX * 0.72}deg) rotateY(${landY * 0.72}deg) rotateZ(${spinsZ * 0.7}deg)`;
  if (shadow) {
    shadow.style.opacity = '0.35';
    shadow.style.transform = 'translateX(-50%) scale(0.7)';
  }
  await sleep(155);

  // Второй отскок
  throwEl.style.transition = 'transform 0.15s cubic-bezier(0.25, 0.85, 0.3, 1)';
  throwEl.style.transform = `translate3d(${endX * 0.85}px, 3px, 0) scale(1.02)`;
  cube.style.transform = `rotateX(${landX * 0.88}deg) rotateY(${landY * 0.88}deg) rotateZ(${spinsZ * 0.88}deg)`;
  if (shadow) {
    shadow.style.opacity = '0.75';
    shadow.style.transform = 'translateX(-50%) scale(1.05)';
  }
  await sleep(140);

  // Третий мелкий
  throwEl.style.transition = 'transform 0.13s ease-out';
  throwEl.style.transform = `translate3d(${endX}px, -10px, 0) rotate(${endRot * 0.4}deg)`;
  cube.style.transform = `rotateX(${landX * 0.96}deg) rotateY(${landY * 0.96}deg) rotateZ(${spinsZ * 0.96}deg)`;
  if (shadow) {
    shadow.style.opacity = '0.5';
    shadow.style.transform = 'translateX(-50%) scale(0.85)';
  }
  await sleep(120);

  // Остановка на столе
  throwEl.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.85, 0.3, 1)';
  cube.style.transition = 'transform 0.28s ease-out';
  throwEl.style.transform = `translate3d(${endX}px, 0, 0) rotate(${endRot}deg)`;
  cube.style.transform = `rotateX(${landX}deg) rotateY(${landY}deg) rotateZ(${spinsZ}deg)`;
  if (shadow) {
    shadow.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
    shadow.style.opacity = '0.9';
    shadow.style.transform = 'translateX(-40%) scale(1)';
  }
  await sleep(280);

  // Нормализация грани
  cube.style.transition = 'none';
  cube.style.transform = `rotateX(${face.x}deg) rotateY(${face.y}deg) rotateZ(0deg)`;
  throwEl.classList.add('die-throw--idle');
  void cube.offsetWidth;
}

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

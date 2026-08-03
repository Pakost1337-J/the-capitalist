export const DICE_THROW_MS = 1800;
export const DICE_STAGGER_MS = 120;
export const DICE_CAM_MS = 700;
/** Полный цикл 3D-броска до последнего кадра камеры */
export const DICE_TOTAL_MS = DICE_THROW_MS + DICE_STAGGER_MS + DICE_CAM_MS;
export const TOKEN_STEP_MS = 150;

/** Время до commitMove: кости (+ шаги фишки, если был ход) */
export function moveAnimMs(steps = 0, { moved = true } = {}) {
  if (!moved) return DICE_TOTAL_MS;
  const n = Math.max(0, Math.min(Number(steps) || 0, 40));
  return DICE_TOTAL_MS + n * TOKEN_STEP_MS;
}

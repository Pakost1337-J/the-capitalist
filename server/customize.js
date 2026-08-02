import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BOARD, PLAYER_SLOTS } from '../js/config.js';
import { DEFAULT_CELL_ICONS } from '../js/icons.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CUSTOM_PATH = join(DATA_DIR, 'custom.json');

/** Снимок имён/иконок до применения custom.json — для честного сброса */
const PRISTINE_BOARD = BOARD.map(c => ({
  id: c.id,
  name: c.name,
  icon: c.icon || DEFAULT_CELL_ICONS[c.id] || '⬜',
  brand: c.brand,
  flag: c.flag,
}));
const PRISTINE_PLAYERS = PLAYER_SLOTS.map(p => ({
  id: p.id,
  token: p.token,
  tokenImage: p.tokenImage || '',
  tokenBoardImage: p.tokenBoardImage || '',
  nameHint: '',
}));

function boardFromPristine() {
  return PRISTINE_BOARD.map(c => ({ ...c }));
}

function playersFromPristine() {
  return PRISTINE_PLAYERS.map(p => ({ ...p }));
}

let customBoard = boardFromPristine();
let customPlayers = playersFromPristine();

export function loadCustom() {
  try {
    if (!existsSync(CUSTOM_PATH)) {
      customBoard = boardFromPristine();
      customPlayers = playersFromPristine();
      syncRuntimeConfig();
      return getCustomPayload();
    }
    const raw = JSON.parse(readFileSync(CUSTOM_PATH, 'utf8'));
    if (Array.isArray(raw.board)) {
      customBoard = PRISTINE_BOARD.map((base) => {
        const ov = raw.board.find(b => b.id === base.id) || {};
        return {
          ...base,
          name: ov.name ?? base.name,
          icon: ov.icon || base.icon,
        };
      });
    }
    if (Array.isArray(raw.players)) {
      customPlayers = PRISTINE_PLAYERS.map((base) => {
        const ov = raw.players.find(p => p.id === base.id) || {};
        return {
          ...base,
          token: ov.token ?? base.token,
          tokenImage: ov.tokenImage ?? base.tokenImage ?? '',
          tokenBoardImage: ov.tokenBoardImage ?? base.tokenBoardImage ?? '',
          nameHint: ov.nameHint ?? '',
        };
      });
    }
  } catch (e) {
    console.warn('custom.json load failed:', e.message);
  }
  syncRuntimeConfig();
  return getCustomPayload();
}

function syncRuntimeConfig() {
  for (const cell of customBoard) {
    const base = BOARD.find(b => b.id === cell.id);
    if (!base) continue;
    base.name = cell.name;
    base.icon = cell.icon;
  }
  for (const p of customPlayers) {
    const base = PLAYER_SLOTS.find(s => s.id === p.id);
    if (!base) continue;
    base.token = p.token;
    if (p.tokenImage) base.tokenImage = p.tokenImage;
    if (p.tokenBoardImage) base.tokenBoardImage = p.tokenBoardImage;
  }
}

export function saveCustom(payload) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  if (Array.isArray(payload.board)) {
    customBoard = PRISTINE_BOARD.map((base) => {
      const ov = payload.board.find(b => b.id === base.id) || {};
      return {
        ...base,
        name: (ov.name ?? base.name).toString().slice(0, 32),
        icon: (ov.icon || base.icon || '⬜').toString().slice(0, 120),
      };
    });
  }

  if (Array.isArray(payload.players)) {
    customPlayers = PRISTINE_PLAYERS.map((base) => {
      const ov = payload.players.find(p => p.id === base.id) || {};
      return {
        ...base,
        token: (ov.token ?? base.token).toString().slice(0, 16),
        tokenImage: (ov.tokenImage || base.tokenImage || '').toString().slice(0, 120),
        tokenBoardImage: (ov.tokenBoardImage || base.tokenBoardImage || '').toString().slice(0, 120),
        nameHint: (ov.nameHint || '').toString().slice(0, 20),
      };
    });
  }

  syncRuntimeConfig();

  const data = {
    board: customBoard.map(c => ({ id: c.id, name: c.name, icon: c.icon })),
    players: customPlayers.map(p => ({
      id: p.id,
      token: p.token,
      tokenImage: p.tokenImage || '',
      tokenBoardImage: p.tokenBoardImage || '',
      nameHint: p.nameHint || '',
    })),
  };

  writeFileSync(CUSTOM_PATH, JSON.stringify(data, null, 2), 'utf8');
  return getCustomPayload();
}

export function getCustomPayload() {
  return {
    board: customBoard,
    players: customPlayers,
  };
}

export function getBoardCell(id) {
  return customBoard[id] || BOARD[id];
}

export function resetCustom() {
  if (existsSync(CUSTOM_PATH)) {
    try { unlinkSync(CUSTOM_PATH); } catch (_) {}
  }
  customBoard = boardFromPristine();
  customPlayers = playersFromPristine();
  // Вернуть runtime BOARD к эталону (не к испорченным именам)
  for (const p of PRISTINE_BOARD) {
    const base = BOARD.find(b => b.id === p.id);
    if (!base) continue;
    base.name = p.name;
    base.icon = p.icon;
    if (p.brand) base.brand = p.brand;
    if (p.flag !== undefined) base.flag = p.flag;
  }
  for (const p of PRISTINE_PLAYERS) {
    const base = PLAYER_SLOTS.find(s => s.id === p.id);
    if (!base) continue;
    base.token = p.token;
    base.tokenImage = p.tokenImage;
    base.tokenBoardImage = p.tokenBoardImage;
  }
  return getCustomPayload();
}

// load on import
loadCustom();

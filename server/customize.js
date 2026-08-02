import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PLAYER_SLOTS, normalizeHexColor } from '../js/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CUSTOM_PATH = join(DATA_DIR, 'custom.json');

const OWN_KEYS = ['ownTop', 'ownRight', 'ownBottom', 'ownLeft'];

function slotColors(p) {
  const color = normalizeHexColor(p.color, '#888888');
  return {
    id: p.id,
    name: p.name || `Фишка ${p.id + 1}`,
    color,
    colorSoft: normalizeHexColor(p.colorSoft || color, color),
    ownTop: normalizeHexColor(p.ownTop || color, color),
    ownRight: normalizeHexColor(p.ownRight || color, color),
    ownBottom: normalizeHexColor(p.ownBottom || color, color),
    ownLeft: normalizeHexColor(p.ownLeft || color, color),
  };
}

const PRISTINE_PLAYERS = PLAYER_SLOTS.map(p => slotColors(p));

function playersFromPristine() {
  return PRISTINE_PLAYERS.map(p => ({ ...p }));
}

let customPlayers = playersFromPristine();

function mergePlayer(base, ov = {}) {
  const color = normalizeHexColor(ov.color || base.color, base.color);
  const out = {
    id: base.id,
    name: base.name,
    color,
    colorSoft: normalizeHexColor(ov.colorSoft || base.colorSoft || color, color),
  };
  for (const key of OWN_KEYS) {
    out[key] = normalizeHexColor(ov[key] || base[key] || color, color);
  }
  return out;
}

export function loadCustom() {
  try {
    if (!existsSync(CUSTOM_PATH)) {
      customPlayers = playersFromPristine();
      syncRuntimeConfig();
      return getCustomPayload();
    }
    const raw = JSON.parse(readFileSync(CUSTOM_PATH, 'utf8'));
    if (Array.isArray(raw.players)) {
      customPlayers = PRISTINE_PLAYERS.map((base) => {
        const ov = raw.players.find(p => p.id === base.id) || {};
        return mergePlayer(base, ov);
      });
    }
  } catch (e) {
    console.warn('custom.json load failed:', e.message);
  }
  syncRuntimeConfig();
  return getCustomPayload();
}

function syncRuntimeConfig() {
  for (const p of customPlayers) {
    const base = PLAYER_SLOTS.find(s => s.id === p.id);
    if (!base) continue;
    base.color = p.color;
    base.colorSoft = p.colorSoft;
    for (const key of OWN_KEYS) base[key] = p[key];
  }
}

export function saveCustom(payload) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  if (Array.isArray(payload.players)) {
    customPlayers = PRISTINE_PLAYERS.map((base) => {
      const ov = payload.players.find(p => p.id === base.id) || {};
      return mergePlayer(base, ov);
    });
  }

  syncRuntimeConfig();

  const data = {
    players: customPlayers.map(p => ({
      id: p.id,
      color: p.color,
      colorSoft: p.colorSoft,
      ownTop: p.ownTop,
      ownRight: p.ownRight,
      ownBottom: p.ownBottom,
      ownLeft: p.ownLeft,
    })),
  };

  writeFileSync(CUSTOM_PATH, JSON.stringify(data, null, 2), 'utf8');
  return getCustomPayload();
}

export function getCustomPayload() {
  return {
    players: customPlayers,
  };
}

export function resetCustom() {
  if (existsSync(CUSTOM_PATH)) {
    try { unlinkSync(CUSTOM_PATH); } catch (_) {}
  }
  customPlayers = playersFromPristine();
  for (const p of PRISTINE_PLAYERS) {
    const base = PLAYER_SLOTS.find(s => s.id === p.id);
    if (!base) continue;
    base.color = p.color;
    base.colorSoft = p.colorSoft;
    for (const key of OWN_KEYS) base[key] = p[key];
  }
  return getCustomPayload();
}

loadCustom();

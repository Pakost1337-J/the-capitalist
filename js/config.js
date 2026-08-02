import { DEFAULT_CELL_ICONS } from './icons.js';

export const START_MONEY = 1_500_000;
export const GO_SALARY = 200_000;
export const JAIL_BAIL = 50_000;
export const MAX_HOUSES = 5;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 1;

/** Прямоугольное поле: 13 колонок × 9 рядов */
export const BOARD_COLS = 13;
export const BOARD_ROWS = 9;

export const PLAYER_SLOTS = [
  { id: 0, name: 'Красная', color: '#e11d48', colorSoft: '#fecdd3', token: 'pawn', tokenImage: '' },
  { id: 1, name: 'Синяя', color: '#2563eb', colorSoft: '#bfdbfe', token: 'pawn', tokenImage: '' },
  { id: 2, name: 'Жёлтая', color: '#ca8a04', colorSoft: '#fef08a', token: 'pawn', tokenImage: '' },
  { id: 3, name: 'Зелёная', color: '#16a34a', colorSoft: '#bbf7d0', token: 'pawn', tokenImage: '' },
  { id: 4, name: 'Розовая', color: '#db2777', colorSoft: '#fbcfe8', token: 'pawn', tokenImage: '' },
];

/** Группы больше не красят клетку по умолчанию — только тёплый серый */
export const GROUP_COLORS = {
  brown: '#c4b8a8',
  lightblue: '#c4b8a8',
  pink: '#c4b8a8',
  orange: '#c4b8a8',
  red: '#c4b8a8',
  yellow: '#c4b8a8',
  green: '#c4b8a8',
  darkblue: '#c4b8a8',
};

export const CELL_DEFAULT_BG = '#c9c2b6';

// brand = короткий логотип-текст, flag = флаг страны
export const BOARD = [
  { id: 0, type: 'go', name: 'Старт', icon: '🛟', brand: 'GO', flag: '' },
  { id: 1, type: 'property', name: 'Shell', brand: 'SHELL', flag: '🇬🇧', icon: '⛽', group: 'brown', price: 60, houseCost: 50, rent: [2, 10, 30, 90, 160, 250] },
  { id: 2, type: 'chance', name: 'ШАНС', icon: '?', brand: '?', flag: '' },
  { id: 3, type: 'property', name: 'BP', brand: 'BP', flag: '🇬🇧', icon: '🛢️', group: 'brown', price: 60, houseCost: 50, rent: [2, 10, 30, 90, 160, 250] },
  { id: 4, type: 'tax', name: 'НАЛОГ 6%', amount: 200, icon: '%', brand: 'TAX', flag: '' },
  { id: 5, type: 'railroad', name: 'Port A', brand: 'PORT', flag: '⚓', icon: '🚢', price: 200, rent: [25, 50, 100, 200] },
  { id: 6, type: 'property', name: 'Xiaomi', brand: 'MI', flag: '🇨🇳', icon: '📱', group: 'lightblue', price: 100, houseCost: 50, rent: [6, 30, 90, 270, 400, 550] },
  { id: 7, type: 'chance', name: 'ШАНС', icon: '?', brand: '?', flag: '' },
  { id: 8, type: 'property', name: 'Alibaba', brand: '阿里', flag: '🇨🇳', icon: '🛒', group: 'lightblue', price: 100, houseCost: 50, rent: [6, 30, 90, 270, 400, 550] },
  { id: 9, type: 'property', name: 'Huawei', brand: 'HUAWEI', flag: '🇨🇳', icon: '📡', group: 'lightblue', price: 120, houseCost: 50, rent: [8, 40, 100, 300, 450, 600] },
  { id: 10, type: 'jail', name: 'Тюрьма', icon: '⛓️', brand: 'JAIL', flag: '' },
  { id: 11, type: 'property', name: 'Renault', brand: 'RENAULT', flag: '🇫🇷', icon: '🚗', group: 'pink', price: 140, houseCost: 100, rent: [10, 50, 150, 450, 625, 750] },
  { id: 12, type: 'utility', name: 'Energy', brand: '⚡', flag: '⚡', icon: '⚡', price: 150 },
  { id: 13, type: 'property', name: "L'Oréal", brand: "L'ORÉAL", flag: '🇫🇷', icon: '💄', group: 'pink', price: 140, houseCost: 100, rent: [10, 50, 150, 450, 625, 750] },
  { id: 14, type: 'property', name: 'LVMH', brand: 'LVMH', flag: '🇫🇷', icon: '👜', group: 'pink', price: 160, houseCost: 100, rent: [12, 60, 180, 500, 700, 900] },
  { id: 15, type: 'railroad', name: 'Port B', brand: 'PORT', flag: '⚓', icon: '🚢', price: 200, rent: [25, 50, 100, 200] },
  { id: 16, type: 'property', name: 'Adidas', brand: 'adidas', flag: '🇩🇪', icon: '👟', group: 'orange', price: 180, houseCost: 100, rent: [14, 70, 200, 550, 750, 950] },
  { id: 17, type: 'chance', name: 'ФОРС МАЖОР', icon: '⚠', brand: 'FM', flag: '' },
  { id: 18, type: 'property', name: 'Siemens', brand: 'SIEMENS', flag: '🇩🇪', icon: '⚙️', group: 'orange', price: 180, houseCost: 100, rent: [14, 70, 200, 550, 750, 950] },
  { id: 19, type: 'property', name: 'BMW', brand: 'BMW', flag: '🇩🇪', icon: '🚘', group: 'orange', price: 200, houseCost: 100, rent: [16, 80, 220, 600, 800, 1000] },
  { id: 20, type: 'parking', name: 'Парковка', icon: '🏁', brand: 'FREE', flag: '' },
  { id: 21, type: 'property', name: 'McDonald\'s', brand: "McD", flag: '🇺🇸', icon: '🍟', group: 'red', price: 220, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 22, type: 'chance', name: 'ШАНС', icon: '?', brand: '?', flag: '' },
  { id: 23, type: 'property', name: 'Coca-Cola', brand: 'Coca-Cola', flag: '🇺🇸', icon: '🥤', group: 'red', price: 220, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 24, type: 'property', name: 'Apple', brand: 'Apple', flag: '🇺🇸', icon: '🍎', group: 'red', price: 240, houseCost: 150, rent: [20, 100, 300, 750, 925, 1100] },
  { id: 25, type: 'railroad', name: 'Port C', brand: 'PORT', flag: '⚓', icon: '🚢', price: 200, rent: [25, 50, 100, 200] },
  { id: 26, type: 'property', name: 'Sony', brand: 'SONY', flag: '🇯🇵', icon: '🎮', group: 'yellow', price: 260, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 27, type: 'property', name: 'Canon', brand: 'Canon', flag: '🇯🇵', icon: '📷', group: 'yellow', price: 260, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 28, type: 'utility', name: 'Telecom', brand: '📶', flag: '📶', icon: '📶', price: 150 },
  { id: 29, type: 'property', name: 'Toyota', brand: 'TOYOTA', flag: '🇯🇵', icon: '🚗', group: 'yellow', price: 280, houseCost: 150, rent: [24, 120, 360, 850, 1025, 1200] },
  { id: 30, type: 'gotojail', name: 'Арест', icon: '🎲', brand: 'GO JAIL', flag: '' },
  { id: 31, type: 'property', name: 'LG', brand: 'LG', flag: '🇰🇷', icon: '📺', group: 'green', price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 32, type: 'property', name: 'Hyundai', brand: 'HYUNDAI', flag: '🇰🇷', icon: '🚙', group: 'green', price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 33, type: 'chance', name: 'ШАНС', icon: '?', brand: '?', flag: '' },
  { id: 34, type: 'property', name: 'Samsung', brand: 'SAMSUNG', flag: '🇰🇷', icon: '📱', group: 'green', price: 320, houseCost: 200, rent: [28, 150, 450, 1000, 1200, 1400] },
  { id: 35, type: 'railroad', name: 'Port D', brand: 'PORT', flag: '⚓', icon: '🚢', price: 200, rent: [25, 50, 100, 200] },
  { id: 36, type: 'chance', name: 'ШАНС', icon: '?', brand: '?', flag: '' },
  { id: 37, type: 'property', name: 'Nestlé', brand: 'Nestlé', flag: '🇨🇭', icon: '🍫', group: 'darkblue', price: 350, houseCost: 200, rent: [35, 175, 500, 1100, 1300, 1500] },
  { id: 38, type: 'tax', name: 'НАЛОГ 10%', amount: 100, icon: '%', brand: 'TAX', flag: '' },
  { id: 39, type: 'property', name: 'Rolex', brand: 'ROLEX', flag: '🇨🇭', icon: '⌚', group: 'darkblue', price: 400, houseCost: 200, rent: [50, 200, 600, 1400, 1700, 2000] },
];

const ECONOMY_SCALE = 1000;

for (const cell of BOARD) {
  if (!cell.icon) cell.icon = DEFAULT_CELL_ICONS[cell.id] || '⬜';
  if (!cell.brand) cell.brand = cell.name;
  if (cell.flag === undefined) cell.flag = '';
  if (cell.price) cell.price *= ECONOMY_SCALE;
  if (cell.houseCost) cell.houseCost *= ECONOMY_SCALE;
  if (cell.amount) cell.amount *= ECONOMY_SCALE;
  if (cell.rent) cell.rent = cell.rent.map(r => r * ECONOMY_SCALE);
}

export function applyTheme(theme) {
  if (!theme?.board) return;
  for (const ov of theme.board) {
    const cell = BOARD.find(c => c.id === ov.id);
    if (!cell) continue;
    if (ov.name) cell.name = ov.name;
    if (ov.icon) cell.icon = ov.icon;
    if (ov.brand) cell.brand = ov.brand;
    if (ov.flag !== undefined) cell.flag = ov.flag;
  }
  if (Array.isArray(theme.players)) {
    for (const ov of theme.players) {
      const slot = PLAYER_SLOTS.find(p => p.id === ov.id);
      if (!slot) continue;
      if (ov.token) slot.token = ov.token;
      if (ov.tokenImage !== undefined) slot.tokenImage = ov.tokenImage;
    }
  }
}

export const CHANCE_CARDS = [
  { text: 'Банковская ошибка в вашу пользу. Получите $200 000', money: 200_000 },
  { text: 'Оплатите штраф за превышение скорости $15 000', money: -15_000 },
  { text: 'Вы выиграли конкурс. Получите $10 000', money: 10_000 },
  { text: 'Вы выиграли в лотерею. Получите $100 000', money: 100_000 },
  { text: 'Заплатите медицинский сбор $50 000', money: -50_000 },
  { text: 'Получите $25 000 консультационный сбор', money: 25_000 },
  { text: 'Наследство $100 000', money: 100_000 },
  { text: 'День рождения! С каждого игрока $10 000', birthday: 10_000 },
  { text: 'Отправляйтесь на Старт', goToStart: true },
  { text: 'Отправляйтесь в Тюрьму', goToJail: true },
  { text: 'Ремонт: заплатите $40 000 за каждый филиал', repairPerHouse: 40_000 },
  { text: 'Продайте акции. Получите $150 000', money: 150_000 },
  { text: 'Вернитесь на 3 клетки назад', moveBack: 3 },
  { text: 'Перейдите на Парковку', goTo: 20 },
  { text: 'Получите $50 000', money: 50_000 },
  { text: 'Заплатите налог $75 000', money: -75_000 },
];

export function getCell(id) {
  return BOARD[id];
}

export function getGroupProperties(group) {
  return BOARD.filter(c => c.group === group);
}

/** Старт (0) — слева сверху, ход по часовой: верх → право → низ → лево */
export function getGridPosition(index) {
  // Верх: 0..12 слева направо
  if (index <= 12) return { row: 0, col: index };
  // Право: 13..20 сверху вниз
  if (index <= 20) return { row: index - 12, col: BOARD_COLS - 1 };
  // Низ: 21..32 справа налево
  if (index <= 32) return { row: BOARD_ROWS - 1, col: 32 - index };
  // Лево: 33..39 снизу вверх
  return { row: 40 - index, col: 0 };
}

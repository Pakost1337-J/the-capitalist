export const START_MONEY = 1500;
export const GO_SALARY = 200;
export const JAIL_BAIL = 50;
export const MAX_HOUSES = 5;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;

export const PLAYER_SLOTS = [
  { id: 0, color: '#ef4444', token: '🚗' },
  { id: 1, color: '#3b82f6', token: '🚢' },
  { id: 2, color: '#22c55e', token: '🎩' },
  { id: 3, color: '#f59e0b', token: '🐕' },
  { id: 4, color: '#a855f7', token: '🚀' },
];

export const GROUP_COLORS = {
  brown: '#8B4513',
  lightblue: '#87CEEB',
  pink: '#FF69B4',
  orange: '#FF8C00',
  red: '#DC143C',
  yellow: '#FFD700',
  green: '#228B22',
  darkblue: '#00008B',
};

export const BOARD = [
  { id: 0, type: 'go', name: 'СТАРТ', icon: '→', desc: 'Получите $200' },
  { id: 1, type: 'property', name: 'Киоск', group: 'brown', price: 60, houseCost: 50, rent: [2, 10, 30, 90, 160, 250] },
  { id: 2, type: 'chance', name: 'Шанс', icon: '?' },
  { id: 3, type: 'property', name: 'Ларёк', group: 'brown', price: 60, houseCost: 50, rent: [2, 10, 30, 90, 160, 250] },
  { id: 4, type: 'tax', name: 'Налог', amount: 200, icon: '💸' },
  { id: 5, type: 'railroad', name: 'Станция А', price: 200, rent: [25, 50, 100, 200] },
  { id: 6, type: 'property', name: 'Такси', group: 'lightblue', price: 100, houseCost: 50, rent: [6, 30, 90, 270, 400, 550] },
  { id: 7, type: 'chance', name: 'Шанс', icon: '?' },
  { id: 8, type: 'property', name: 'Автобус', group: 'lightblue', price: 100, houseCost: 50, rent: [6, 30, 90, 270, 400, 550] },
  { id: 9, type: 'property', name: 'Маршрутка', group: 'lightblue', price: 120, houseCost: 50, rent: [8, 40, 100, 300, 450, 600] },
  { id: 10, type: 'jail', name: 'Тюрьма', icon: '🔒', desc: 'Просто в гостях' },
  { id: 11, type: 'property', name: 'Кафе', group: 'pink', price: 140, houseCost: 100, rent: [10, 50, 150, 450, 625, 750] },
  { id: 12, type: 'utility', name: 'Электросеть', price: 150, icon: '⚡' },
  { id: 13, type: 'property', name: 'Ресторан', group: 'pink', price: 140, houseCost: 100, rent: [10, 50, 150, 450, 625, 750] },
  { id: 14, type: 'property', name: 'Отель', group: 'pink', price: 160, houseCost: 100, rent: [12, 60, 180, 500, 700, 900] },
  { id: 15, type: 'railroad', name: 'Станция Б', price: 200, rent: [25, 50, 100, 200] },
  { id: 16, type: 'property', name: 'Магазин', group: 'orange', price: 180, houseCost: 100, rent: [14, 70, 200, 550, 750, 950] },
  { id: 17, type: 'chance', name: 'Шанс', icon: '?' },
  { id: 18, type: 'property', name: 'Супермаркет', group: 'orange', price: 180, houseCost: 100, rent: [14, 70, 200, 550, 750, 950] },
  { id: 19, type: 'property', name: 'ТЦ', group: 'orange', price: 200, houseCost: 100, rent: [16, 80, 220, 600, 800, 1000] },
  { id: 20, type: 'parking', name: 'Бесплатная стоянка', icon: '🅿️' },
  { id: 21, type: 'property', name: 'Фабрика', group: 'red', price: 220, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 22, type: 'chance', name: 'Шанс', icon: '?' },
  { id: 23, type: 'property', name: 'Завод', group: 'red', price: 220, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 24, type: 'property', name: 'Комбинат', group: 'red', price: 240, houseCost: 150, rent: [20, 100, 300, 750, 925, 1100] },
  { id: 25, type: 'railroad', name: 'Станция В', price: 200, rent: [25, 50, 100, 200] },
  { id: 26, type: 'property', name: 'IT-офис', group: 'yellow', price: 260, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 27, type: 'property', name: 'Стартап', group: 'yellow', price: 260, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 28, type: 'utility', name: 'Водоканал', price: 150, icon: '💧' },
  { id: 29, type: 'property', name: 'Корпорация', group: 'yellow', price: 280, houseCost: 150, rent: [24, 120, 360, 850, 1025, 1200] },
  { id: 30, type: 'gotojail', name: 'Арест!', icon: '👮', desc: 'Идите в тюрьму' },
  { id: 31, type: 'property', name: 'Банк', group: 'green', price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 32, type: 'property', name: 'Биржа', group: 'green', price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 33, type: 'chance', name: 'Шанс', icon: '?' },
  { id: 34, type: 'property', name: 'Холдинг', group: 'green', price: 320, houseCost: 200, rent: [28, 150, 450, 1000, 1200, 1400] },
  { id: 35, type: 'railroad', name: 'Станция Г', price: 200, rent: [25, 50, 100, 200] },
  { id: 36, type: 'chance', name: 'Шанс', icon: '?' },
  { id: 37, type: 'property', name: 'Нефть', group: 'darkblue', price: 350, houseCost: 200, rent: [35, 175, 500, 1100, 1300, 1500] },
  { id: 38, type: 'tax', name: 'Налог на роскошь', amount: 100, icon: '💎' },
  { id: 39, type: 'property', name: 'Империя', group: 'darkblue', price: 400, houseCost: 200, rent: [50, 200, 600, 1400, 1700, 2000] },
];

export const CHANCE_CARDS = [
  { text: 'Банковская ошибка в вашу пользу. Получите $200', money: 200 },
  { text: 'Оплатите штраф за превышение скорости $15', money: -15 },
  { text: 'Вы выиграли конкурс красоты. Получите $10', money: 10 },
  { text: 'Вы выиграли в лотерею. Получите $100', money: 100 },
  { text: 'Заплатите медицинский сбор $50', money: -50 },
  { text: 'Получите $25 консультационный сбор', money: 25 },
  { text: 'Вы наследство $100', money: 100 },
  { text: 'День рождения! С каждого игрока $10', birthday: 10 },
  { text: 'Отправляйтесь на Старт', goToStart: true },
  { text: 'Отправляйтесь в Тюрьму', goToJail: true },
  { text: 'Ремонт: заплатите $40 за каждый филиал', repairPerHouse: 40 },
  { text: 'Продайте акции. Получите $150', money: 150 },
  { text: 'Вернитесь на 3 клетки назад', moveBack: 3 },
  { text: 'Перейдите на Бесплатную стоянку', goTo: 20 },
  { text: 'Получите $50', money: 50 },
  { text: 'Заплатите налог $75', money: -75 },
];

export function getCell(id) {
  return BOARD[id];
}

export function getGroupProperties(group) {
  return BOARD.filter(c => c.group === group);
}

export function getGridPosition(index) {
  if (index <= 10) return { row: 10, col: 10 - index };
  if (index <= 20) return { row: 20 - index, col: 0 };
  if (index <= 30) return { row: 0, col: index - 20 };
  return { row: index - 30, col: 10 };
}

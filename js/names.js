/** Случайные русские имена для ботов */
export const RUSSIAN_NAMES = [
  'Артур', 'Надежда', 'Максим', 'Ольга', 'Игорь', 'Елена',
  'Дмитрий', 'Анна', 'Сергей', 'Мария', 'Алексей', 'Виктория',
  'Андрей', 'Дарья', 'Никита', 'Полина', 'Кирилл', 'Алина',
  'Павел', 'Юлия', 'Роман', 'Татьяна', 'Владимир', 'Екатерина',
  'Михаил', 'София', 'Иван', 'Ксения', 'Артём', 'Валерия',
];

export function pickBotNames(count, used = []) {
  const pool = RUSSIAN_NAMES.filter(n => !used.includes(n));
  const names = [];
  const available = [...pool];
  for (let i = 0; i < count; i++) {
    if (!available.length) {
      names.push(`Игрок ${i + 1}`);
      continue;
    }
    const idx = Math.floor(Math.random() * available.length);
    names.push(available.splice(idx, 1)[0]);
  }
  return names;
}

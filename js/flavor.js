/** Funny log lines for The Capitalist (UTF-8) */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function logBuy(name, company) {
  return `${name} покупает компанию «${company}»`;
}

export function logJail(name) {
  return pick([
    `${name} не везёт, и его арестовывают`,
    `${name} пойман в хищении пакета гречки и попал в тюрьму`,
    `${name} попался на горячем и отправился за решётку`,
    `${name} слишком заметно считал купюры — и вот уже камера`,
  ]);
}

function fmt(amount) {
  return `$${Number(amount).toLocaleString('ru-RU')}`;
}

export function logMoneyGain(name, amount) {
  const a = fmt(amount);
  return pick([
    `${name}: с неба упал чемодан денег (+${a})`,
    `${name} досталось наследство от 3-родной бабушки по линии отчима (+${a})`,
    `${name} нашёл забытый вклад и разбогател на ${a}`,
    `${name} удачно сыграл на бирже: +${a}`,
  ]);
}

export function logMoneyLoss(name, amount) {
  const a = fmt(amount);
  return pick([
    `${name} потерял ${a} — жизнь такая`,
    `${name} понёс убытки на сумму ${a}`,
    `${name} расстался с ${a} без особой радости`,
    `У ${name} из кармана утекло ${a}`,
  ]);
}

export function logPassStart(name, amount) {
  const a = fmt(amount);
  return pick([
    `${name} проходит старт и получает ${a}`,
    `${name} обогнул поле и заработал ${a}`,
    `Зарплата на старте: ${name} получает ${a}`,
  ]);
}

export function logRent(from, to, amount, company) {
  const a = fmt(amount);
  return pick([
    `${from} платит ${to} аренду ${a} за «${company}»`,
    `${from} вынужден отдать ${a} игроку ${to} («${company}»)`,
    `Аренда «${company}»: ${from} → ${to}, ${a}`,
  ]);
}

export function logTax(name, amount) {
  const a = fmt(amount);
  return pick([
    `${name} платит налог ${a}`,
    `Налоговая забрала у ${name} ${a}`,
    `${name} отстёгивает ${a} государству`,
  ]);
}

export function logRefuse(name, company) {
  return pick([
    `${name} отказывается покупать «${company}»`,
    `${name} проходит мимо «${company}» без сделки`,
    `«${company}» не заинтересовала ${name}`,
  ]);
}

export function logBuild(name, company) {
  return pick([
    `${name} строит на «${company}»`,
    `${name} улучшает «${company}»`,
    `На участке «${company}» у ${name} появилась новая постройка`,
  ]);
}

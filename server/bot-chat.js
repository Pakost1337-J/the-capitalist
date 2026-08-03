import { BOARD, getGroupProperties } from '../js/config.js';
import { formatPriceShort } from '../js/utils.js';
import { botBuyPriceFor, botSellPriceFor, wouldCompleteGroup, countOwnedInGroup } from '../js/bot-strategy.js';

const U = String.fromCharCode;
const t = {
  bot: U(0x0411, 0x043E, 0x0442),
  player: U(0x0418, 0x0433, 0x0440, 0x043E, 0x043A),
  look1: U(0x041F, 0x043E, 0x043A, 0x0430) + ' ' + U(0x0441, 0x043C, 0x043E, 0x0442, 0x0440, 0x044E) + ' ' + U(0x043F, 0x043E, 0x043B, 0x0435) + U(0x2026),
  look2: U(0x041A, 0x043E, 0x043F, 0x043B, 0x044E) + ' ' + U(0x043D, 0x0430) + ' ' + U(0x0445, 0x043E, 0x0434) + '.',
  look3: U(0x0416, 0x0434, 0x0443) + ' ' + U(0x0431, 0x0440, 0x043E, 0x0441, 0x043E, 0x043A) + '.',
  want: U(0x0425, 0x043E, 0x0447, 0x0443) + ' ',
  buy: U(0x043A, 0x0443, 0x043F, 0x0438, 0x0442, 0x044C) + ' ',
  need: U(0x041C, 0x043D, 0x0435) + ' ' + U(0x043D, 0x0443, 0x0436, 0x043D, 0x0430) + ' ',
  tradeQ: U(0x0434, 0x0430, 0x0432, 0x0430, 0x0439) + ' ' + U(0x0441, 0x0434, 0x0435, 0x043B, 0x043A, 0x0443) + '?',
  swapQ: U(0x043C, 0x0435, 0x043D, 0x044F, 0x0435, 0x043C, 0x0441, 0x044F) + '?',
  wants: U(0x0445, 0x043E, 0x0447, 0x0435, 0x0442) + ' ',
  offer: U(0x041F, 0x0440, 0x0435, 0x0434, 0x043B, 0x043E, 0x0436, 0x0438, 0x0442, 0x0435) + ' ' + U(0x043E, 0x0431, 0x043C, 0x0435, 0x043D) + '!',
  eye: U(0x0413, 0x043B, 0x0430, 0x0437) + ' ' + U(0x043D, 0x0430) + ' ',
  take: ' ' + U(0x2014) + ' ' + U(0x0437, 0x0430, 0x0431, 0x0435, 0x0440, 0x0443) + ', ' + U(0x0435, 0x0441, 0x043B, 0x0438) + ' ' + U(0x0432, 0x044B, 0x043F, 0x0430, 0x0434, 0x0435, 0x0442) + '.',
  dream: U(0x041C, 0x0435, 0x0447, 0x0442, 0x0430, 0x044E) + ' ' + U(0x043E) + ' ',
  country: ' ' + U(0x0434, 0x043B, 0x044F) + ' ' + U(0x0441, 0x0442, 0x0440, 0x0430, 0x043D, 0x044B) + '.',
  mine: ' ' + U(0x043C, 0x043E, 0x044F) + '. ',
  free: ' ' + U(0x0435, 0x0449, 0x0451) + ' ' + U(0x0441, 0x0432, 0x043E, 0x0431, 0x043E, 0x0434, 0x043D, 0x0430) + '!',
  notMine: ' ' + U(0x2014) + ' ' + U(0x043D, 0x0435) + ' ' + U(0x043C, 0x043E, 0x044F) + '.',
  hi: U(0x041F, 0x0440, 0x0438, 0x0432, 0x0435, 0x0442),
  hey: U(0x0425, 0x0435, 0x0439),
  here: U(0x044F) + ' ' + U(0x0442, 0x0443, 0x0442) + '.',
  deal: U(0x0441, 0x0434, 0x0435, 0x043B, 0x043A, 0x0430),
  openDeal: U(0x043E, 0x0442, 0x043A, 0x0440, 0x044B, 0x0432, 0x0430, 0x0439, 0x0442, 0x0435) + ' ' + U(0x0441, 0x0434, 0x0435, 0x043B, 0x043A, 0x0443) + '.',
  wait: U(0x0436, 0x0434, 0x0443) + '.',
  online: U(0x043D, 0x0430) + ' ' + U(0x0441, 0x0432, 0x044F, 0x0437, 0x0438) + '.',
  sayCo: U(0x0421, 0x043A, 0x0430, 0x0436, 0x0438, 0x0442, 0x0435) + ' ' + U(0x043A, 0x043E, 0x043C, 0x043F, 0x0430, 0x043D, 0x0438, 0x044E) + '.',
  discuss: U(0x043C, 0x043E, 0x0433, 0x0443) + ' ' + U(0x043E, 0x0431, 0x0441, 0x0443, 0x0434, 0x0438, 0x0442, 0x044C) + ' ' + U(0x2014) + ' ' + U(0x043A, 0x0438, 0x0434, 0x0430, 0x0439, 0x0442, 0x0435) + ' ' + U(0x0441, 0x0434, 0x0435, 0x043B, 0x043A, 0x0443) + '.',
  hear: U(0x0421, 0x043B, 0x044B, 0x0448, 0x0443),
  interest: U(0x0438, 0x043D, 0x0442, 0x0435, 0x0440, 0x0435, 0x0441, 0x043D, 0x0430) + '.',
  yes: U(0x0414, 0x0430),
  atMe: U(0x0443) + ' ' + U(0x043C, 0x0435, 0x043D, 0x044F) + '.',
  also: U(0x0422, 0x043E, 0x0436, 0x0435) + ' ' + U(0x0441, 0x043C, 0x043E, 0x0442, 0x0440, 0x044E) + ' ' + U(0x043D, 0x0430) + ' ',
  about: U(0x041F, 0x0440, 0x043E),
  other: U(0x0443) + ' ' + U(0x0434, 0x0440, 0x0443, 0x0433, 0x043E, 0x0433, 0x043E) + '.',
  iAm: U(0x042F),
  writeCo: U(0x041D, 0x0430, 0x043F, 0x0438, 0x0448, 0x0438, 0x0442, 0x0435) + ' ' + U(0x043A, 0x043E, 0x043C, 0x043F, 0x0430, 0x043D, 0x0438, 0x044E) + ' ' + U(0x0438, 0x043B, 0x0438) + ' ',
  very: U(0x041E, 0x0447, 0x0435, 0x043D, 0x044C) + ' ',
  of: U(0x0445, 0x043E, 0x0447, 0x0443) + ' ',
  give: U(0x0414, 0x0430, 0x043C) + ' ',
  for: ' ' + U(0x0437, 0x0430) + ' ',
  orSwap: U(0x0438, 0x043B, 0x0438) + ' ' + U(0x043E, 0x0431, 0x043C, 0x0435, 0x043D) + '.',
  min: U(0x041E, 0x0442, 0x0434, 0x0430, 0x043C) + ' ' + U(0x043E, 0x0442) + ' ',
  openBtn: U(0x041E, 0x0442, 0x043A, 0x0440, 0x043E, 0x0439, 0x0442, 0x0435) + ' ' + U(0x00AB) + U(0x0421, 0x0434, 0x0435, 0x043B, 0x043A, 0x0430) + U(0x00BB) + '!',
};

function q(name) {
  return '\u00AB' + name + '\u00BB';
}

export function botShortName(bot) {
  const re = new RegExp('^' + t.bot + '\\s*[-\\u2014:]\\s*', 'i');
  return String(bot?.name || '').replace(re, '').trim() || bot?.name || t.bot;
}

export function botSay(game, bot, text, { force = false } = {}) {
  if (!game || !bot || !text) return false;
  const now = Date.now();
  if (!force && now - (game._lastBotChatAt || 0) < 450) return false;
  game._lastBotChatAt = now;
  game.addLog(bot.name + ': ' + text);
  return true;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function botAnnounceDesire(game, bot) {
  if (!bot?.isBot || bot.bankrupt) return false;
  const wants = [];
  const groups = new Set((bot.properties || []).map((id) => BOARD[id]?.group).filter(Boolean));
  for (const group of groups) {
    const props = getGroupProperties(group);
    if (props.length < 2) continue;
    const mine = props.filter((c) => game.propertyState[c.id]?.owner === bot.id);
    if (!mine.length || mine.length >= props.length) continue;
    for (const c of props) {
      const ps = game.propertyState[c.id];
      if (!ps || ps.owner == null) {
        wants.push({ cell: c, kind: 'buy', priority: mine.length === props.length - 1 ? 3 : 1 });
        continue;
      }
      if (ps.owner !== bot.id) {
        wants.push({
          cell: c,
          kind: 'trade',
          owner: game.players[ps.owner],
          priority: mine.length === props.length - 1 ? 4 : 2,
        });
      }
    }
  }
  for (const cell of BOARD) {
    if (!cell.group || !['property', 'utility', 'railroad'].includes(cell.type)) continue;
    const ps = game.propertyState[cell.id];
    if (ps?.owner != null) continue;
    const mine = getGroupProperties(cell.group).filter((c) => game.propertyState[c.id]?.owner === bot.id).length;
    if (mine >= 1) wants.push({ cell, kind: 'buy', priority: 1 });
  }

  if (!wants.length) {
    if (Math.random() < 0.45) return botSay(game, bot, pick([t.look1, t.look2, t.look3]));
    return false;
  }

  const seen = new Set();
  const uniq = [];
  for (const w of wants) {
    if (seen.has(w.cell.id)) continue;
    seen.add(w.cell.id);
    uniq.push(w);
  }
  uniq.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const wish = uniq[0] && Math.random() < 0.7 ? uniq[0] : pick(uniq);
  const short = botShortName(bot);
  const n = wish.cell.name;

  if (wish.kind === 'trade' && wish.owner) {
    const other = wish.owner.isBot ? botShortName(wish.owner) : wish.owner.name;
    const bid = botBuyPriceFor(game, bot, wish.cell);
    const bidTxt = bid > 0 ? formatPriceShort(bid) : formatPriceShort(wish.cell.price || 0);
    const forCountry = wouldCompleteGroup(game, bot.id, wish.cell)
      ? t.country
      : '.';
    return botSay(game, bot, pick([
      short + ' ' + t.wants + q(n) + forCountry + ' ' + other + ', ' + t.give + bidTxt + ' ' + t.orSwap + ' ' + t.openBtn,
      t.need + q(n) + '. ' + other + ', ' + t.tradeQ + ' ' + t.give + bidTxt + '.',
      t.very + t.of + q(n) + ' ' + U(0x0443) + ' ' + other + '. ' + t.give + bidTxt + ' ' + t.orSwap,
    ]), { force: true });
  }

  const price = formatPriceShort(wish.cell.price || 0);
  return botSay(game, bot, pick([
    t.want + t.buy + q(n) + ' (' + price + ').',
    t.eye + q(n) + t.take,
    t.dream + q(n) + t.country,
  ]), { force: true });
}

export function tryReplyBotChat(game, fromName, text) {
  if (!game || !text) return false;
  const raw = String(text).trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const bots = (game.players || []).filter((p) => p.isBot && !p.bankrupt && !p.left);
  const mentioned = bots.filter((b) => {
    const full = String(b.name || '').toLowerCase();
    const short = botShortName(b).toLowerCase();
    return (short.length >= 2 && lower.includes(short)) || lower.includes(full);
  });
  if (!mentioned.length) return false;

  const target = mentioned[0];
  const short = botShortName(target);
  const from = fromName || t.player;
  const cell = BOARD.find((c) => c.name && lower.includes(String(c.name).toLowerCase()));
  const dealRe = /сделк|обмен|меня|купл|прод|хоч|дам|бери/i;
  let reply;

  if (cell && dealRe.test(raw)) {
    const ps = game.propertyState[cell.id];
    if (ps?.owner === target.id) {
      const min = botSellPriceFor(game, target, cell);
      reply = pick([
        q(cell.name) + t.mine + t.min + formatPriceShort(min) + ' ' + t.orSwap + ' ' + t.openBtn,
        from + ', ' + q(cell.name) + ' ' + t.for + formatPriceShort(min) + '. ' + t.openBtn,
      ]);
    } else if (ps?.owner == null) {
      reply = pick([
        q(cell.name) + t.free + ' ' + t.want + t.buy + formatPriceShort(cell.price || 0) + '.',
        t.also + q(cell.name) + '.',
      ]);
    } else if (ps.owner === game.players.find(p => !p.isBot && p.name === fromName)?.id
      || (game.players.some(p => !p.isBot && !p.bankrupt && p.name === fromName
        && game.propertyState[cell.id]?.owner === p.id))) {
      const bid = botBuyPriceFor(game, target, cell);
      reply = pick([
        from + ', ' + t.give + formatPriceShort(bid) + t.for + q(cell.name) + '. ' + t.openBtn,
        t.need + q(cell.name) + ' — ' + t.give + formatPriceShort(bid) + ' ' + t.orSwap,
      ]);
    } else {
      reply = pick([
        t.about + ' ' + q(cell.name) + t.notMine + ' ' + t.discuss,
        from + ', ' + q(cell.name) + ' ' + t.other,
      ]);
    }
  } else if (dealRe.test(raw)) {
    // Назвать компанию, которую бот хочет у игрока
    const human = game.players.find(p => !p.isBot && !p.bankrupt && (p.name === fromName || String(p.name).toLowerCase() === lower));
    let hint = null;
    if (human) {
      for (const id of human.properties || []) {
        const c = BOARD[id];
        if (!c?.group) continue;
        const ps = game.propertyState[id];
        if (!ps || (ps.houses || 0) > 0 || ps.mortgaged) continue;
        if (wouldCompleteGroup(game, target.id, c) || countOwnedInGroup(game, target.id, c.group) >= 1) {
          hint = c;
          break;
        }
      }
    }
    if (hint) {
      const bid = botBuyPriceFor(game, target, hint);
      reply = pick([
        from + ', ' + t.need + q(hint.name) + ' — ' + t.give + formatPriceShort(bid) + '. ' + t.openBtn,
        t.want + q(hint.name) + t.for + formatPriceShort(bid) + '. ' + t.openBtn,
      ]);
    } else {
      reply = pick([from + ', ' + t.openDeal + ' ' + t.sayCo, 'Ok, ' + from + ', ' + t.wait + ' ' + t.sayCo]);
    }
  } else if (cell) {
    const ps = game.propertyState[cell.id];
    if (ps?.owner === target.id) {
      const min = botSellPriceFor(game, target, cell);
      reply = pick([
        q(cell.name) + t.mine + from + ', ' + t.min + formatPriceShort(min) + '.',
        t.yes + ', ' + q(cell.name) + ' ' + t.atMe + ' ' + t.for + formatPriceShort(min),
      ]);
    } else if (ps?.owner == null) {
      reply = pick([q(cell.name) + t.free, t.also + q(cell.name) + '.']);
    } else {
      reply = pick([t.about + ' ' + q(cell.name) + t.notMine, from + ', ' + q(cell.name) + ' ' + t.other]);
    }
  } else if (/привет|здрав|хей|\bhi\b/i.test(raw)) {
    reply = pick([t.hi + ', ' + from + '! ' + t.iAm + ' ' + short + '.', t.hey + ', ' + from + '!']);
  } else {
    reply = pick([
      from + ', ' + t.here + ' ' + t.writeCo + q(t.deal) + '.',
      t.yes + ', ' + from + '? ' + t.sayCo,
      short + ' ' + t.online,
    ]);
  }
  return botSay(game, target, reply, { force: true });
}

import { getCell, getGroupProperties } from './config.js';

/** Minimal cash reserve after buys/bids */
export const CASH_RESERVE = 180_000;

/** How many singleton groups before refusing junk */
export const MAX_SCATTERED_GROUPS = 4;

function groupStats(game, group) {
  const props = getGroupProperties(group);
  const total = props.length;
  const owners = new Map();
  let free = 0;
  for (const c of props) {
    const owner = game.propertyState[c.id]?.owner;
    if (owner == null) free += 1;
    else owners.set(owner, (owners.get(owner) || 0) + 1);
  }
  return { props, total, free, owners };
}

export function countOwnedInGroup(game, playerId, group) {
  if (!group) return 0;
  return groupStats(game, group).owners.get(playerId) || 0;
}

export function scatteredGroupCount(game, playerId) {
  const p = game.players[playerId];
  if (!p) return 0;
  const seen = new Set();
  let n = 0;
  for (const id of p.properties || []) {
    const cell = getCell(id);
    if (!cell?.group || seen.has(cell.group)) continue;
    seen.add(cell.group);
    const mine = countOwnedInGroup(game, playerId, cell.group);
    const { total } = groupStats(game, cell.group);
    if (mine === 1 && total > 1) n += 1;
  }
  return n;
}

export function wouldCompleteGroup(game, playerId, cell) {
  if (!cell?.group) return false;
  const { total } = groupStats(game, cell.group);
  const mine = countOwnedInGroup(game, playerId, cell.group);
  return mine === total - 1;
}

export function blocksEnemyMonopoly(game, playerId, cell) {
  if (!cell?.group) return false;
  const { total, owners } = groupStats(game, cell.group);
  for (const [oid, n] of owners) {
    if (oid !== playerId && n >= total - 1) return true;
  }
  return false;
}

export function interestScore(game, playerId, cell) {
  if (!cell) return 0;
  let score = 12;

  if (cell.type === 'property' && cell.group) {
    const mine = countOwnedInGroup(game, playerId, cell.group);
    const { total } = groupStats(game, cell.group);
    if (blocksEnemyMonopoly(game, playerId, cell)) score = 96;
    else if (mine === total - 1) score = 92;
    else if (mine >= 1) score = 68;
    else if (cell.noShares) score = 38;
    else score = 28;
  } else if (cell.type === 'utility') {
    const n = game.countUtilities?.(playerId) || 0;
    score = n >= 1 ? 62 : 40;
  } else if (cell.type === 'railroad') {
    const n = game.countRailroads?.(playerId) || 0;
    score = 32 + n * 14;
  }

  const scattered = scatteredGroupCount(game, playerId);
  if (scattered >= MAX_SCATTERED_GROUPS && score < 65) {
    score -= 12;
  }
  return Math.max(0, Math.min(100, score));
}

export function canAffordWithReserve(player, cost, reserve = CASH_RESERVE) {
  if (!player || cost == null) return false;
  return player.money - cost >= reserve;
}

function ownedCompanyCount(player) {
  return (player?.properties || []).length;
}

/** Hungry bots (few companies) bid/buy more aggressively */
function propertyHunger(player) {
  const n = ownedCompanyCount(player);
  if (n <= 0) return 1;
  if (n <= 2) return 0.9;
  if (n <= 4) return 0.65;
  return 0.35;
}

function softReserve(player) {
  const h = propertyHunger(player);
  if (h >= 0.9) return Math.min(CASH_RESERVE * 0.35, 90_000);
  if (h >= 0.65) return Math.min(CASH_RESERVE * 0.55, 130_000);
  return CASH_RESERVE * 0.75;
}

function feelsExpensive(player, price, score = 0) {
  if (price == null || !player) return true;
  const hunger = propertyHunger(player);
  const shareCap = hunger >= 0.9 ? 0.55 : hunger >= 0.65 ? 0.45 : 0.35;
  if (price > player.money * shareCap && score < 70) return true;
  if (player.money - price < softReserve(player) && score < 80) return true;
  return false;
}

export function shouldBotBuy(game, player, cell, price) {
  if (!player || !cell || price == null) return false;
  if (player.money < price) return false;

  const score = interestScore(game, player.id, cell);
  const completes = wouldCompleteGroup(game, player.id, cell);
  const blocks = blocksEnemyMonopoly(game, player.id, cell);
  const after = player.money - price;
  const hunger = propertyHunger(player);
  const reserve = softReserve(player);
  const list = cell.price || price;
  const atList = price <= list;

  // Block enemy monopoly / complete own set: soft reserve must not stop these
  if (blocks && after >= 40_000) return Math.random() < 0.98;
  if (completes && after >= 40_000) return true;

  if (after < reserve) {
    if (!completes && !blocks && !(hunger >= 0.9 && after >= reserve * 0.5)) return false;
    if ((completes || blocks) && after < 40_000) return false;
  }

  if (feelsExpensive(player, price, score) && !completes && !blocks && hunger < 0.9) return false;

  if (atList && hunger >= 0.9 && after >= reserve * 0.5) {
    return Math.random() < 0.97;
  }
  if (atList && hunger >= 0.65 && after >= reserve) {
    return Math.random() < 0.88;
  }

  if (completes || blocks || score >= 70) return true;
  if (score >= 55) return Math.random() < 0.9;
  if (score >= 35) return Math.random() < 0.7;
  if (atList && after >= CASH_RESERVE) return Math.random() < 0.65;
  return Math.random() < 0.35;
}

export function maxAuctionBid(game, player, cell) {
  if (!player || !cell?.price) return 0;
  const score = interestScore(game, player.id, cell);
  const base = cell.price;
  const hunger = propertyHunger(player);
  const blocks = blocksEnemyMonopoly(game, player.id, cell);
  const completes = wouldCompleteGroup(game, player.id, cell);
  let mult = 1.0;
  if (blocks) mult = 1.85;
  else if (score >= 90) mult = 1.55;
  else if (score >= 75) mult = 1.35;
  else if (score >= 60) mult = 1.2;
  else if (score >= 40) mult = 1.12;
  else if (hunger >= 0.9) mult = 1.25;
  else if (hunger >= 0.65) mult = 1.12;
  else mult = 1.05;

  let cap = Math.floor(base * mult);
  // Blocking: keep only about 40k; allow bidding almost all cash
  const reserve = (blocks || completes) ? 40_000 : softReserve(player);
  cap = Math.min(cap, Math.max(0, player.money - reserve));
  if (blocks) {
    cap = Math.max(cap, Math.min(Math.floor(base * mult), Math.max(0, player.money - 40_000)));
    return Math.max(0, cap);
  }
  if (player.money >= base + reserve * 0.4) {
    const floor = hunger >= 0.65 ? Math.floor(base * 1.1) : base;
    cap = Math.max(cap, floor);
  }
  if (player.money >= base * 3 && hunger >= 0.65) {
    cap = Math.max(cap, Math.floor(base * 1.3));
    cap = Math.min(cap, player.money - reserve);
  }
  return Math.max(0, cap);
}

export function shouldBotBid(game, player, cell, nextPrice) {
  if (!player || !cell || nextPrice == null) return false;
  if (player.money < nextPrice) return false;

  const list = cell.price || 0;
  const hunger = propertyHunger(player);
  const cap = maxAuctionBid(game, player, cell);
  if (nextPrice > cap) return false;

  const blocks = blocksEnemyMonopoly(game, player.id, cell);
  const completes = wouldCompleteGroup(game, player.id, cell);
  const after = player.money - nextPrice;

  if (blocks && nextPrice <= cap && after >= 40_000) return Math.random() < 0.99;
  if (completes && nextPrice <= cap && after >= 40_000) return Math.random() < 0.97;

  if (list > 0 && nextPrice <= list) {
    if (hunger >= 0.65) return Math.random() < 0.95;
    return shouldBotBuy(game, player, cell, nextPrice) || Math.random() < 0.55;
  }

  const score = interestScore(game, player.id, cell);
  if (feelsExpensive(player, nextPrice, score) && !completes && !blocks && hunger < 0.9) {
    return false;
  }

  if (completes || blocks || score >= 70) return Math.random() < 0.95;
  if (score >= 55 || hunger >= 0.9) return Math.random() < 0.85;
  if (score >= 35 || hunger >= 0.65) return Math.random() < 0.7;
  return Math.random() < 0.45;
}

/** Без рандома: останется ли бот в аукционе (для досрочного закрытия). */
export function botStaysInAuction(game, player, cell, nextPrice) {
  if (!player || !cell || nextPrice == null) return false;
  if (player.money < nextPrice) return false;
  const cap = maxAuctionBid(game, player, cell);
  if (nextPrice > cap) return false;
  const list = cell.price || 0;
  const blocks = blocksEnemyMonopoly(game, player.id, cell);
  const completes = wouldCompleteGroup(game, player.id, cell);
  const score = interestScore(game, player.id, cell);
  const hunger = propertyHunger(player);
  if (blocks || completes) return true;
  if (score >= 70 && nextPrice <= list * 1.25) return true;
  if (score >= 55 && nextPrice <= list * 1.12) return true;
  if ((score >= 35 || hunger >= 0.65) && nextPrice <= list) return true;
  return false;
}

export function chooseBotShareCell(game, player) {
  if (!player) return null;
  const options = game.getBuildableProperties?.(player.id) || [];
  if (!options.length) return null;

  const scored = options.map(cellId => {
    const cell = getCell(cellId);
    const ps = game.propertyState[cellId];
    const cost = cell?.houseCost || 0;
    const houses = ps?.houses || 0;
    const focus = houses > 0 ? 40 : 0;
    const cheap = Math.max(0, 30 - cost / 20_000);
    const depthPenalty = houses >= 3 ? -25 : 0;
    return { cellId, cost, houses, score: focus + cheap + depthPenalty };
  }).filter(o => canAffordWithReserve(player, o.cost, softReserve(player)));

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.cost - b.cost);
  return scored[0].cellId;
}

export function mortgageCandidates(game, player) {
  const list = [];
  for (const id of player.properties || []) {
    const cell = getCell(id);
    const ps = game.propertyState[id];
    if (!cell || !ps || ps.mortgaged || (ps.houses || 0) > 0) continue;
    if (!cell.price) continue;
    const mine = countOwnedInGroup(game, player.id, cell.group);
    const ownsAll = cell.group ? game.ownsGroup?.(player.id, cell.group) : false;
    let rank = 50;
    if (ownsAll) rank = 90;
    else if (mine <= 1) rank = 10;
    else rank = 40;
    list.push({ id, rank, price: cell.price });
  }
  list.sort((a, b) => a.rank - b.rank || a.price - b.price);
  return list.map(x => x.id);
}

export function shareSellCandidates(game, player) {
  const list = [];
  for (const id of player.properties || []) {
    const cell = getCell(id);
    const ps = game.propertyState[id];
    if (!cell || !ps || ps.mortgaged || (ps.houses || 0) <= 0) continue;
    if (!cell.houseCost) continue;
    const ownsAll = cell.group ? game.ownsGroup?.(player.id, cell.group) : false;
    list.push({
      id,
      houses: ps.houses,
      value: (cell.houseCost || 0) * ps.houses,
      rank: ownsAll ? 20 : 10,
    });
  }
  list.sort((a, b) => a.rank - b.rank || b.value - a.value);
  return list.map(x => x.id);
}

export function shouldAcceptDeal(game, bot, deal) {
  if (!bot || !deal) return false;

  let offerMoney = Math.max(0, Number(deal.offerMoney) || 0);
  let askMoney = Math.max(0, Number(deal.askMoney) || 0);
  let offerCells = [...(deal.offerCells || [])];
  let askCells = [...(deal.askCells || [])];
  if (deal.cellId != null && !askCells.length) {
    askCells = [deal.cellId];
    if (!offerMoney && deal.price != null) offerMoney = Number(deal.price) || 0;
  }

  if (!offerCells.length && !askCells.length) return false;

  const net = offerMoney - askMoney;
  if (net >= 0) { offerMoney = net; askMoney = 0; }
  else { askMoney = -net; offerMoney = 0; }

  const netPay = askMoney;
  if (netPay > 0 && bot.money - netPay < softReserve(bot)) return false;

  const proposer = deal.fromId != null ? game.players[deal.fromId] : null;
  const botToBot = !!(proposer?.isBot && bot.isBot);

  // Completing proposer's monopoly: never gift to human; bots may sell for a premium
  let helpsProposerMono = false;
  if (proposer) {
    for (const id of askCells) {
      const cell = getCell(id);
      if (!cell || !wouldCompleteGroup(game, deal.fromId, cell)) continue;
      if (!proposer.isBot) return false;
      helpsProposerMono = true;
    }
  }

  for (const id of askCells) {
    const cell = getCell(id);
    if (!cell?.group) continue;
    const mine = countOwnedInGroup(game, bot.id, cell.group);
    const { total } = groupStats(game, cell.group);
    if (game.ownsGroup?.(bot.id, cell.group)) return false;
    // Не ломаем свою почти собранную страну
    if (mine >= total - 1 && total > 1) return false;
  }

  const valueForBot = (id, asReceiver) => {
    const cell = getCell(id);
    if (!cell) return 0;
    let v = cell.price || 0;
    if (asReceiver) {
      if (wouldCompleteGroup(game, bot.id, cell)) v *= 1.7;
      else if (countOwnedInGroup(game, bot.id, cell.group) >= 1) v *= 1.35;
      else if (blocksEnemyMonopoly(game, bot.id, cell)) v *= 1.2;
      else v *= botToBot ? 1.0 : 0.95;
    } else {
      if (game.ownsGroup?.(bot.id, cell.group)) v *= 2.2;
      else if (countOwnedInGroup(game, bot.id, cell.group) >= 2) v *= 1.6;
      else if (helpsProposerMono) v *= botToBot ? 1.0 : 1.1;
      else v *= 1.1;
    }
    return v;
  };

  const receive = offerMoney + offerCells.reduce((s, id) => s + valueForBot(id, true), 0);
  const give = askMoney + askCells.reduce((s, id) => s + valueForBot(id, false), 0);
  if (give <= 0) return receive > 0;

  const isSwap = offerCells.length > 0 && askCells.length > 0;

  // Бот↔бот: принимаем честные сделки без «монетки» — иначе вечный спам отказов
  if (botToBot) {
    if (isSwap) {
      // обмен: нужна явная выгода или доплата, либо нам достраивают страну
      const completesUs = offerCells.some(id => wouldCompleteGroup(game, bot.id, getCell(id)));
      if (completesUs && receive >= give * 0.85) return true;
      return receive >= give * 1.05;
    }
    // деньги за нашу клетку
    const need = helpsProposerMono ? 1.2 : 1.05;
    return receive >= give * need;
  }

  if (isSwap) {
    if (receive >= give * 0.95) return true;
    if (receive >= give * 0.85) return Math.random() < 0.5;
    return false;
  }

  const need = helpsProposerMono ? 1.3 : 1.05;
  if (receive < give * need) return false;
  if (helpsProposerMono) return Math.random() < 0.75;
  if (receive >= give * 1.08) return true;
  return Math.random() < 0.5;
}

/** Cooldown for bot deals offered to human players */
export const HUMAN_DEAL_COOLDOWN_MS = 90_000;
/** Пауза между любыми сделками бот↔бот (антиспам) */
export const BOT_BOT_DEAL_COOLDOWN_MS = 90_000;

function roundCash(n) {
  return Math.max(0, Math.round(Number(n) / 10_000) * 10_000);
}

/** Цель почти собрала эту страну — у неё эту клетку не просить */
function isAlmostMonoPiece(game, ownerId, cell) {
  if (!cell?.group) return false;
  const { total } = groupStats(game, cell.group);
  if (total <= 1) return false;
  const mine = countOwnedInGroup(game, ownerId, cell.group);
  return mine >= total - 1;
}

function isTradeableCell(game, cellId) {
  const cell = getCell(cellId);
  const ps = game.propertyState[cellId];
  if (!cell || !ps) return false;
  if (ps.mortgaged || (ps.houses || 0) > 0) return false;
  return ['property', 'railroad', 'utility'].includes(cell.type);
}

/** Сколько бот готов отдать за клетку (для чата / контрпредложений) */
export function botBuyPriceFor(game, bot, cell) {
  if (!bot || !cell?.price) return 0;
  const list = cell.price;
  let mult = 1.05;
  if (wouldCompleteGroup(game, bot.id, cell)) mult = 1.55;
  else if (countOwnedInGroup(game, bot.id, cell.group) >= 1) mult = 1.3;
  else if (blocksEnemyMonopoly(game, bot.id, cell)) mult = 1.4;
  else if (interestScore(game, bot.id, cell) >= 55) mult = 1.15;
  let cash = roundCash(list * mult);
  const reserve = softReserve(bot);
  if (bot.money - cash < reserve) {
    cash = roundCash(Math.max(0, bot.money - reserve));
  }
  return cash;
}

/** Мин. цена, за которую бот отдаст клетку */
export function botSellPriceFor(game, bot, cell) {
  if (!bot || !cell?.price) return 0;
  const list = cell.price;
  let mult = 1.25;
  if (game.ownsGroup?.(bot.id, cell.group)) mult = 3;
  else if (isAlmostMonoPiece(game, bot.id, cell)) mult = 2.2;
  else if (countOwnedInGroup(game, bot.id, cell.group) >= 2) mult = 1.7;
  else if (countOwnedInGroup(game, bot.id, cell.group) >= 1) mult = 1.4;
  return roundCash(list * mult);
}

function botHasMonopoly(game, bot) {
  const seen = new Set();
  for (const id of bot.properties || []) {
    const cell = getCell(id);
    if (!cell?.group || seen.has(cell.group)) continue;
    seen.add(cell.group);
    if (game.ownsGroup?.(bot.id, cell.group)) return true;
  }
  return false;
}

/** Компании, которые бот может отдать (не ломая свою почти/готовую страну) */
function botOfferableCells(game, bot) {
  const list = [];
  for (const junkId of bot.properties || []) {
    if (!isTradeableCell(game, junkId)) continue;
    const jc = getCell(junkId);
    if (!jc?.group) continue;
    if (game.ownsGroup?.(bot.id, jc.group)) continue;
    if (isAlmostMonoPiece(game, bot.id, jc)) continue;
    list.push({ junkId, jc, price: jc.price || 0 });
  }
  return list;
}

/**
 * Кандидаты на обмен: приоритет — закрыть/усилить страну партнёру,
 * затем близкая цена (доплату деньгами можно выровнять).
 */
function rankSwapCandidates(game, bot, owner, wantCell) {
  const wantPrice = wantCell.price || 0;
  const out = [];
  for (const { junkId, jc, price } of botOfferableCells(game, bot)) {
    const completesThem = wouldCompleteGroup(game, owner.id, jc);
    const expandsThem = countOwnedInGroup(game, owner.id, jc.group) >= 1;
    const ratio = wantPrice > 0 ? price / wantPrice : 1;
    let score = 0;
    if (completesThem) score += 120;
    else if (expandsThem) score += 55;
    // Равноценность по цене (остаток добьём деньгами)
    if (ratio >= 0.75 && ratio <= 1.25) score += 35;
    else if (ratio >= 0.45 && ratio <= 1.6) score += 20;
    else if (ratio >= 0.25) score += 8;
    // Чуть предпочитаем близкий тир
    score += Math.max(0, 18 - Math.abs(price - wantPrice) / 25_000);
    out.push({ junkId, jc, price, score, completesThem, expandsThem });
  }
  out.sort((a, b) => b.score - a.score || Math.abs(a.price - wantPrice) - Math.abs(b.price - wantPrice));
  return out;
}

/** Равноценный обмен: компания + доплата, чтобы обеим было по стране / по цене */
function makeFairSwapDeal(game, bot, owner, wantCell, cand) {
  const wantPrice = wantCell.price || 0;
  const offerPrice = cand.price || 0;
  let offerMoney = 0;
  let askMoney = 0;
  // balance > 0 → бот получает более дорогую → доплачивает
  let balance = wantPrice - offerPrice;

  if (cand.completesThem) {
    // Им страну закрываем — не просим доплату, сами доплачиваем до цены
    balance = Math.max(balance, 0);
    if (balance > 10_000) offerMoney = roundCash(balance);
  } else if (cand.expandsThem) {
    if (balance > 15_000) offerMoney = roundCash(balance * 0.95);
    else if (balance < -40_000) askMoney = roundCash((-balance) * 0.35);
  } else {
    if (balance > 10_000) offerMoney = roundCash(balance);
    else if (balance < -10_000) askMoney = roundCash(-balance * 0.75);
  }

  const reserve = softReserve(bot);
  if (offerMoney > 0 && bot.money - offerMoney < reserve) {
    offerMoney = roundCash(Math.max(0, bot.money - reserve));
  }
  if (askMoney > 0 && owner.money < askMoney) {
    askMoney = roundCash(Math.max(0, owner.money - 40_000));
  }

  // Нетто в одну сторону
  const net = offerMoney - askMoney;
  if (net >= 0) { offerMoney = net; askMoney = 0; }
  else { askMoney = -net; offerMoney = 0; }

  return {
    toId: owner.id,
    offerMoney,
    askMoney,
    offerCells: [cand.junkId],
    askCells: [wantCell.id],
    fromId: bot.id,
  };
}

function swapChat(wantName, offerName, offerMoney, askMoney, cand) {
  const cashBit = offerMoney
    ? ` + $${offerMoney.toLocaleString('ru-RU')}`
    : (askMoney ? ` (вы +$${askMoney.toLocaleString('ru-RU')})` : '');
  if (cand.completesThem) {
    return `Меняю «${offerName}»${cashBit} на «${wantName}» — вам страна, мне страна. Честный обмен!`;
  }
  if (cand.expandsThem) {
    return `Обмен: вам «${offerName}»${cashBit} за «${wantName}» — усиливаем обе группы.`;
  }
  return `Равноценный обмен: «${offerName}»${cashBit} ↔ «${wantName}». Откройте сделку!`;
}

function buildBuyDeal(game, bot, owner, cell, kind) {
  const candidates = rankSwapCandidates(game, bot, owner, cell);
  // С человеком — сначала только обмен; деньги alone — лишь если нечего предложить
  // Если у бота уже есть страна — денег без компании не предлагаем
  const noCashOnly = !owner.isBot && (botHasMonopoly(game, bot) || candidates.length > 0);

  for (const cand of candidates) {
    // С человеком берём даже слабый кандидат (выровняем доплатой)
    if (!owner.isBot && cand.score < 8) continue;
    if (owner.isBot && cand.score < 40) continue;

    const draft = makeFairSwapDeal(game, bot, owner, cell, cand);
    if (owner.isBot && !shouldAcceptDeal(game, owner, { ...draft, fromId: bot.id })) {
      continue;
    }
    // С человеком: если сильно недоплатили за их дорогую клетку — пропустим слабый оффер
    if (!owner.isBot) {
      const theyGet = (cand.price || 0) + draft.offerMoney;
      const weGet = (cell.price || 0) + draft.askMoney;
      if (theyGet < weGet * 0.75 && !cand.completesThem) continue;
    }

    return {
      ...draft,
      _targetIsHuman: !owner.isBot,
      _cellName: cell.name,
      _chat: swapChat(cell.name, cand.jc.name, draft.offerMoney, draft.askMoney, cand),
    };
  }

  if (noCashOnly) return null;

  const cash = botBuyPriceFor(game, bot, cell);
  const listPrice = cell.price || 0;
  const minOk = roundCash(listPrice * (owner.isBot ? 1.15 : 1.05));
  if (cash < minOk || bot.money < cash) return null;

  const draft = {
    toId: owner.id,
    offerMoney: cash,
    askMoney: 0,
    offerCells: [],
    askCells: [cell.id],
    fromId: bot.id,
  };
  if (owner.isBot && !shouldAcceptDeal(game, owner, draft)) return null;

  const why = kind === 'complete'
    ? 'закрываю страну'
    : kind === 'expand'
      ? 'добиваю группу'
      : 'нужна в портфель';
  return {
    ...draft,
    _targetIsHuman: !owner.isBot,
    _cellName: cell.name,
    _chat: `Беру «${cell.name}» за $${cash.toLocaleString('ru-RU')} (${why}). Могу и на обмен компанией!`,
  };
}

function buildSellDeal(game, bot, buyer, cell) {
  if (!isTradeableCell(game, cell.id)) return null;
  if (isAlmostMonoPiece(game, bot.id, cell)) return null;
  const list = cell.price || 0;
  const completesThem = wouldCompleteGroup(game, buyer.id, cell);

  // С человеком: сначала обмен — им ключ к стране / нам добор
  if (!buyer.isBot) {
    const wants = [];
    for (const id of buyer.properties || []) {
      if (!isTradeableCell(game, id)) continue;
      const c = getCell(id);
      if (!c || isAlmostMonoPiece(game, buyer.id, c)) continue;
      let score = interestScore(game, bot.id, c);
      if (wouldCompleteGroup(game, bot.id, c)) score += 50;
      else if (countOwnedInGroup(game, bot.id, c.group) >= 1) score += 25;
      if (score >= 40) wants.push({ c, score });
    }
    wants.sort((a, b) => b.score - a.score);
    if (wants.length) {
      const take = wants[0].c;
      let offerMoney = 0;
      let askMoney = 0;
      const balance = (take.price || 0) - list; // >0 мы получаем дороже → они доплачивают
      if (wouldCompleteGroup(game, bot.id, take)) {
        // Нам закрывают страну — можем доплатить
        if (balance < -10_000) offerMoney = roundCash(-balance * 0.9);
      } else if (completesThem) {
        // Им закрываем — просим доплату если их ключ дешевле
        if (balance > 10_000) askMoney = roundCash(balance * 0.9);
        else if (balance < -15_000) offerMoney = roundCash(-balance * 0.5);
      } else {
        if (balance > 10_000) askMoney = roundCash(balance);
        else if (balance < -10_000) offerMoney = roundCash(-balance);
      }
      const reserve = softReserve(bot);
      if (offerMoney > 0 && bot.money - offerMoney < reserve) {
        offerMoney = roundCash(Math.max(0, bot.money - reserve));
      }
      if (askMoney > 0 && buyer.money < askMoney) {
        askMoney = roundCash(Math.max(0, buyer.money - 40_000));
      }
      const net = offerMoney - askMoney;
      if (net >= 0) { offerMoney = net; askMoney = 0; }
      else { askMoney = -net; offerMoney = 0; }
      return {
        toId: buyer.id,
        offerMoney,
        askMoney,
        offerCells: [cell.id],
        askCells: [take.id],
        fromId: bot.id,
        _targetIsHuman: true,
        _cellName: cell.name,
        _chat: completesThem || wouldCompleteGroup(game, bot.id, take)
          ? `Обмен странами: «${cell.name}» ↔ «${take.name}»${offerMoney ? ` + $${offerMoney.toLocaleString('ru-RU')} от меня` : ''}${askMoney ? ` + $${askMoney.toLocaleString('ru-RU')} от вас` : ''}.`
          : `Меняю «${cell.name}» на «${take.name}»${offerMoney ? ` +$${offerMoney.toLocaleString('ru-RU')}` : ''}${askMoney ? ` (вы +$${askMoney.toLocaleString('ru-RU')})` : ''}.`,
      };
    }
    // Нечего менять — продажа за деньги только если это ключ к их стране
    if (!completesThem && botHasMonopoly(game, bot)) return null;
  }

  let ask = botSellPriceFor(game, bot, cell);
  if (buyer.isBot) {
    ask = 0;
    for (const mult of [1.05, 1.12, 1.2, 1.28]) {
      const tryAsk = roundCash(list * (completesThem ? mult + 0.1 : mult));
      const draft = {
        toId: buyer.id,
        offerMoney: 0,
        askMoney: tryAsk,
        offerCells: [cell.id],
        askCells: [],
        fromId: bot.id,
      };
      if (buyer.money >= tryAsk && shouldAcceptDeal(game, buyer, draft)) {
        ask = tryAsk;
        break;
      }
    }
    if (!ask) {
      const wants = [];
      for (const id of buyer.properties || []) {
        if (!isTradeableCell(game, id)) continue;
        const c = getCell(id);
        if (!c || isAlmostMonoPiece(game, buyer.id, c)) continue;
        let score = interestScore(game, bot.id, c);
        if (wouldCompleteGroup(game, bot.id, c)) score += 40;
        if (score >= 45) wants.push({ c, score });
      }
      wants.sort((a, b) => b.score - a.score);
      if (!wants.length) return null;
      const take = wants[0].c;
      let topUp = roundCash(list - (take.price || 0));
      if (topUp < 0) topUp = 0;
      const draft = {
        toId: buyer.id,
        offerMoney: 0,
        askMoney: topUp,
        offerCells: [cell.id],
        askCells: [take.id],
        fromId: bot.id,
      };
      if (topUp > 0 && buyer.money < topUp) return null;
      if (!shouldAcceptDeal(game, buyer, draft)) return null;
      return {
        ...draft,
        _targetIsHuman: false,
        _cellName: cell.name,
        _chat: `Меняю «${cell.name}» на «${take.name}»${topUp ? ` + $${topUp.toLocaleString('ru-RU')}` : ''} — обеим выгоднее.`,
      };
    }
  }

  if (ask <= 0 || buyer.money < ask) return null;
  return {
    toId: buyer.id,
    offerMoney: 0,
    askMoney: ask,
    offerCells: [cell.id],
    askCells: [],
    fromId: bot.id,
    _targetIsHuman: !buyer.isBot,
    _cellName: cell.name,
    _chat: completesThem
      ? `Продаю «${cell.name}» за $${ask.toLocaleString('ru-RU')} — вам для страны. Лучше обмен компанией!`
      : `Продаю «${cell.name}» за $${ask.toLocaleString('ru-RU')}. Предпочитаю обмен.`,
  };
}

/**
 * Умная сделка: добор страны, расширение группы, продажа «ключа» человеку,
 * обмен компаниями (в т.ч. бот↔бот, если цель примет).
 */
export function chooseBotDeal(game, bot, { humanCooldownOk = true, botBotCooldownOk = true } = {}) {
  if (!bot || bot.bankrupt) return null;
  if (game.phase !== 'roll' || game.deal) return null;

  const opportunities = [];
  const seenGroups = new Set();

  for (const id of bot.properties || []) {
    const cell = getCell(id);
    if (!cell?.group || seenGroups.has(cell.group)) continue;
    seenGroups.add(cell.group);
    const { total, props } = groupStats(game, cell.group);
    if (total < 2) continue;
    const mine = countOwnedInGroup(game, bot.id, cell.group);
    if (mine < 1 || mine >= total) continue;

    const kind = mine === total - 1 ? 'complete' : 'expand';
    const baseScore = kind === 'complete' ? 100 : 55;

    for (const c of props) {
      const ps = game.propertyState[c.id];
      if (!ps || ps.owner == null || ps.owner === bot.id) continue;
      if (!isTradeableCell(game, c.id)) continue;
      const owner = game.players[ps.owner];
      if (!owner || owner.bankrupt) continue;
      if (isAlmostMonoPiece(game, owner.id, c)) continue;
      let score = baseScore + (owner.isBot ? 0 : 15) + (c.price || 0) / 1e6;
      // Бонус, если можем закрыть им страну в обмен
      const bestSwap = rankSwapCandidates(game, bot, owner, c)[0];
      if (bestSwap?.completesThem) score += 40;
      else if (bestSwap?.expandsThem) score += 18;
      else if (bestSwap && !owner.isBot) score += 10;
      opportunities.push({
        type: 'buy',
        cell: c,
        owner,
        listPrice: c.price || 0,
        kind,
        score,
      });
    }
  }

  // Продажа клетки, которая закрывает страну человеку (или усиливает группу)
  for (const id of bot.properties || []) {
    if (!isTradeableCell(game, id)) continue;
    const cell = getCell(id);
    if (!cell?.group) continue;
    if (isAlmostMonoPiece(game, bot.id, cell)) continue;
    for (const p of game.activePlayers) {
      if (p.id === bot.id || p.bankrupt) continue;
      if (!wouldCompleteGroup(game, p.id, cell) && countOwnedInGroup(game, p.id, cell.group) < 1) continue;
      let score = wouldCompleteGroup(game, p.id, cell) ? 85 : 40;
      score += p.isBot ? 0 : 12;
      // Ещё выше, если взамен можем закрыть свою страну
      for (const oid of p.properties || []) {
        if (!isTradeableCell(game, oid)) continue;
        const oc = getCell(oid);
        if (oc && wouldCompleteGroup(game, bot.id, oc)) {
          score += 35;
          break;
        }
      }
      opportunities.push({
        type: 'sell',
        cell,
        owner: p,
        listPrice: cell.price || 0,
        kind: 'sell',
        score,
      });
    }
  }

  if (!opportunities.length) return null;

  opportunities.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ah = a.owner.isBot ? 1 : 0;
    const bh = b.owner.isBot ? 1 : 0;
    return ah - bh;
  });

  for (const opp of opportunities) {
    const { owner } = opp;
    if (!owner.isBot && !humanCooldownOk) continue;
    if (owner.isBot && !botBotCooldownOk) continue;

    const draft = opp.type === 'sell'
      ? buildSellDeal(game, bot, owner, opp.cell)
      : buildBuyDeal(game, bot, owner, opp.cell, opp.kind);
    if (draft) return draft;
  }
  return null;
}

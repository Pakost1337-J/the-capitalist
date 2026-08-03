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
export const HUMAN_DEAL_COOLDOWN_MS = 180_000;
/** Пауза между любыми сделками бот↔бот (антиспам) */
export const BOT_BOT_DEAL_COOLDOWN_MS = 120_000;

/** Цель почти собрала эту страну — у неё эту клетку не просить */
function isAlmostMonoPiece(game, ownerId, cell) {
  if (!cell?.group) return false;
  const { total } = groupStats(game, cell.group);
  if (total <= 1) return false;
  const mine = countOwnedInGroup(game, ownerId, cell.group);
  return mine >= total - 1;
}

/**
 * Find a deal to complete a country (missing 1 company).
 * Returns proposeDeal payload or null.
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
    if (mine !== total - 1) continue;

    for (const c of props) {
      const ps = game.propertyState[c.id];
      if (!ps || ps.owner == null || ps.owner === bot.id) continue;
      if (ps.mortgaged || (ps.houses || 0) > 0) continue;
      if (!['property', 'railroad', 'utility'].includes(c.type)) continue;
      const owner = game.players[ps.owner];
      if (!owner || owner.bankrupt) continue;
      // Не просим клетку из почти готовой страны жертвы — всегда отказ
      if (isAlmostMonoPiece(game, owner.id, c)) continue;
      opportunities.push({ cell: c, owner, listPrice: c.price || 0 });
    }
  }

  if (!opportunities.length) return null;

  // С людьми — приоритет; бот↔бот только если кулдаун ок
  opportunities.sort((a, b) => {
    const ah = a.owner.isBot ? 1 : 0;
    const bh = b.owner.isBot ? 1 : 0;
    if (ah !== bh) return ah - bh;
    return b.listPrice - a.listPrice;
  });

  for (const opp of opportunities) {
    const { cell, owner, listPrice } = opp;
    if (!owner.isBot && !humanCooldownOk) continue;
    if (owner.isBot && !botBotCooldownOk) continue;

    // Бот↔бот: только деньги (обмен «мусор на монополию» всегда отклоняли → спам)
    // С человеком: можно предложить обмен, если ему это выгодно
    if (!owner.isBot) {
      const swapCandidates = [];
      for (const junkId of bot.properties || []) {
        if (junkId === cell.id) continue;
        const jc = getCell(junkId);
        const jps = game.propertyState[junkId];
        if (!jc?.group || !jps || jps.mortgaged || (jps.houses || 0) > 0) continue;
        const jMine = countOwnedInGroup(game, bot.id, jc.group);
        const { total: jTotal } = groupStats(game, jc.group);
        if (jMine >= jTotal - 1) continue;
        const theirGain = countOwnedInGroup(game, owner.id, jc.group);
        const completesThem = wouldCompleteGroup(game, owner.id, jc);
        const price = jc.price || 0;
        const ratio = listPrice > 0 ? price / listPrice : 0;
        let score = 0;
        if (completesThem) score += 80;
        else if (theirGain >= 1 && ratio >= 0.75 && ratio <= 1.4) score += 45;
        else if (ratio >= 0.9 && ratio <= 1.15) score += 20;
        if (score >= 45) swapCandidates.push({ junkId, price, score, jc });
      }
      swapCandidates.sort((a, b) => b.score - a.score);
      if (swapCandidates.length) {
        const best = swapCandidates[0];
        let cash = 0;
        const diff = listPrice - best.price;
        if (diff > 20_000) {
          cash = Math.round(diff * 0.9 / 10_000) * 10_000;
          const reserve = softReserve(bot);
          if (bot.money - cash < reserve) {
            cash = Math.max(0, Math.floor((bot.money - reserve) / 10_000) * 10_000);
          }
        }
        const draft = {
          toId: owner.id,
          offerMoney: cash,
          askMoney: 0,
          offerCells: [best.junkId],
          askCells: [cell.id],
          fromId: bot.id,
        };
        // Только если человек теоретически мог бы взять (для бота-цели — ниже)
        return {
          ...draft,
          _targetIsHuman: true,
          _cellName: cell.name,
          _chat: `Хочу «${cell.name}» за «${best.jc.name}»${cash ? ` + $${cash.toLocaleString('ru-RU')}` : ''}`,
        };
      }
    }

    // Деньги: боту — достаточная премия, чтобы shouldAcceptDeal принял
    const premium = owner.isBot ? 1.35 : 1.4;
    let cash = Math.floor(listPrice * premium);
    cash = Math.round(cash / 10_000) * 10_000;
    cash = Math.max(cash, Math.floor(listPrice * (owner.isBot ? 1.25 : 1.15)));
    const reserve = softReserve(bot);
    if (bot.money - cash < reserve) {
      cash = Math.max(0, bot.money - reserve);
      cash = Math.floor(cash / 10_000) * 10_000;
    }
    if (cash < Math.floor(listPrice * (owner.isBot ? 1.2 : 1.1))) continue;
    if (bot.money < cash) continue;

    const draft = {
      toId: owner.id,
      offerMoney: cash,
      askMoney: 0,
      offerCells: [],
      askCells: [cell.id],
      fromId: bot.id,
    };

    // Не предлагаем боту то, что он точно отклонит
    if (owner.isBot && !shouldAcceptDeal(game, owner, draft)) continue;

    return {
      ...draft,
      _targetIsHuman: !owner.isBot,
      _cellName: cell.name,
      _chat: `Хочу «${cell.name}» за $${cash.toLocaleString('ru-RU')}`,
    };
  }
  return null;
}

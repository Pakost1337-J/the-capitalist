import { getCell, getGroupProperties } from './config.js';

/** Minimal cash reserve after buys/bids */
export const CASH_RESERVE = 250_000;

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
    if (mine === total - 1) score = 92;
    else if (blocksEnemyMonopoly(game, playerId, cell)) score = 78;
    else if (mine >= 1) score = 68;
    else if (cell.noShares) score = 38;
    else score = 22;
  } else if (cell.type === 'utility') {
    const n = game.countUtilities?.(playerId) || 0;
    score = n >= 1 ? 62 : 34;
  } else if (cell.type === 'railroad') {
    const n = game.countRailroads?.(playerId) || 0;
    score = 28 + n * 14;
  }

  const scattered = scatteredGroupCount(game, playerId);
  if (scattered >= MAX_SCATTERED_GROUPS && score < 65) {
    score -= 18;
  }
  return Math.max(0, Math.min(100, score));
}

export function canAffordWithReserve(player, cost, reserve = CASH_RESERVE) {
  if (!player || cost == null) return false;
  return player.money - cost >= reserve;
}

export function shouldBotBuy(game, player, cell, price) {
  if (!player || !cell || price == null) return false;
  if (player.money < price) return false;

  const score = interestScore(game, player.id, cell);
  const completes = wouldCompleteGroup(game, player.id, cell);
  const after = player.money - price;

  if (after < CASH_RESERVE) {
    if (!completes || after < CASH_RESERVE * 0.45) return false;
  }

  if (price > player.money * 0.35 && score < 75) return false;

  if (score >= 70) return true;
  if (score >= 55) return Math.random() > 0.2;
  return false;
}

export function maxAuctionBid(game, player, cell) {
  if (!player || !cell?.price) return 0;
  const score = interestScore(game, player.id, cell);
  const base = cell.price;
  let mult = 0.65;
  if (score >= 90) mult = 1.45;
  else if (score >= 75) mult = 1.2;
  else if (score >= 60) mult = 1.05;
  else if (score >= 40) mult = 0.85;
  else mult = 0.65;

  let cap = Math.floor(base * mult);
  cap = Math.min(cap, Math.max(0, player.money - CASH_RESERVE));
  return cap;
}

export function shouldBotBid(game, player, cell, nextPrice) {
  if (!player || !cell || nextPrice == null) return false;
  if (player.money < nextPrice) return false;
  if (!canAffordWithReserve(player, nextPrice) && !wouldCompleteGroup(game, player.id, cell)) {
    return false;
  }
  const cap = maxAuctionBid(game, player, cell);
  if (nextPrice > cap) return false;
  if (nextPrice > cap * 0.9) return Math.random() > 0.35;
  return Math.random() > 0.15;
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
  }).filter(o => canAffordWithReserve(player, o.cost));

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

  const netPay = Math.max(0, askMoney - offerMoney);
  if (bot.money - netPay < CASH_RESERVE * 0.6 && netPay > 0) return false;

  for (const id of askCells) {
    const cell = getCell(id);
    if (!cell?.group) continue;
    const mine = countOwnedInGroup(game, bot.id, cell.group);
    const { total } = groupStats(game, cell.group);
    if (mine >= total - 1 && total > 1) return false;
    if (game.ownsGroup?.(bot.id, cell.group)) return false;
  }

  const cellValue = (id) => {
    const cell = getCell(id);
    if (!cell) return 0;
    let v = cell.price || 0;
    const score = interestScore(game, bot.id, cell);
    if (wouldCompleteGroup(game, bot.id, cell)) v *= 1.55;
    else if (score >= 65) v *= 1.25;
    else if (blocksEnemyMonopoly(game, bot.id, cell)) v *= 1.2;
    return v;
  };

  const giveValue = offerMoney + offerCells.reduce((s, id) => s + (getCell(id)?.price || 0), 0);
  const takeValue = askMoney + askCells.reduce((s, id) => s + cellValue(id), 0);

  let strategic = false;
  for (const id of offerCells) {
    const cell = getCell(id);
    if (cell && (wouldCompleteGroup(game, bot.id, cell) || countOwnedInGroup(game, bot.id, cell.group) >= 1)) {
      strategic = true;
      break;
    }
  }

  if (takeValue <= 0) return false;
  const ratio = giveValue / takeValue;
  if (strategic && ratio >= 0.7) return Math.random() > 0.2;
  if (ratio >= 0.9) return Math.random() > 0.25;
  if (ratio >= 0.8) return Math.random() > 0.55;
  return false;
}

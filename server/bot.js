import { PHASE } from '../js/game.js';
import { getCell } from '../js/config.js';
import { moveAnimMs } from '../js/anim-timing.js';
import {
  shouldBotBuy,
  shouldBotBid,
  botStaysInAuction,
  maxAuctionBid,
  chooseBotShareCell,
  chooseBotDeal,
  HUMAN_DEAL_COOLDOWN_MS,
  BOT_BOT_DEAL_COOLDOWN_MS,
  mortgageCandidates,
  shareSellCandidates,
  shouldAcceptDeal,
  botBuyPriceFor,
  botSellPriceFor,
} from '../js/bot-strategy.js';
import { botSay, botAnnounceDesire } from './bot-chat.js';

export { tryReplyBotChat } from './bot-chat.js';

/** Пауза между видимыми действиями бота (лог / UI) */
const STEP_MS = 2000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const U = String.fromCharCode;
function q(n) { return '\u00AB' + n + '\u00BB'; }
const BOT_THOUGHTS = {
  roll: [
    U(0x041A,0x0438,0x0434,0x0430,0x044E) + ' ' + U(0x043A,0x043E,0x0441,0x0442,0x0438) + U(0x2026),
    U(0x041F,0x043E,0x0435,0x0445,0x0430,0x043B,0x0438) + '!',
    U(0x0425,0x043E,0x0434) + ' ' + U(0x0437,0x0430) + ' ' + U(0x043C,0x043D,0x043E,0x0439) + '.',
  ],
  buy: [
    (n) => U(0x0411,0x0435,0x0440,0x0443) + ' ' + q(n) + '!',
    (n) => q(n) + ' ' + U(0x0432) + ' ' + U(0x043F,0x043E,0x0440,0x0442,0x0444,0x0435,0x043B,0x044C) + '.',
    (n) => U(0x041F,0x043E,0x043A,0x0443,0x043F,0x0430,0x044E) + ' ' + q(n) + '.',
  ],
  pass: [
    (n) => q(n) + ' ' + U(0x0434,0x043E,0x0440,0x043E,0x0433,0x043E) + ' ' + U(0x2014) + ' ' + U(0x043F,0x0430,0x0441) + '.',
    (n) => U(0x041D,0x0435) + ' ' + U(0x0441,0x0435,0x0439,0x0447,0x0430,0x0441) + ' ' + q(n) + '.',
    (n) => U(0x041D,0x0430) + ' ' + U(0x0430,0x0443,0x043A,0x0446,0x0438,0x043E,0x043D) + ': ' + q(n),
  ],
  rent: [
    U(0x041E,0x043F,0x043B,0x0430,0x0447,0x0443) + '.',
    U(0x0414,0x043E,0x043B,0x0433) + ' ' + U(0x043F,0x043E,0x0433,0x0430,0x0448,0x0430,0x044E) + '.',
    U(0x041F,0x0440,0x0438,0x0434,0x0451,0x0442,0x0441,0x044F) + ' ' + U(0x0437,0x0430,0x043F,0x043B,0x0430,0x0442,0x0438,0x0442,0x044C) + U(0x2026),
  ],
  share: [
    (n) => U(0x0410,0x043A,0x0446,0x0438,0x044F) + ' ' + U(0x043D,0x0430) + ' ' + q(n) + '.',
    (n) => U(0x0423,0x0441,0x0438,0x043B,0x0438,0x0432,0x0430,0x044E) + ' ' + q(n) + '.',
  ],
  auction: [
    (n) => U(0x0421,0x0442,0x0430,0x0432,0x043B,0x044E) + ' ' + U(0x0437,0x0430) + ' ' + q(n) + '!',
    (n) => U(0x041F,0x0435,0x0440,0x0435,0x0431,0x0438,0x0432,0x0430,0x044E) + ' ' + U(0x0437,0x0430) + ' ' + q(n) + '.',
  ],
  jail: [
    U(0x0412,0x044B,0x0445,0x043E,0x0436,0x0443) + ' ' + U(0x0438,0x0437) + ' ' + U(0x0442,0x044E,0x0440,0x044C,0x043C,0x044B) + '.',
    U(0x041F,0x043B,0x0430,0x0447,0x0443) + ' ' + U(0x0437,0x0430,0x043B,0x043E,0x0433) + '.',
  ],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function pulse(broadcast) {
  if (typeof broadcast === 'function') broadcast();
  await wait(STEP_MS);
}

/** Ждём конец анимации кубиков/хода, затем commitMove */
async function waitForMoveAnim(game, broadcast) {
  if (game.phase !== PHASE.MOVING) return;
  const ends = game.moveAnimEndsAt || (Date.now() + moveAnimMs(
    (game.dice?.[0] || 0) + (game.dice?.[1] || 0),
    { moved: !game._pendingJailStay },
  ));
  const left = Math.max(0, ends - Date.now());
  await wait(left + 40);
  if (game.phase === PHASE.MOVING) {
    game.commitMove();
  }
  if (typeof broadcast === 'function') broadcast();
}

export function runBotTurn(game, onDone, broadcast = () => {}) {
  // Ответ на входящую сделку
  if (game.deal) {
    const to = game.players[game.deal.toId];
    if (to?.isBot && !to.bankrupt) {
      setTimeout(() => {
        settleBotDeal(game);
        onDone();
      }, STEP_MS);
      return;
    }
  }

  const player = game.currentPlayer;
  if (!player?.isBot || player.bankrupt || game.phase === PHASE.GAME_OVER) {
    onDone();
    return;
  }

  (async () => {
    await wait(STEP_MS);

    if (game.phase === PHASE.ROLL) {
      if (game.deal || game.dealUiOpen || game.shareUiOpen) {
        onDone();
        return;
      }

      // До броска: желание в чат, затем сделка / кости
      if (!player.inJail) {
        botAnnounceDesire(game, player);
        if (typeof broadcast === 'function') broadcast();
        await wait(600);
      }
      if (!player.inJail && tryBotProposeDeal(game, player)) {
        await pulse(broadcast);
        onDone();
        return;
      }

      // Порядок: бросок → клетка → покупка/аренда → акция (после хода)
      if (player.inJail && player.money >= 50_000 && Math.random() > 0.55) {
        botSay(game, player, pick(BOT_THOUGHTS.jail), { force: true });
        game.payJailBail();
        await pulse(broadcast);
      }
      botSay(game, player, pick(BOT_THOUGHTS.roll), { force: true });
      game.rollDice();
      if (typeof broadcast === 'function') broadcast();
      await waitForMoveAnim(game, broadcast);
      await handleAfterRoll(game, broadcast);
      onDone();
    } else if (game.phase === PHASE.MOVING) {
      await waitForMoveAnim(game, broadcast);
      await handleAfterRoll(game, broadcast);
      onDone();
    } else if (game.phase === PHASE.AUCTION) {
      tryBotAuctionRound(game);
      onDone();
    } else if (
      game.phase === PHASE.ACTION
      && ['rent', 'tax', 'force'].includes(game.pendingAction?.type)
    ) {
      settleBotRent(game);
      await pulse(broadcast);
      await finishBotTurn(game, broadcast);
      onDone();
    } else if (game.phase === PHASE.END) {
      await finishBotTurn(game, broadcast);
      onDone();
    } else {
      onDone();
    }
  })().catch(() => onDone());
}

async function handleAfterRoll(game, broadcast) {
  // Анимация уже доиграна в waitForMoveAnim → commitMove
  if (game.phase === PHASE.MOVING) {
    await waitForMoveAnim(game, broadcast);
  }

  if (game.phase === PHASE.ACTION && game.pendingAction?.type === 'buy') {
    const { cellId, price } = game.pendingAction;
    const player = game.currentPlayer;
    const cell = getCell(cellId);

    // Не хватает денег — пробуем заложить, потом купить, иначе аукцион
    if (player.money < price) {
      botSay(game, player, U(0x0414,0x0435,0x043D,0x0435,0x0433) + ' ' + U(0x043C,0x0430,0x043B,0x043E) + U(0x2026), { force: true });
      game.autoRaiseCash?.(player, price);
      await pulse(broadcast);
    }
    if (player.money >= price && shouldBotBuy(game, player, cell, price)) {
      botSay(game, player, pick(BOT_THOUGHTS.buy)(cell?.name || '?'), { force: true });
      game.buyProperty();
    } else if (player.money >= price && Math.random() < 0.35) {
      botSay(game, player, pick(BOT_THOUGHTS.buy)(cell?.name || '?'), { force: true });
      game.buyProperty();
    } else {
      botSay(game, player, pick(BOT_THOUGHTS.pass)(cell?.name || '?'), { force: true });
      game.passProperty();
    }
    await pulse(broadcast);

    if (game.phase === PHASE.AUCTION) {
      tryBotAuctionRound(game);
      await pulse(broadcast);
    }
    await finishBotTurn(game, broadcast);
    return;
  }

  if (
    game.phase === PHASE.ACTION
    && ['rent', 'tax', 'force'].includes(game.pendingAction?.type)
  ) {
    const player = game.currentPlayer;
    if (Math.random() < 0.85) botSay(game, player, pick(BOT_THOUGHTS.rent), { force: true });
    settleBotRent(game);
    await pulse(broadcast);
    await finishBotTurn(game, broadcast);
    return;
  }

  if (game.phase === PHASE.AUCTION) {
    tryBotAuctionRound(game);
    await pulse(broadcast);
    return;
  }

  if (game.phase === PHASE.END) {
    await finishBotTurn(game, broadcast);
    return;
  }

  if (game.phase === PHASE.GAME_OVER) {
    return;
  }

  // Дубль: фаза снова ROLL — следующий runBotTurn в цепочке
  if (game.phase === PHASE.ROLL) {
    await wait(STEP_MS);
    return;
  }

  await finishBotTurn(game, broadcast);
}

/** Боты: ставки; кто не будет перебивать — выходит (иначе аукцион не закрывается). */
function tryBotAuctionRound(game) {
  if (game.phase !== PHASE.AUCTION || !game.auction) return;
  const cell = getCell(game.auction.cellId);

  // До 3 перебивок за раунд — боты торгуются между собой
  for (let bids = 0; bids < 3; bids++) {
    if (game.phase !== PHASE.AUCTION) return;
    const next = game.nextAuctionPrice();
    let placed = false;
    const contenders = game.activePlayers.filter((p) => (
      p.isBot
      && game.canPlayerAuctionBid?.(p.id)
      && game.auction.highBidder !== p.id
      && p.money >= next
      && shouldBotBid(game, p, cell, next)
    ));
    for (let i = contenders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [contenders[i], contenders[j]] = [contenders[j], contenders[i]];
    }
    for (const p of contenders) {
      if (game.placeAuctionBid(p.id)) {
        botSay(game, p, pick(BOT_THOUGHTS.auction)(cell?.name || '?'), { force: true });
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }
  if (game.phase !== PHASE.AUCTION) return;

  // Кто не ставит дальше (потолок / нет денег / неинтересно) — выходит,
  // чтобы аукцион закрылся, когда ставка уже «за» ботом и люди ушли.
  const ask = game.nextAuctionPrice();
  for (const p of game.activePlayers) {
    if (!p.isBot) continue;
    if (!game.canPlayerAuctionBid?.(p.id)) continue;
    if (game.auction.highBidder === p.id) continue;
    if (!botStaysInAuction(game, p, cell, ask)) {
      game.leaveAuction(p.id);
      if (game.phase !== PHASE.AUCTION) return;
    }
  }
  game.maybeFinishAuctionEarly?.();
}

export function tryBotBuyShare(game) {
  const player = game.currentPlayer;
  if (!player?.isBot || player.bankrupt) return false;
  if (player.inJail) return false;
  const cellId = chooseBotShareCell(game, player);
  if (cellId == null) return false;
  const cell = getCell(cellId);
  const ok = game.buildHouse(cellId);
  if (ok) botSay(game, player, pick(BOT_THOUGHTS.share)(cell?.name || '?'), { force: true });
  return ok;
}

function settleBotRent(game) {
  const pa = game.pendingAction;
  if (!pa || !['rent', 'tax', 'force'].includes(pa.type)) return;
  const player = game.currentPlayer;
  let guard = 0;

  while (player.money < pa.amount && guard < 20) {
    const props = mortgageCandidates(game, player);
    if (props.length) {
      game.mortgageProperty(props[0]);
      guard += 1;
      continue;
    }
    const shares = shareSellCandidates(game, player);
    if (!shares.length) break;
    game.sellShare(shares[0]);
    guard += 1;
  }

  if (pa.type === 'tax') game.payTaxDebt();
  else if (pa.type === 'force') game.payCardDebt();
  else game.payRentDebt();
}

async function finishBotTurn(game, broadcast) {
  if (
    game.phase === PHASE.ACTION
    && ['rent', 'tax', 'force'].includes(game.pendingAction?.type)
  ) {
    settleBotRent(game);
    await pulse(broadcast);
  }

  if (game.phase === PHASE.END) {
    // После клетки / оплаты — до 2 акций, затем смена хода
    if (tryBotBuyShare(game)) {
      await pulse(broadcast);
    }
    if (tryBotBuyShare(game)) {
      await pulse(broadcast);
    }
    if (game.phase === PHASE.END) {
      game.endTurn();
    }
  }
}

function settleBotDeal(game) {
  const d = game.deal;
  if (!d) return;
  const to = game.players[d.toId];
  if (!to?.isBot) return;

  if (shouldAcceptDeal(game, to, d)) {
    botSay(game, to, pick([
      'Принимаю — честная цена.',
      'Ок, берём.',
      'Договорились.',
    ]), { force: true });
    game.acceptDeal(to.id);
  } else {
    const askCell = (d.askCells || [])[0];
    const cell = askCell != null ? getCell(askCell) : null;
    let counter = '';
    if (cell && (d.askCells || []).includes(cell.id)) {
      const min = botSellPriceFor(game, to, cell);
      if (min > 0) counter = ` Минимум $${min.toLocaleString('ru-RU')} или обмен.`;
    }
    botSay(game, to, pick([
      `Не выгодно.${counter}`,
      `Отказ — компании дороже денег.${counter}`,
      `Нет.${counter} Кидайте лучше обмен.`,
    ]), { force: true });
    game.rejectDeal(to.id);
  }
}

/** Предложить сделку за недостающую клетку страны (бот↔бот или бот→игрок). */
function tryBotProposeDeal(game, bot) {
  if (!game.canOfferDeal?.(bot.id)) return false;
  // Чаще предлагаем людям, реже — «пустые» ходы без сделки
  if (Math.random() > 0.52) return false;

  const now = Date.now();
  const humanCooldownOk = now - (game.lastBotDealToHumanAt || 0) >= HUMAN_DEAL_COOLDOWN_MS;
  const botBotCooldownOk = now - (game.lastBotBotDealAt || 0) >= BOT_BOT_DEAL_COOLDOWN_MS;
  if (!humanCooldownOk && !botBotCooldownOk) return false;

  const deal = chooseBotDeal(game, bot, { humanCooldownOk, botBotCooldownOk });
  if (!deal) return false;

  const { _targetIsHuman, _cellName, _chat, fromId, ...payload } = deal;

  if (!_targetIsHuman) {
    const target = game.players[payload.toId];
    if (!target || !shouldAcceptDeal(game, target, { ...payload, fromId: bot.id })) {
      return false;
    }
  }

  if (!game.proposeDeal(bot.id, payload)) return false;

  if (_chat) botSay(game, bot, _chat, { force: true });
  if (_targetIsHuman) game.lastBotDealToHumanAt = now;
  else game.lastBotBotDealAt = now;
  return true;
}

export function processBotChain(game, broadcast) {
  if (game._botRunning) return;
  game._botRunning = true;

  function tick() {
    if (game.phase === PHASE.GAME_OVER) {
      game._botRunning = false;
      broadcast();
      return;
    }

    if (game.deal) {
      const to = game.players[game.deal.toId];
      if (to?.isBot && !to.bankrupt) {
        runBotTurn(game, () => {
          broadcast();
          tick();
        }, broadcast);
        return;
      }
      game._botRunning = false;
      return;
    }

    if (game.phase === PHASE.AUCTION) {
      tryBotAuctionRound(game);
      broadcast();
      if (game.phase !== PHASE.AUCTION) {
        tick();
        return;
      }
      game._botRunning = false;
      setTimeout(() => {
        if (game.phase === PHASE.AUCTION || game.currentPlayer?.isBot) {
          processBotChain(game, broadcast);
        }
      }, STEP_MS);
      return;
    }

    const p = game.currentPlayer;
    if (p.isBot && !p.bankrupt) {
      runBotTurn(game, () => {
        broadcast();
        tick();
      }, broadcast);
    } else {
      game._botRunning = false;
    }
  }

  tick();
}

import { PHASE } from '../js/game.js';
import { getCell } from '../js/config.js';
import { moveAnimMs } from '../js/anim-timing.js';
import {
  shouldBotBuy,
  shouldBotBid,
  maxAuctionBid,
  chooseBotShareCell,
  chooseBotDeal,
  HUMAN_DEAL_COOLDOWN_MS,
  BOT_BOT_DEAL_COOLDOWN_MS,
  mortgageCandidates,
  shareSellCandidates,
  shouldAcceptDeal,
} from '../js/bot-strategy.js';

/** Пауза между видимыми действиями бота (лог / UI) */
const STEP_MS = 2000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function botSay(game, bot, text) {
  if (!game || !bot || !text) return;
  // Не чаще одного комментария за ~1.2с — меньше спама
  const now = Date.now();
  if (now - (game._lastBotChatAt || 0) < 1200) return;
  game._lastBotChatAt = now;
  game.addLog(`${bot.name}: ${text}`);
}

const BOT_THOUGHTS = {
  roll: [
    'Кидаю кости…',
    'Поехали!',
    'Что там судьба подкинет…',
    'Ход за мной.',
  ],
  buy: [
    (n) => `Беру «${n}» — пригодится.`,
    (n) => `«${n}» в портфель.`,
    (n) => `Покупаю «${n}».`,
  ],
  pass: [
    (n) => `«${n}» дорого — пас.`,
    (n) => `Не сейчас «${n}».`,
    (n) => `Пусть уходит на аукцион.`,
  ],
  rent: [
    'Оплачу и пойду дальше.',
    'Долг погашаю.',
    'Придётся заплатить…',
  ],
  share: [
    (n) => `Акция на «${n}».`,
    (n) => `Усиливаю «${n}».`,
  ],
  auction: [
    (n) => `Ставлю за «${n}».`,
    (n) => `Перебиваю за «${n}».`,
  ],
  jail: [
    'Выхожу из тюрьмы.',
    'Плачу залог — свобода дороже.',
  ],
  think: [
    'Считаю варианты…',
    'Смотрю на поле.',
    'Думаю над ходом.',
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
  // Ответ на входящую сделку (боты сами сделки не предлагают)
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

      // До броска: попробовать выкупить недостающую компанию для страны
      if (!player.inJail && tryBotProposeDeal(game, player)) {
        await pulse(broadcast);
        onDone();
        return;
      }

      // Порядок: бросок → клетка → покупка/аренда → акция (после хода)
      if (player.inJail && player.money >= 50_000 && Math.random() > 0.55) {
        botSay(game, player, pick(BOT_THOUGHTS.jail));
        game.payJailBail();
        await pulse(broadcast);
      }
      if (Math.random() < 0.55) botSay(game, player, pick(BOT_THOUGHTS.roll));
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
      botSay(game, player, 'Денег мало — заложу что-нибудь…');
      game.autoRaiseCash?.(player, price);
      await pulse(broadcast);
    }
    if (player.money >= price && shouldBotBuy(game, player, cell, price)) {
      botSay(game, player, pick(BOT_THOUGHTS.buy)(cell?.name || 'компанию'));
      game.buyProperty();
    } else if (player.money >= price && Math.random() < 0.35) {
      botSay(game, player, pick(BOT_THOUGHTS.buy)(cell?.name || 'компанию'));
      game.buyProperty();
    } else {
      botSay(game, player, pick(BOT_THOUGHTS.pass)(cell?.name || 'это'));
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
    if (Math.random() < 0.7) botSay(game, player, pick(BOT_THOUGHTS.rent));
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

/** Боты: ставки; выход только если цена выше потолка (не из‑за «не хочу в этот тик»). */
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
    // Случайный порядок — кто первый перебьёт
    for (let i = contenders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [contenders[i], contenders[j]] = [contenders[j], contenders[i]];
    }
    for (const p of contenders) {
      if (game.placeAuctionBid(p.id)) {
        botSay(game, p, pick(BOT_THOUGHTS.auction)(cell?.name || 'лот'));
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }
  if (game.phase !== PHASE.AUCTION) return;

  const ask = game.nextAuctionPrice();
  for (const p of game.activePlayers) {
    if (!p.isBot) continue;
    if (!game.canPlayerAuctionBid?.(p.id)) continue;
    if (game.auction.highBidder === p.id) continue;
    const cap = maxAuctionBid(game, p, cell);
    // Выходим только когда дальше не потянем — иначе остаёмся на следующий раунд
    if (p.money < ask || ask > cap) {
      game.leaveAuction(p.id);
      if (game.phase !== PHASE.AUCTION) return;
    }
  }
}

export function tryBotBuyShare(game) {
  const player = game.currentPlayer;
  if (!player?.isBot || player.bankrupt) return false;
  if (player.inJail) return false;
  const cellId = chooseBotShareCell(game, player);
  if (cellId == null) return false;
  const cell = getCell(cellId);
  const ok = game.buildHouse(cellId);
  if (ok) botSay(game, player, pick(BOT_THOUGHTS.share)(cell?.name || 'компанию'));
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
    game.acceptDeal(to.id);
  } else {
    game.rejectDeal(to.id);
  }
}

/** Предложить сделку за недостающую клетку страны (бот↔бот или бот→игрок). */
function tryBotProposeDeal(game, bot) {
  if (!game.canOfferDeal?.(bot.id)) return false;
  // Чаще просто ходим — сделки не должны стопорить партию
  if (Math.random() > 0.28) return false;

  const now = Date.now();
  const humanCooldownOk = now - (game.lastBotDealToHumanAt || 0) >= HUMAN_DEAL_COOLDOWN_MS;
  const botBotCooldownOk = now - (game.lastBotBotDealAt || 0) >= BOT_BOT_DEAL_COOLDOWN_MS;
  if (!humanCooldownOk && !botBotCooldownOk) return false;

  const deal = chooseBotDeal(game, bot, { humanCooldownOk, botBotCooldownOk });
  if (!deal) return false;

  const { _targetIsHuman, _cellName, _chat, fromId, ...payload } = deal;

  // Бот↔бот: только если цель точно примет (без спама отказов)
  if (!_targetIsHuman) {
    const target = game.players[payload.toId];
    if (!target || !shouldAcceptDeal(game, target, { ...payload, fromId: bot.id })) {
      return false;
    }
  }

  if (!game.proposeDeal(bot.id, payload)) return false;

  if (_chat) game.addLog(`${bot.name}: ${_chat}`);
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

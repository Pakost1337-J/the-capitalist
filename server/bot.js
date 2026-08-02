import { PHASE } from '../js/game.js';
import { getCell } from '../js/config.js';
import {
  shouldBotBuy,
  shouldBotBid,
  chooseBotShareCell,
  mortgageCandidates,
  shareSellCandidates,
  shouldAcceptDeal,
} from '../js/bot-strategy.js';

export function runBotTurn(game, onDone) {
  // Ответ на входящую сделку (боты сами сделки не предлагают)
  if (game.deal) {
    const to = game.players[game.deal.toId];
    if (to?.isBot && !to.bankrupt) {
      setTimeout(() => {
        settleBotDeal(game);
        onDone();
      }, 900);
      return;
    }
  }

  const player = game.currentPlayer;
  if (!player?.isBot || player.bankrupt || game.phase === PHASE.GAME_OVER) {
    onDone();
    return;
  }

  setTimeout(() => {
    if (game.phase === PHASE.ROLL) {
      if (game.deal || game.dealUiOpen || game.shareUiOpen) {
        onDone();
        return;
      }
      // Перед броском — одна акция, если выгодно и есть запас кэша
      tryBotBuyShare(game);
      if (player.inJail && player.money >= 50_000 && Math.random() > 0.55) {
        game.payJailBail();
      }
      game.rollDice();
      handleAfterRoll(game, onDone);
    } else if (game.phase === PHASE.AUCTION) {
      tryBotAuctionBid(game);
      onDone();
    } else if (
      game.phase === PHASE.ACTION
      && ['rent', 'tax', 'force'].includes(game.pendingAction?.type)
    ) {
      settleBotRent(game);
      finishBotTurn(game, onDone);
    } else if (game.phase === PHASE.END) {
      game.endTurn();
      onDone();
    } else {
      onDone();
    }
  }, 1100);
}

function handleAfterRoll(game, onDone) {
  const steps = (game.dice?.[0] || 0) + (game.dice?.[1] || 0);
  const animWait = 2800 + Math.min(steps, 12) * 240;

  setTimeout(() => {
    if (game.phase === PHASE.ACTION && game.pendingAction?.type === 'buy') {
      const { cellId, price } = game.pendingAction;
      const player = game.currentPlayer;
      const cell = getCell(cellId);

      if (shouldBotBuy(game, player, cell, price)) {
        game.buyProperty();
      } else {
        game.passProperty();
      }

      setTimeout(() => {
        if (game.phase === PHASE.AUCTION) {
          tryBotAuctionBid(game);
        }
        finishBotTurn(game, onDone);
      }, 900);
    } else if (
      game.phase === PHASE.ACTION
      && ['rent', 'tax', 'force'].includes(game.pendingAction?.type)
    ) {
      settleBotRent(game);
      setTimeout(() => finishBotTurn(game, onDone), 700);
    } else if (game.phase === PHASE.AUCTION) {
      tryBotAuctionBid(game);
      onDone();
    } else if (game.phase === PHASE.END) {
      game.endTurn();
      onDone();
    } else if (game.phase === PHASE.GAME_OVER) {
      onDone();
    } else {
      finishBotTurn(game, onDone);
    }
  }, animWait);
}

function tryBotAuctionBid(game) {
  if (game.phase !== PHASE.AUCTION || !game.auction) return;
  const next = game.nextAuctionPrice();
  const cell = getCell(game.auction.cellId);

  for (const p of game.activePlayers) {
    if (!p.isBot) continue;
    if (!game.canPlayerAuctionBid?.(p.id)) continue;
    if (game.auction.highBidder === p.id) continue;
    if (p.money < next) continue;
    if (shouldBotBid(game, p, cell, next)) {
      game.placeAuctionBid(p.id);
      break;
    }
  }
}

export function tryBotBuyShare(game) {
  const player = game.currentPlayer;
  if (!player?.isBot || player.bankrupt) return false;
  const cellId = chooseBotShareCell(game, player);
  if (cellId == null) return false;
  return game.buildHouse(cellId);
}

function settleBotRent(game) {
  const pa = game.pendingAction;
  if (!pa || !['rent', 'tax', 'force'].includes(pa.type)) return;
  const player = game.currentPlayer;
  let guard = 0;

  while (player.money < pa.amount && guard < 20) {
    // Сначала залог «мусора», акции/монополии — позже
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

function finishBotTurn(game, onDone) {
  if (
    game.phase === PHASE.ACTION
    && ['rent', 'tax', 'force'].includes(game.pendingAction?.type)
  ) {
    settleBotRent(game);
  }
  if (game.phase === PHASE.END) {
    game.endTurn();
  }
  setTimeout(onDone, 400);
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
        });
        return;
      }
      game._botRunning = false;
      return;
    }

    if (game.phase === PHASE.AUCTION) {
      tryBotAuctionBid(game);
      broadcast();
      game._botRunning = false;
      setTimeout(() => {
        if (game.phase === PHASE.AUCTION) {
          processBotChain(game, broadcast);
        }
      }, 4500);
      return;
    }

    const p = game.currentPlayer;
    if (p.isBot && !p.bankrupt) {
      runBotTurn(game, () => {
        broadcast();
        tick();
      });
    } else {
      game._botRunning = false;
    }
  }

  tick();
}

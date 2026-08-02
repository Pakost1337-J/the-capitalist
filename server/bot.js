import { PHASE } from '../js/game.js';
import { getCell } from '../js/config.js';

export function runBotTurn(game, onDone) {
  // Ответ бота на входящую сделку (даже не в свой ход)
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
  // Ждём полный бросок 3D (~2.5s) + ход фишки, иначе клиент пропускает анимацию ботов
  const animWait = 2800 + Math.min(steps, 12) * 240;

  setTimeout(() => {
    if (game.phase === PHASE.ACTION && game.pendingAction?.type === 'buy') {
      const { cellId, price } = game.pendingAction;
      const player = game.currentPlayer;
      const cell = getCell(cellId);

      if (shouldBotBuy(player, cell, price, game)) {
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
    if (shouldBotBid(p, cell, next, game) && Math.random() > 0.4) {
      game.placeAuctionBid(p.id);
      break;
    }
  }
}

function shouldBotBid(player, cell, price, game) {
  if (player.money < price + 80_000) return false;
  if (cell?.type === 'property') {
    const ownedInGroup = Object.entries(game.propertyState)
      .filter(([id, ps]) => {
        const c = getCell(Number(id));
        return c.group === cell.group && ps.owner === player.id;
      }).length;
    if (ownedInGroup > 0) return true;
  }
  return player.money > price * 1.5 && Math.random() > 0.5;
}

function settleBotRent(game) {
  const pa = game.pendingAction;
  if (!pa || !['rent', 'tax', 'force'].includes(pa.type)) return;
  const player = game.currentPlayer;
  let guard = 0;
  while (player.money < pa.amount && guard < 16) {
    const shareProp = player.properties.find(id => {
      const ps = game.propertyState[id];
      const cell = getCell(id);
      return ps && !ps.mortgaged && (ps.houses || 0) > 0 && cell?.houseCost;
    });
    if (shareProp != null) {
      game.sellShare(shareProp);
      guard += 1;
      continue;
    }
    const prop = player.properties.find(id => {
      const ps = game.propertyState[id];
      return ps && !ps.mortgaged && (ps.houses || 0) === 0;
    });
    if (prop == null) break;
    game.mortgageProperty(prop);
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
  // endTurn уже вызывается из afterAction / advanceAfterTurnActions
  if (game.phase === PHASE.END) {
    game.endTurn();
  }
  setTimeout(onDone, 400);
}

function shouldBotBuy(player, cell, price, game) {
  if (player.money < price) return false;
  if (player.money < price * 1.2 && cell.type === 'property') return false;

  if (cell.type === 'property') {
    const ownedInGroup = Object.entries(game.propertyState)
      .filter(([id, ps]) => {
        const c = getCell(Number(id));
        return c.group === cell.group && ps.owner === player.id;
      }).length;
    if (ownedInGroup > 0) return true;
    if (player.properties.length < 2) return player.money > price + 200;
  }

  return player.money > price + 300 && Math.random() > 0.35;
}

function settleBotDeal(game) {
  const d = game.deal;
  if (!d) return;
  const to = game.players[d.toId];
  if (!to?.isBot) return;

  let offerMoney = Math.max(0, Number(d.offerMoney) || 0);
  let askMoney = Math.max(0, Number(d.askMoney) || 0);
  let offerCells = [...(d.offerCells || [])];
  let askCells = [...(d.askCells || [])];
  if (d.cellId != null && !askCells.length) {
    askCells = [d.cellId];
    if (!offerMoney && d.price != null) offerMoney = Number(d.price) || 0;
  }

  const giveValue = offerMoney + offerCells.reduce((s, id) => s + (getCell(id)?.price || 0), 0);
  const takeValue = askMoney + askCells.reduce((s, id) => s + (getCell(id)?.price || 0), 0);
  // Платёж по нетто: бот платит только если ask > offer
  const netPay = Math.max(0, askMoney - offerMoney);
  const okMoney = to.money >= netPay;
  const fair = takeValue <= 0 || giveValue >= takeValue * 0.75;
  if (okMoney && fair && Math.random() > 0.3) {
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
      // не блокируем аукцион вечным циклом — ставки ботов по таймеру
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

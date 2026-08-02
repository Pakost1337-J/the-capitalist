import { PHASE } from '../js/game.js';
import { getCell } from '../js/config.js';

export function runBotTurn(game, onDone) {
  const player = game.currentPlayer;
  if (!player?.isBot || player.bankrupt || game.phase === PHASE.GAME_OVER) {
    onDone();
    return;
  }

  setTimeout(() => {
    if (game.phase === PHASE.ROLL) {
      if (player.inJail && player.money >= 50_000 && Math.random() > 0.55) {
        game.payJailBail();
      }
      game.rollDice();
      handleAfterRoll(game, onDone);
    } else if (game.phase === PHASE.AUCTION) {
      tryBotAuctionBid(game);
      onDone();
    } else if (game.phase === PHASE.ACTION && game.pendingAction?.type === 'rent') {
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
  const animWait = 1100 + Math.min(steps, 12) * 190;

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
    } else if (game.phase === PHASE.ACTION && game.pendingAction?.type === 'rent') {
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
  if (!pa || pa.type !== 'rent') return;
  const player = game.currentPlayer;
  let guard = 0;
  while (player.money < pa.amount && guard < 12) {
    const prop = player.properties.find(id => {
      const ps = game.propertyState[id];
      return ps && !ps.mortgaged && (ps.houses || 0) === 0;
    });
    if (prop == null) break;
    game.mortgageProperty(prop);
    guard += 1;
  }
  game.payRentDebt();
}

function finishBotTurn(game, onDone) {
  if (game.phase === PHASE.ACTION && game.pendingAction?.type === 'rent') {
    settleBotRent(game);
  }
  if (game.phase === PHASE.END) {
    setTimeout(() => {
      game.endTurn();
      onDone();
    }, 500);
  } else {
    onDone();
  }
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

export function processBotChain(game, broadcast) {
  if (game._botRunning) return;
  game._botRunning = true;

  function tick() {
    if (game.phase === PHASE.GAME_OVER) {
      game._botRunning = false;
      broadcast();
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

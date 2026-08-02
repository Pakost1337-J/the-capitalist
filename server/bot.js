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
      game.rollDice();
      handleAfterRoll(game, onDone);
    } else if (game.phase === PHASE.END) {
      game.endTurn();
      onDone();
    } else {
      onDone();
    }
  }, 1200);
}

function handleAfterRoll(game, onDone) {
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

      setTimeout(() => finishBotTurn(game, onDone), 800);
    } else if (game.phase === PHASE.END) {
      game.endTurn();
      onDone();
    } else if (game.phase === PHASE.GAME_OVER) {
      onDone();
    } else {
      finishBotTurn(game, onDone);
    }
  }, 600);
}

function finishBotTurn(game, onDone) {
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

  if (cell.type === 'railroad') {
    const rr = player.properties.filter(id => getCell(id).type === 'railroad').length;
    if (rr > 0) return true;
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

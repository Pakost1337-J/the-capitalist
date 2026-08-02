import {
  BOARD, BOARD_SIZE, CHANCE_CARDS, FORCE_MAJEURE_CARDS, START_MONEY, GO_SALARY, JAIL_BAIL, JAIL_POS,
  MAX_HOUSES, PLAYER_SLOTS, AUCTION_STEP, AUCTION_MS, getCell, getGroupProperties,
} from './config.js';
import { shuffle } from './utils.js';
import {
  logBuy, logJail, logMoneyGain, logMoneyLoss, logPassStart,
  logRent, logTax, logBuild,
} from './flavor.js';

export const PHASE = {
  ROLL: 'roll',
  MOVING: 'moving',
  ACTION: 'action',
  AUCTION: 'auction',
  BUILD: 'build',
  END: 'end',
  GAME_OVER: 'game_over',
};

function createPlayer(slot, name, socketId, isBot) {
  const cfg = PLAYER_SLOTS[slot];
  return {
    id: slot,
    name,
    color: cfg.color,
    colorSoft: cfg.colorSoft || cfg.color,
    chipName: cfg.name || `Фишка ${slot + 1}`,
    token: cfg.token,
    tokenImage: cfg.tokenImage || '',
    tokenBoardImage: cfg.tokenBoardImage || '',
    socketId,
    isBot,
    money: START_MONEY,
    position: 0,
    inJail: false,
    jailTurns: 0,
    bankrupt: false,
    properties: [],
  };
}

export function createGame(playerConfigs) {
  const engine = new GameEngine();
  engine.players = playerConfigs.map((p, i) =>
    createPlayer(i, p.name, p.socketId || null, p.isBot ?? false)
  );
  return engine;
}

export class GameEngine {
  constructor() {
    this.players = [];
    this.currentPlayerIndex = 0;
    this.phase = PHASE.ROLL;
    this.dice = [1, 1];
    this.doubles = false;
    this.chanceDeck = shuffle(CHANCE_CARDS.map((_, i) => i));
    this.chanceIndex = 0;
    this.forceDeck = shuffle(FORCE_MAJEURE_CARDS.map((_, i) => i));
    this.forceIndex = 0;
    this.log = [];
    this.winner = null;
    this.pendingAction = null;
    this.auction = null;
    this.housesBuilt = 0;
    this.maxHouses = 32;

    this.propertyState = {};
    for (const cell of BOARD) {
      if (['property', 'railroad', 'utility'].includes(cell.type)) {
        this.propertyState[cell.id] = { owner: null, houses: 0, mortgaged: false };
      }
    }
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  get activePlayers() {
    return this.players.filter(p => !p.bankrupt);
  }

  getState() {
    return {
      players: this.players.map(p => ({ ...p })),
      currentPlayerIndex: this.currentPlayerIndex,
      phase: this.phase,
      dice: [...this.dice],
      doubles: this.doubles,
      log: [...this.log],
      winner: this.winner,
      pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
      auction: this.auction ? { ...this.auction } : null,
      propertyState: JSON.parse(JSON.stringify(this.propertyState)),
      housesBuilt: this.housesBuilt,
    };
  }

  nextAuctionPrice() {
    if (!this.auction) return 0;
    if (this.auction.highBidder == null) return this.auction.startPrice;
    return this.auction.currentBid + AUCTION_STEP;
  }

  addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 50) this.log.pop();
  }

  getPropertyOwner(cellId) {
    const ps = this.propertyState[cellId];
    if (!ps || ps.owner === null) return null;
    return this.players[ps.owner];
  }

  ownsGroup(playerId, group) {
    const props = getGroupProperties(group);
    return props.every(p => this.propertyState[p.id]?.owner === playerId && !this.propertyState[p.id]?.mortgaged);
  }

  countRailroads(playerId) {
    return BOARD.filter(c => c.type === 'railroad' && this.propertyState[c.id]?.owner === playerId).length;
  }

  countUtilities(playerId) {
    return BOARD.filter(c => c.type === 'utility' && this.propertyState[c.id]?.owner === playerId).length;
  }

  calcRent(cellId) {
    const cell = getCell(cellId);
    const ps = this.propertyState[cellId];
    if (!ps || ps.owner === null || ps.mortgaged) return 0;

    if (cell.type === 'property') {
      const hasMonopoly = this.ownsGroup(ps.owner, cell.group);
      if (ps.houses > 0) return cell.rent[ps.houses];
      return hasMonopoly ? cell.rent[0] * 2 : cell.rent[0];
    }

    if (cell.type === 'railroad') {
      const count = this.countRailroads(ps.owner);
      return cell.rent[count - 1] || cell.rent[0];
    }

    if (cell.type === 'utility') {
      const count = this.countUtilities(ps.owner);
      const mult = count >= 2 ? 10 : 4;
      return (this.dice[0] + this.dice[1]) * mult;
    }

    return 0;
  }

  transferMoney(from, to, amount) {
    from.money -= amount;
    to.money += amount;
  }

  canAfford(player, amount) {
    return player.money >= amount;
  }

  isOnlinePlayer(player) {
    return !player.isBot && player.socketId;
  }

  rollDice() {
    if (this.phase !== PHASE.ROLL) return false;
    const p = this.currentPlayer;
    if (p.bankrupt) return false;

    this.dice = [rand(), rand()];
    this.doubles = this.dice[0] === this.dice[1];
    this.addLog(`${p.name} бросает ${this.dice[0]}:${this.dice[1]}`);

    if (p.inJail) {
      if (this.doubles) {
        p.inJail = false;
        p.jailTurns = 0;
        this.addLog(`${p.name} выбросил дубль и выходит из тюрьмы!`);
        this.movePlayer(this.dice[0] + this.dice[1]);
      } else {
        p.jailTurns++;
        if (p.jailTurns >= 3) {
          p.money -= JAIL_BAIL;
          p.inJail = false;
          p.jailTurns = 0;
          this.addLog(`${p.name} платит $${JAIL_BAIL} и выходит из тюрьмы`);
          this.movePlayer(this.dice[0] + this.dice[1]);
        } else {
          this.addLog(`${p.name} остаётся в тюрьме (${p.jailTurns}/3)`);
          this.phase = PHASE.END;
        }
      }
    } else {
      this.movePlayer(this.dice[0] + this.dice[1]);
    }

    return true;
  }

  movePlayer(steps) {
    const p = this.currentPlayer;
    const oldPos = p.position;
    p.position = (p.position + steps) % BOARD_SIZE;

    if (p.position < oldPos || (oldPos + steps >= BOARD_SIZE)) {
      p.money += GO_SALARY;
      this.addLog(logPassStart(p.name, GO_SALARY));
    }

    this.phase = PHASE.MOVING;
    this.landOnCell();
  }

  landOnCell() {
    const p = this.currentPlayer;
    const cell = getCell(p.position);

    switch (cell.type) {
      case 'go':
      case 'parking':
      case 'jail':
        this.afterAction();
        break;
      case 'property':
      case 'railroad':
      case 'utility':
        this.handleProperty(cell);
        break;
      case 'chance':
        this.drawChance();
        break;
      case 'forcemajeure':
        this.drawForceMajeure();
        break;
      case 'tax':
        this.payTax(cell.taxPercent || 6);
        break;
      case 'gotojail':
        this.sendToJail();
        break;
    }
  }

  handleProperty(cell) {
    const ps = this.propertyState[cell.id];
    const p = this.currentPlayer;

    if (ps.owner === null) {
      if (this.canAfford(p, cell.price)) {
        this.pendingAction = { type: 'buy', cellId: cell.id, price: cell.price };
        this.phase = PHASE.ACTION;
      } else {
        this.addLog(`${p.name} не хватает денег на «${cell.name}» — аукцион!`);
        this.startAuction(cell.id);
      }
    } else if (ps.owner !== p.id && !ps.mortgaged) {
      const rent = this.calcRent(cell.id);
      const owner = this.players[ps.owner];
      this.payPlayer(p, owner, rent, cell.name);
      this.afterAction();
    } else {
      this.afterAction();
    }
  }

  startAuction(cellId) {
    const cell = getCell(cellId);
    if (!cell || this.propertyState[cellId]?.owner != null) return false;
    this.pendingAction = null;
    this.phase = PHASE.AUCTION;
    this.auction = {
      cellId,
      startPrice: cell.price,
      currentBid: 0,
      highBidder: null,
      step: AUCTION_STEP,
      endsAt: Date.now() + AUCTION_MS,
      startedBy: this.currentPlayer.id,
    };
    this.addLog(`Аукцион: «${cell.name}» от ${cell.price.toLocaleString('ru-RU')}$, шаг $${AUCTION_STEP.toLocaleString('ru-RU')}, 1 мин`);
    return true;
  }

  placeAuctionBid(playerId) {
    if (this.phase !== PHASE.AUCTION || !this.auction) return false;
    const p = this.players[playerId];
    if (!p || p.bankrupt) return false;
    const next = this.nextAuctionPrice();
    if (p.money < next) return false;
    if (this.auction.highBidder === playerId) return false;

    this.auction.currentBid = next;
    this.auction.highBidder = playerId;
    this.addLog(`${p.name} ставит $${next.toLocaleString('ru-RU')} за «${getCell(this.auction.cellId).name}»`);
    return true;
  }

  finishAuction() {
    if (!this.auction) return;
    const { cellId, currentBid, highBidder } = this.auction;
    const cell = getCell(cellId);
    this.auction = null;

    if (highBidder != null && currentBid > 0) {
      const winner = this.players[highBidder];
      if (winner && !winner.bankrupt && winner.money >= currentBid) {
        winner.money -= currentBid;
        winner.properties.push(cellId);
        this.propertyState[cellId].owner = winner.id;
        this.addLog(logBuy(winner.name, cell.name));
        this.addLog(`Аукцион закрыт: $${currentBid.toLocaleString('ru-RU')}`);
      } else {
        this.addLog(`Аукцион сорвался — «${cell.name}» без владельца`);
      }
    } else {
      this.addLog(`Аукцион окончен: на «${cell.name}» никто не поставил`);
    }

    this.afterAction();
  }

  payPlayer(from, to, amount, company) {
    if (amount <= 0) return;
    if (from.money >= amount) {
      this.transferMoney(from, to, amount);
      this.addLog(logRent(from.name, to.name, amount, company || 'компанию'));
    } else {
      this.handleBankruptcy(from, to, amount);
    }
  }

  calcCapital(player) {
    let capital = player.money;
    for (const id of player.properties || []) {
      const cell = getCell(id);
      const ps = this.propertyState[id];
      capital += cell?.price || 0;
      if (cell?.houseCost && ps) capital += (ps.houses || 0) * cell.houseCost;
    }
    return capital;
  }

  /** Налог 6% от всего капитала (правила Monopoly Club) */
  payTax(percent = 6) {
    const p = this.currentPlayer;
    const amount = Math.max(0, Math.round(this.calcCapital(p) * (percent / 100)));
    if (p.money >= amount) {
      p.money -= amount;
      this.addLog(logTax(p.name, amount));
      this.afterAction();
    } else {
      this.handleBankruptcy(p, null, amount);
    }
  }

  sendToJail() {
    const p = this.currentPlayer;
    p.position = JAIL_POS;
    p.inJail = true;
    p.jailTurns = 0;
    this.addLog(logJail(p.name));
    this.phase = PHASE.END;
  }

  drawChance() {
    const cardIdx = this.chanceDeck[this.chanceIndex % this.chanceDeck.length];
    this.chanceIndex++;
    const card = CHANCE_CARDS[cardIdx];
    this.applyChanceCard(card, 'chance');
  }

  drawForceMajeure() {
    const cardIdx = this.forceDeck[this.forceIndex % this.forceDeck.length];
    this.forceIndex++;
    const card = FORCE_MAJEURE_CARDS[cardIdx];
    this.applyChanceCard(card, 'force');
  }

  applyChanceCard(card, kind = 'chance') {
    const p = this.currentPlayer;

    if (card.money) {
      if (card.money > 0) {
        p.money += card.money;
        this.addLog(logMoneyGain(p.name, card.money));
      } else if (p.money >= Math.abs(card.money)) {
        p.money += card.money;
        this.addLog(logMoneyLoss(p.name, Math.abs(card.money)));
      } else {
        this.handleBankruptcy(p, null, Math.abs(card.money));
        return;
      }
      this.afterAction();
    } else if (card.birthday) {
      this.addLog(`${p.name}: день рождения — все скидываются по $${card.birthday.toLocaleString('ru-RU')}`);
      for (const other of this.activePlayers) {
        if (other.id !== p.id) {
          const amt = Math.min(card.birthday, other.money);
          this.transferMoney(other, p, amt);
        }
      }
      this.afterAction();
    } else if (card.goToStart) {
      p.position = 0;
      p.money += GO_SALARY;
      this.addLog(`${p.name} телепортируется на Старт (+$${GO_SALARY.toLocaleString('ru-RU')})`);
      this.afterAction();
    } else if (card.goToJail) {
      this.sendToJail();
    } else if (card.goTo !== undefined) {
      p.position = card.goTo;
      this.addLog(`${p.name} переходит на «${getCell(card.goTo)?.name || 'поле'}»`);
      this.afterAction();
    } else if (card.moveBack) {
      this.addLog(`${p.name} отступает на ${card.moveBack} клетки`);
      p.position = (p.position - card.moveBack + BOARD_SIZE) % BOARD_SIZE;
      this.landOnCell();
    } else if (card.repairPerHouse) {
      let total = 0;
      for (const pid of p.properties) {
        total += this.propertyState[pid].houses * card.repairPerHouse;
      }
      if (p.money >= total) {
        p.money -= total;
        this.addLog(`${p.name} чинит филиалы на $${total.toLocaleString('ru-RU')}`);
      } else {
        this.handleBankruptcy(p, null, total);
        return;
      }
      this.afterAction();
    } else {
      this.addLog(card.text || `${p.name}: сюрприз на поле`);
      this.afterAction();
    }
  }

  buyProperty() {
    if (this.pendingAction?.type !== 'buy') return false;
    const { cellId, price } = this.pendingAction;
    const p = this.currentPlayer;
    const cell = getCell(cellId);
    if (!this.canAfford(p, price)) return false;

    p.money -= price;
    p.properties.push(cellId);
    this.propertyState[cellId].owner = p.id;
    this.addLog(logBuy(p.name, cell.name));
    this.pendingAction = null;
    this.afterAction();
    return true;
  }

  passProperty() {
    if (this.pendingAction?.type !== 'buy') return false;
    const cellId = this.pendingAction.cellId;
    const cell = getCell(cellId);
    this.addLog(`${this.currentPlayer.name} выставляет «${cell.name}» на аукцион`);
    this.pendingAction = null;
    return this.startAuction(cellId);
  }


  buildHouse(cellId) {
    const p = this.currentPlayer;
    const cell = getCell(cellId);
    const ps = this.propertyState[cellId];

    if (cell.type !== 'property') return false;
    if (ps.owner !== p.id) return false;
    if (!this.ownsGroup(p.id, cell.group)) return false;
    if (ps.houses >= MAX_HOUSES) return false;
    if (this.housesBuilt >= this.maxHouses) return false;
    if (!this.canAfford(p, cell.houseCost)) return false;

    const group = getGroupProperties(cell.group);
    const minHouses = Math.min(...group.map(g => this.propertyState[g.id].houses));
    if (ps.houses > minHouses) return false;

    p.money -= cell.houseCost;
    ps.houses++;
    this.housesBuilt++;
    this.addLog(logBuild(p.name, cell.name));
    return true;
  }

  getBuildableProperties(playerId) {
    const p = this.players[playerId];
    const result = [];
    for (const cellId of p.properties) {
      const cell = getCell(cellId);
      const ps = this.propertyState[cellId];
      if (cell.type !== 'property') continue;
      if (!this.ownsGroup(playerId, cell.group)) continue;
      if (ps.houses >= MAX_HOUSES) continue;
      if (this.housesBuilt >= this.maxHouses) continue;
      const group = getGroupProperties(cell.group);
      const minHouses = Math.min(...group.map(g => this.propertyState[g.id].houses));
      if (ps.houses <= minHouses && p.money >= cell.houseCost) {
        result.push(cellId);
      }
    }
    return result;
  }

  afterAction() {
    const p = this.currentPlayer;
    const buildable = this.getBuildableProperties(p.id);
    if (buildable.length > 0 && this.isOnlinePlayer(p)) {
      this.phase = PHASE.BUILD;
      this.pendingAction = { type: 'build', options: buildable };
    } else if (buildable.length > 0 && p.isBot) {
      for (const cellId of buildable) {
        if (p.money >= getCell(cellId).houseCost + 150) {
          this.buildHouse(cellId);
        }
      }
      this.phase = PHASE.END;
    } else {
      this.phase = PHASE.END;
    }
  }

  finishBuild() {
    this.pendingAction = null;
    this.phase = PHASE.END;
  }

  endTurn() {
    if (this.phase !== PHASE.END && this.phase !== PHASE.BUILD) return false;

    if (this.activePlayers.length <= 1) {
      this.winner = this.activePlayers[0];
      this.phase = PHASE.GAME_OVER;
      this.addLog(`🏆 ${this.winner.name} побеждает!`);
      return true;
    }

    let next = (this.currentPlayerIndex + 1) % this.players.length;
    while (this.players[next].bankrupt) {
      next = (next + 1) % this.players.length;
    }

    this.currentPlayerIndex = next;
    this.phase = PHASE.ROLL;
    this.doubles = false;
    this.pendingAction = null;
    this.addLog(`— Ход: ${this.currentPlayer.name} —`);
    return true;
  }

  handleBankruptcy(debtor, creditor, amount) {
    this.addLog(`💀 ${debtor.name} обанкротился!`);
    this.liquidatePlayer(debtor, creditor);

    if (this.activePlayers.length <= 1) {
      this.winner = this.activePlayers[0] || creditor;
      this.phase = PHASE.GAME_OVER;
      this.addLog(`🏆 ${this.winner?.name} побеждает!`);
    } else {
      this.phase = PHASE.END;
    }
    this.pendingAction = null;
  }

  liquidatePlayer(player, creditor) {
    for (const pid of [...player.properties]) {
      const cell = getCell(pid);
      const ps = this.propertyState[pid];
      if (creditor && !creditor.bankrupt) {
        creditor.properties.push(pid);
        this.propertyState[pid].owner = creditor.id;
        this.addLog(`${cell.name} → ${creditor.name}`);
      } else {
        this.propertyState[pid].owner = null;
        this.propertyState[pid].houses = 0;
      }
      ps.mortgaged = false;
    }
    if (creditor && !creditor.bankrupt) {
      creditor.money += Math.max(0, player.money);
    }
    player.properties = [];
    player.money = 0;
    player.bankrupt = true;
  }

  payJailBail() {
    const p = this.currentPlayer;
    if (!p.inJail || !this.canAfford(p, JAIL_BAIL)) return false;
    p.money -= JAIL_BAIL;
    p.inJail = false;
    p.jailTurns = 0;
    this.addLog(`${p.name} платит залог $${JAIL_BAIL}`);
    return true;
  }

  applyAction(action, playerId) {
    if (action.type === 'auctionBid') {
      if (!this.placeAuctionBid(playerId)) return { ok: false, error: 'Нельзя сделать ставку' };
      return { ok: true, auction: true };
    }
    if (action.type === 'auctionEnd') {
      if (this.phase !== PHASE.AUCTION) return { ok: false, error: 'Нет аукциона' };
      this.finishAuction();
      return { ok: true };
    }

    if (this.currentPlayer.id !== playerId) return { ok: false, error: 'Не ваш ход' };

    switch (action.type) {
      case 'roll':
        if (this.phase !== PHASE.ROLL) return { ok: false, error: 'Сейчас нельзя бросать' };
        this.rollDice();
        return { ok: true };

      case 'buy':
        if (!this.buyProperty()) return { ok: false, error: 'Нельзя купить' };
        return { ok: true };

      case 'pass':
        if (!this.passProperty()) return { ok: false, error: 'Нельзя начать аукцион' };
        return { ok: true, auction: true };

      case 'build':
        if (!this.buildHouse(action.cellId)) return { ok: false, error: 'Нельзя построить' };
        return { ok: true };

      case 'finishBuild':
        if (this.phase !== PHASE.BUILD) return { ok: false, error: 'Не фаза строительства' };
        this.finishBuild();
        return { ok: true };

      case 'endTurn':
        if (this.phase !== PHASE.END && this.phase !== PHASE.BUILD) return { ok: false, error: 'Нельзя завершить ход' };
        this.endTurn();
        return { ok: true };

      case 'payJailBail':
        if (!this.payJailBail()) return { ok: false, error: 'Нельзя заплатить залог' };
        return { ok: true };

      default:
        return { ok: false, error: 'Неизвестное действие' };
    }
  }
}

function rand() {
  return Math.floor(Math.random() * 6) + 1;
}

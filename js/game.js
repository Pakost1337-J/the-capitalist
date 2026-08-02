import {
  BOARD, BOARD_SIZE, CHANCE_CARDS, FORCE_MAJEURE_CARDS, START_MONEY, GO_SALARY, JAIL_BAIL, JAIL_POS,
  MAX_HOUSES, PLAYER_SLOTS, AUCTION_STEP, AUCTION_MS, RENT_MS, TURN_MS, DEAL_MS, NO_SHARE_GROUPS,
  getCell, getGroupProperties,
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
  const color = cfg.color;
  return {
    id: slot,
    name,
    color,
    colorSoft: cfg.colorSoft || color,
    ownTop: cfg.ownTop || color,
    ownRight: cfg.ownRight || color,
    ownBottom: cfg.ownBottom || color,
    ownLeft: cfg.ownLeft || color,
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
    this.rollSeq = 0;
    /** Предыдущий бросок этого хода был дублем — подряд второй дубль запрещён */
    this._lastRollDoubles = false;
    this.chanceDeck = shuffle(CHANCE_CARDS.map((_, i) => i));
    this.chanceIndex = 0;
    this.forceDeck = shuffle(FORCE_MAJEURE_CARDS.map((_, i) => i));
    this.forceIndex = 0;
    this.log = [];
    this.winner = null;
    this.pendingAction = null;
    this.auction = null;
    this.deal = null;
    this.dealUiOpen = false;
    this.shareUiOpen = false;
    this.turnEndsAt = null;
    this._turnLeftMs = null;
    this.notice = null;
    this.housesBuilt = 0;
    this.maxHouses = 32;
    /** За один ход — не больше одной акции (одной страны) */
    this.sharesBoughtThisTurn = 0;
    this.maxSharesPerTurn = 1;

    this.propertyState = {};
    for (const cell of BOARD) {
      if (['property', 'railroad', 'utility'].includes(cell.type)) {
        this.propertyState[cell.id] = { owner: null, houses: 0, mortgaged: false };
      }
    }

    this.beginTurnTimer();
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
      rollSeq: this.rollSeq,
      log: [...this.log],
      winner: this.winner,
      pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
      auction: this.auction ? { ...this.auction } : null,
      deal: this.deal ? { ...this.deal } : null,
      turnEndsAt: this.turnEndsAt,
      /** Остаток хода на паузе (сделка / акции) — для UI, не тикает */
      turnPauseLeftMs: this.turnEndsAt == null && this._turnLeftMs != null
        ? this._turnLeftMs
        : null,
      canDeal: this.canOfferDeal(this.currentPlayer?.id),
      dealUiOpen: !!this.dealUiOpen,
      canBuyShares: this.canBuyShares(this.currentPlayer?.id),
      shareUiOpen: !!this.shareUiOpen,
      shareBuyOptions: this.getShareBuyOptions(this.currentPlayer?.id),
      sharesBoughtThisTurn: this.sharesBoughtThisTurn,
      notice: this.notice ? { ...this.notice } : null,
      propertyState: JSON.parse(JSON.stringify(this.propertyState)),
      housesBuilt: this.housesBuilt,
    };
  }

  beginTurnTimer() {
    this.turnEndsAt = Date.now() + TURN_MS;
    this._turnLeftMs = null;
  }

  pauseTurnTimer() {
    // Идемпотентно: повторный pause не затирает сохранённый остаток
    if (this.turnEndsAt != null) {
      this._turnLeftMs = Math.max(0, this.turnEndsAt - Date.now());
      this.turnEndsAt = null;
    }
  }

  resumeTurnTimer() {
    if (this._turnLeftMs != null) {
      const left = this._turnLeftMs;
      this._turnLeftMs = null;
      if (left > 200) this.turnEndsAt = Date.now() + left;
      else this.turnEndsAt = Date.now() + 5_000;
      return;
    }
    if (this.phase === PHASE.ROLL && !this.deal && !this.dealUiOpen && !this.shareUiOpen) {
      this.beginTurnTimer();
    }
  }

  /** Компании владельца, доступные для сделки */
  ownedTradeable(ownerId) {
    const list = [];
    const owner = this.players[ownerId];
    if (!owner || owner.bankrupt) return list;
    for (const cellId of owner.properties || []) {
      const cell = getCell(cellId);
      const ps = this.propertyState[cellId];
      if (!cell || !ps || ps.owner !== ownerId) continue;
      if (!['property', 'railroad', 'utility'].includes(cell.type)) continue;
      if (ps.mortgaged || (ps.houses || 0) > 0) continue;
      list.push({
        cellId: cell.id,
        name: cell.name,
        price: cell.price || 0,
        ownerId,
        ownerName: owner.name,
      });
    }
    return list;
  }

  /** Компании других игроков, доступные для сделки */
  dealableCompanies(buyerId) {
    const list = [];
    for (const p of this.activePlayers) {
      if (p.id === buyerId) continue;
      list.push(...this.ownedTradeable(p.id));
    }
    return list;
  }

  canOfferDeal(playerId) {
    if (playerId == null || this.phase !== PHASE.ROLL || this.deal) return false;
    const p = this.players[playerId];
    if (!p || p.bankrupt || p.id !== this.currentPlayer?.id) return false;
    const others = this.activePlayers.filter(o => o.id !== playerId);
    if (!others.length) return false;
    // Без купленных компаний на поле менять нечего — кнопку сделки не показываем
    return this.ownedTradeable(playerId).length > 0
      || this.dealableCompanies(playerId).length > 0;
  }

  /** Открыть сборку сделки (таймер хода продолжает идти) */
  beginDealUi(playerId) {
    if (this.phase !== PHASE.ROLL || this.deal) return false;
    if (this.currentPlayer?.id !== playerId) return false;
    if (!this.canOfferDeal(playerId)) return false;
    this.dealUiOpen = true;
    return true;
  }

  cancelDealUi(playerId) {
    if (this.currentPlayer?.id !== playerId) return false;
    if (!this.dealUiOpen || this.deal) return false;
    this.dealUiOpen = false;
    return true;
  }

  _normalizeDealCells(ids) {
    const out = [];
    const seen = new Set();
    for (const raw of ids || []) {
      const id = Number(raw);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  _cellsOwnedBy(ids, ownerId) {
    for (const id of ids) {
      const cell = getCell(id);
      const ps = this.propertyState[id];
      if (!cell || !ps || ps.owner !== ownerId) return false;
      if (ps.mortgaged || (ps.houses || 0) > 0) return false;
      if (!['property', 'railroad', 'utility'].includes(cell.type)) return false;
    }
    return true;
  }

  _transferCells(from, to, cellIds) {
    for (const id of cellIds) {
      from.properties = from.properties.filter(x => x !== id);
      if (!to.properties.includes(id)) to.properties.push(id);
      this.propertyState[id].owner = to.id;
    }
  }

  proposeDeal(fromId, raw = {}) {
    if (this.phase !== PHASE.ROLL || this.deal) return false;
    if (this.currentPlayer?.id !== fromId) return false;
    const from = this.players[fromId];
    const to = this.players[raw.toId];
    if (!from || !to || from.bankrupt || to.bankrupt || fromId === to.id) return false;

    // Совместимость со старым форматом { cellId, price }
    let offerMoney = Math.max(0, Math.floor(Number(raw.offerMoney) || 0));
    let askMoney = Math.max(0, Math.floor(Number(raw.askMoney) || 0));
    let offerCells = this._normalizeDealCells(raw.offerCells);
    let askCells = this._normalizeDealCells(raw.askCells);
    if (raw.cellId != null && !askCells.length) {
      askCells = this._normalizeDealCells([raw.cellId]);
      if (!offerMoney && raw.price != null) offerMoney = Math.max(0, Math.floor(Number(raw.price) || 0));
    }

    if (!offerMoney && !askMoney && !offerCells.length && !askCells.length) return false;
    // Пустой обмен равных сумм без компаний — бессмысленно
    if (!offerCells.length && !askCells.length && offerMoney === askMoney) return false;
    // Деньги можно с обеих сторон (обмен деньгами): платёжеспособность по нетто
    const netCash = offerMoney - askMoney;
    if (netCash > 0 && !this.canAfford(from, netCash)) return false;
    if (netCash < 0 && !this.canAfford(to, -netCash)) return false;
    if (!this._cellsOwnedBy(offerCells, fromId)) return false;
    if (!this._cellsOwnedBy(askCells, to.id)) return false;

    this.dealUiOpen = false;
    // Пока ждём ответ на сделку — пауза таймера хода
    this.pauseTurnTimer();
    this.deal = {
      fromId,
      toId: to.id,
      offerMoney,
      askMoney,
      offerCells,
      askCells,
      endsAt: Date.now() + DEAL_MS,
    };

    const parts = [];
    if (offerCells.length) parts.push(offerCells.map(id => `«${getCell(id)?.name}»`).join(', '));
    if (offerMoney) parts.push(`$${offerMoney.toLocaleString('ru-RU')}`);
    const give = parts.length ? parts.join(' + ') : '—';
    const getParts = [];
    if (askCells.length) getParts.push(askCells.map(id => `«${getCell(id)?.name}»`).join(', '));
    if (askMoney) getParts.push(`$${askMoney.toLocaleString('ru-RU')}`);
    const get = getParts.length ? getParts.join(' + ') : '—';
    this.addLog(`${from.name} предлагает ${to.name} сделку: отдаёт ${give}, хочет ${get}`);
    return true;
  }

  acceptDeal(playerId) {
    const d = this.deal;
    if (!d || d.toId !== playerId) return false;
    const from = this.players[d.fromId];
    const to = this.players[d.toId];
    if (!from || !to || from.bankrupt || to.bankrupt) {
      this.clearDeal(true);
      return false;
    }

    const offerMoney = Math.max(0, Math.floor(Number(d.offerMoney) || 0));
    const askMoney = Math.max(0, Math.floor(Number(d.askMoney) || 0));
    const offerCells = this._normalizeDealCells(d.offerCells);
    const askCells = this._normalizeDealCells(d.askCells);

    const netCash = offerMoney - askMoney;
    if (netCash > 0 && !this.canAfford(from, netCash)) {
      this.addLog('Сделка сорвалась: не хватает денег');
      this.clearDeal(true);
      return false;
    }
    if (netCash < 0 && !this.canAfford(to, -netCash)) {
      this.addLog('Сделка сорвалась: не хватает денег');
      this.clearDeal(true);
      return false;
    }
    if (!this._cellsOwnedBy(offerCells, from.id) || !this._cellsOwnedBy(askCells, to.id)) {
      this.addLog('Сделка сорвалась: компания недоступна');
      this.clearDeal(true);
      return false;
    }

    // Нетто по деньгам (можно обменивать деньги на деньги)
    if (netCash > 0) {
      from.money -= netCash;
      to.money += netCash;
    } else if (netCash < 0) {
      to.money -= -netCash;
      from.money += -netCash;
    }
    this._transferCells(from, to, offerCells);
    this._transferCells(to, from, askCells);

    this.addLog(`🤝 Сделка между ${from.name} и ${to.name} заключена`);
    this.clearDeal(true);
    return true;
  }

  rejectDeal(playerId) {
    const d = this.deal;
    if (!d) return false;
    if (playerId !== d.toId && playerId !== d.fromId) return false;
    const from = this.players[d.fromId];
    const to = this.players[d.toId];
    const byOwner = playerId === d.toId;
    this.addLog(
      byOwner
        ? `${to?.name || 'Игрок'} отклоняет сделку`
        : `${from?.name || 'Игрок'} отменяет сделку`
    );
    this.clearDeal(true);
    return true;
  }

  clearDeal(resumeTimer = false) {
    this.deal = null;
    this.dealUiOpen = false;
    if (resumeTimer && this.phase === PHASE.ROLL) this.resumeTurnTimer();
  }

  finishDealTimeout() {
    if (!this.deal) return;
    const to = this.players[this.deal.toId];
    this.addLog(`⏱ Время сделки истекло${to ? ` — ${to.name}` : ''}`);
    this.clearDeal(true);
  }

  finishTurnTimeout() {
    if (this.phase !== PHASE.ROLL || this.deal) return false;
    this.dealUiOpen = false;
    this.shareUiOpen = false;
    this._turnLeftMs = null;
    this.turnEndsAt = null;

    const p = this.currentPlayer;
    if (!p || p.bankrupt) return false;

    // Тюрьма: по таймеру — выкуп; нет денег — банкрот
    if (p.inJail) {
      this.addLog(`⏱ Время хода истекло`);
      if (this.canAfford(p, JAIL_BAIL)) {
        this.payJailBail();
        this.addLog(`⏱ Автовыкуп из тюрьмы — бросок`);
        return this.rollDice();
      }
      this.addLog(`${p.name} не может заплатить залог — банкротство`);
      this.handleBankruptcy(p, null, JAIL_BAIL);
      return true;
    }

    this.addLog(`⏱ Время хода истекло — бросок автоматически`);
    return this.rollDice();
  }

  canBuyShares(playerId) {
    if (playerId == null || this.phase !== PHASE.ROLL || this.deal || this.dealUiOpen) return false;
    const p = this.players[playerId];
    if (!p || p.bankrupt || p.id !== this.currentPlayer?.id) return false;
    return this.getBuildableProperties(playerId).length > 0;
  }

  getShareBuyOptions(playerId) {
    if (playerId == null) return [];
    return this.getBuildableProperties(playerId).map(id => {
      const cell = getCell(id);
      const ps = this.propertyState[id];
      return {
        cellId: id,
        name: cell?.name || '',
        price: cell?.houseCost || 0,
        houses: ps?.houses || 0,
        max: MAX_HOUSES,
      };
    });
  }

  beginShareUi(playerId) {
    if (this.phase !== PHASE.ROLL || this.deal) return false;
    if (this.currentPlayer?.id !== playerId) return false;
    if (!this.getBuildableProperties(playerId).length) return false;
    this.shareUiOpen = true;
    return true;
  }

  cancelShareUi(playerId) {
    if (this.currentPlayer?.id !== playerId) return false;
    if (!this.shareUiOpen || this.deal) return false;
    this.shareUiOpen = false;
    return true;
  }

  /** Есть ли что заложить или продать (акции), чтобы погасить долг */
  canRaiseCash(player) {
    if (!player || player.bankrupt) return false;
    for (const id of player.properties || []) {
      const cell = getCell(id);
      const ps = this.propertyState[id];
      if (!cell || !ps || ps.mortgaged) continue;
      if ((ps.houses || 0) > 0) {
        if (this.allowsShares(cell)) return true;
      } else if (cell.price) {
        return true;
      }
    }
    return false;
  }

  /** Если не хватает наличных и нечего продавать/закладывать — сразу банкрот */
  tryInstantBankruptcy(player, creditor, amount, reason) {
    if (!player || player.bankrupt) return false;
    if (player.money >= amount) return false;
    if (this.canRaiseCash(player)) return false;
    this.addLog(`${player.name}: ${reason} — нечего продать или заложить, банкротство`);
    this.handleBankruptcy(player, creditor, amount);
    return true;
  }

  setOwnNotice(playerName, company) {
    this.notice = {
      type: 'own',
      playerName,
      company,
      id: Date.now(),
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
      // Китай: аренда по числу полей страны у владельца (акций нет)
      if (cell.noShares || NO_SHARE_GROUPS.has(cell.group)) {
        const owned = getGroupProperties(cell.group).filter(c => (
          this.propertyState[c.id]?.owner === ps.owner
          && !this.propertyState[c.id]?.mortgaged
        )).length;
        const idx = Math.max(0, Math.min(owned - 1, (cell.rent?.length || 1) - 1));
        return cell.rent?.[idx] || cell.rent?.[0] || 0;
      }
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
      const diceSum = (this.dice[0] || 0) + (this.dice[1] || 0);
      // Monopoly Club: rent[] уже ×1000 → $25K / $50K за очко кости
      const perPip = cell.rent?.[count >= 2 ? 1 : 0] || 25_000;
      return diceSum * perPip;
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
    if (this.deal) return false;
    const p = this.currentPlayer;
    if (p.bankrupt) return false;

    this.turnEndsAt = null;
    this._turnLeftMs = null;
    this.dealUiOpen = false;
    this.shareUiOpen = false;

    let d1 = rand();
    let d2 = rand();
    // Нельзя выбить дубль два раза подряд в одном ходе
    if (this._lastRollDoubles && d1 === d2) {
      do { d2 = rand(); } while (d2 === d1);
    }
    this.dice = [d1, d2];
    this.doubles = d1 === d2;
    this._lastRollDoubles = this.doubles;
    this.rollSeq += 1;
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
          this.endTurn();
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
        this.startTaxDebt(cell.taxPercent || 6, cell.id);
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
        this.pendingAction = {
          type: 'buy',
          cellId: cell.id,
          price: cell.price,
          endsAt: Date.now() + RENT_MS,
        };
        this.phase = PHASE.ACTION;
      } else {
        this.addLog(`${p.name} не хватает денег на «${cell.name}» — аукцион!`);
        this.startAuction(cell.id);
      }
    } else if (ps.owner !== p.id && !ps.mortgaged) {
      const rent = this.calcRent(cell.id);
      const owner = this.players[ps.owner];
      this.addLog(`${p.name} должен заплатить $${rent.toLocaleString('ru-RU')} за «${cell.name}»`);
      if (this.tryInstantBankruptcy(p, owner, rent, 'долг за чужую клетку')) return;
      this.pendingAction = {
        type: 'rent',
        cellId: cell.id,
        amount: rent,
        ownerId: ps.owner,
        endsAt: Date.now() + RENT_MS,
      };
      this.phase = PHASE.ACTION;
    } else {
      this.afterAction();
    }
  }

  /** Погасить аренду (кнопка или истечение таймера) */
  payRentDebt() {
    const pa = this.pendingAction;
    if (this.phase !== PHASE.ACTION || pa?.type !== 'rent') return false;
    const p = this.currentPlayer;
    const owner = this.players[pa.ownerId];
    const cell = getCell(pa.cellId);
    const amount = pa.amount;
    this.pendingAction = null;
    this.payPlayer(p, owner, amount, cell?.name);
    this.afterAction();
    return true;
  }

  finishRentDebt() {
    const pa = this.pendingAction;
    if (this.phase !== PHASE.ACTION) return;
    if (pa?.type === 'rent') this.payRentDebt();
    else if (pa?.type === 'tax') this.payTaxDebt();
    else if (pa?.type === 'force') this.payCardDebt();
  }

  /** Налог 6% — панель долга с таймером (как аренда) */
  startTaxDebt(percent = 6, cellId = null) {
    const p = this.currentPlayer;
    const amount = Math.max(0, Math.round(this.calcCapital(p) * (percent / 100)));
    this.addLog(`${p.name}: налог ${percent}% — $${amount.toLocaleString('ru-RU')}`);
    if (this.tryInstantBankruptcy(p, null, amount, 'налог')) return;
    this.pendingAction = {
      type: 'tax',
      cellId: cellId ?? p.position,
      amount,
      percent,
      endsAt: Date.now() + RENT_MS,
    };
    this.phase = PHASE.ACTION;
  }

  payTaxDebt() {
    const pa = this.pendingAction;
    if (this.phase !== PHASE.ACTION || pa?.type !== 'tax') return false;
    const p = this.currentPlayer;
    const amount = pa.amount;
    this.pendingAction = null;
    if (p.money >= amount) {
      p.money -= amount;
      this.addLog(logTax(p.name, amount));
      this.afterAction();
    } else {
      this.handleBankruptcy(p, null, amount);
    }
    return true;
  }

  /** Таймер покупки истёк — объявить аукцион */
  finishBuyOffer() {
    if (this.phase !== PHASE.ACTION || this.pendingAction?.type !== 'buy') return;
    this.passProperty();
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
      optedOut: [],
    };
    this.addLog(`Аукцион: «${cell.name}» от ${cell.price.toLocaleString('ru-RU')}$, шаг $${AUCTION_STEP.toLocaleString('ru-RU')}, 1 мин`);
    return true;
  }

  canPlayerAuctionBid(playerId) {
    if (this.phase !== PHASE.AUCTION || !this.auction) return false;
    const p = this.players[playerId];
    if (!p || p.bankrupt) return false;
    // Кто выставил на аукцион — только смотрит
    if (this.auction.startedBy === playerId) return false;
    if ((this.auction.optedOut || []).includes(playerId)) return false;
    return true;
  }

  leaveAuction(playerId) {
    if (this.phase !== PHASE.AUCTION || !this.auction) return false;
    if (this.auction.startedBy === playerId) return false;
    const p = this.players[playerId];
    if (!p || p.bankrupt) return false;
    if (!this.auction.optedOut) this.auction.optedOut = [];
    if (this.auction.optedOut.includes(playerId)) return true;
    this.auction.optedOut.push(playerId);
    if (this.auction.highBidder === playerId) {
      this.auction.highBidder = null;
      this.auction.currentBid = 0;
    }
    this.addLog(`${p.name} не участвует в аукционе`);
    return true;
  }

  placeAuctionBid(playerId) {
    if (!this.canPlayerAuctionBid(playerId)) return false;
    const p = this.players[playerId];
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
        this.setOwnNotice(winner.name, cell.name);
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

  sendToJail() {
    const p = this.currentPlayer;
    p.position = JAIL_POS;
    p.inJail = true;
    p.jailTurns = 0;
    this.doubles = false;
    this.addLog(logJail(p.name));
    this.phase = PHASE.END;
    this.endTurn();
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
    const fieldName = kind === 'force' ? 'Форс мажор' : 'Шанс';

    if (card.money) {
      if (card.money > 0) {
        p.money += card.money;
        this.addLog(logMoneyGain(p.name, card.money));
        this.afterAction();
      } else {
        this.startCardDebt({
          amount: Math.abs(card.money),
          text: card.text || '',
          fieldName,
          kind,
        });
      }
      return;
    }

    if (card.birthday) {
      this.addLog(`${p.name}: день рождения — все скидываются по $${card.birthday.toLocaleString('ru-RU')}`);
      for (const other of this.activePlayers) {
        if (other.id !== p.id) {
          const amt = Math.min(card.birthday, other.money);
          this.transferMoney(other, p, amt);
        }
      }
      this.afterAction();
      return;
    }

    if (card.goToStart) {
      p.position = 0;
      p.money += GO_SALARY;
      this.addLog(`${p.name} телепортируется на Старт (+$${GO_SALARY.toLocaleString('ru-RU')})`);
      this.afterAction();
      return;
    }

    if (card.goToJail) {
      this.sendToJail();
      return;
    }

    if (card.goTo !== undefined) {
      p.position = card.goTo;
      this.addLog(`${p.name} переходит на «${getCell(card.goTo)?.name || 'поле'}»`);
      this.afterAction();
      return;
    }

    if (card.moveBack) {
      this.addLog(`${p.name} отступает на ${card.moveBack} клетки`);
      p.position = (p.position - card.moveBack + BOARD_SIZE) % BOARD_SIZE;
      this.landOnCell();
      return;
    }

    if (card.repairPerHouse) {
      let total = 0;
      for (const pid of p.properties) {
        total += (this.propertyState[pid].houses || 0) * card.repairPerHouse;
      }
      if (total <= 0) {
        this.addLog(`${p.name}: ${card.text || 'ремонт'} — убытков нет`);
        this.afterAction();
        return;
      }
      this.startCardDebt({
        amount: total,
        text: card.text || 'Ремонт филиалов',
        fieldName,
        kind,
      });
      return;
    }

    this.addLog(card.text || `${p.name}: сюрприз на поле`);
    this.afterAction();
  }

  /** Убыток с карты Шанс / Форс-мажор — панель долга */
  startCardDebt({ amount, text, fieldName, kind }) {
    const p = this.currentPlayer;
    this.addLog(`${p.name}: ${text || 'убыток'} — $${amount.toLocaleString('ru-RU')}`);
    if (this.tryInstantBankruptcy(p, null, amount, 'убыток')) return;
    this.pendingAction = {
      type: 'force',
      cellId: p.position,
      amount,
      text: text || '',
      fieldName: fieldName || (kind === 'force' ? 'Форс мажор' : 'Шанс'),
      kind: kind || 'force',
      endsAt: Date.now() + RENT_MS,
    };
    this.phase = PHASE.ACTION;
  }

  payCardDebt() {
    const pa = this.pendingAction;
    if (this.phase !== PHASE.ACTION || pa?.type !== 'force') return false;
    const p = this.currentPlayer;
    const amount = pa.amount;
    this.pendingAction = null;
    if (p.money >= amount) {
      p.money -= amount;
      this.addLog(logMoneyLoss(p.name, amount));
      this.afterAction();
    } else {
      this.handleBankruptcy(p, null, amount);
    }
    return true;
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
    this.setOwnNotice(p.name, cell.name);
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


  allowsShares(cell) {
    if (!cell || cell.type !== 'property') return false;
    if (cell.noShares || NO_SHARE_GROUPS.has(cell.group)) return false;
    return !!cell.houseCost;
  }

  buildHouse(cellId) {
    const p = this.currentPlayer;
    const cell = getCell(cellId);
    const ps = this.propertyState[cellId];

    if (!this.allowsShares(cell)) return false;
    if (ps.owner !== p.id) return false;
    if (!this.ownsGroup(p.id, cell.group)) return false;
    if (ps.houses >= MAX_HOUSES) return false;
    if (this.housesBuilt >= this.maxHouses) return false;
    if (this.sharesBoughtThisTurn >= this.maxSharesPerTurn) return false;
    if (!this.canAfford(p, cell.houseCost)) return false;

    const group = getGroupProperties(cell.group);
    const minHouses = Math.min(...group.map(g => this.propertyState[g.id].houses));
    if (ps.houses > minHouses) return false;

    p.money -= cell.houseCost;
    ps.houses++;
    this.housesBuilt++;
    this.sharesBoughtThisTurn++;
    this.addLog(logBuild(p.name, cell.name));
    return true;
  }

  getBuildableProperties(playerId) {
    const p = this.players[playerId];
    if (!p) return [];
    if (this.sharesBoughtThisTurn >= this.maxSharesPerTurn) return [];
    const result = [];
    for (const cellId of p.properties) {
      const cell = getCell(cellId);
      const ps = this.propertyState[cellId];
      if (!this.allowsShares(cell)) continue;
      if (ps.mortgaged) continue;
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
    if (this.phase === PHASE.GAME_OVER) return;
    const p = this.currentPlayer;
    if (!p || p.bankrupt) {
      this.phase = PHASE.END;
      this.endTurn();
      return;
    }

    // Акции покупаются перед броском; бот докупает в конце хода
    if (p.isBot) {
      const buildable = this.getBuildableProperties(p.id);
      const cellId = buildable[0];
      if (cellId != null && p.money >= getCell(cellId).houseCost + 150_000) {
        this.buildHouse(cellId);
      }
    }
    this.advanceAfterTurnActions();
  }

  /** После всех действий хода: дубль → ещё бросок, иначе ход следующего */
  advanceAfterTurnActions() {
    if (this.phase === PHASE.GAME_OVER) return;
    this.pendingAction = null;
    const p = this.currentPlayer;
    if (!p || p.bankrupt) {
      this.phase = PHASE.END;
      this.endTurn();
      return;
    }
    if (this.doubles && !p.inJail) {
      this.phase = PHASE.ROLL;
      this.beginTurnTimer();
      this.addLog(`${p.name} выбил дубль — ходит ещё раз`);
      return;
    }
    this.phase = PHASE.END;
    this.endTurn();
  }

  finishBuild() {
    this.advanceAfterTurnActions();
  }

  /** Продать 1 акцию — половина стоимости */
  sellShare(cellId) {
    const p = this.currentPlayer;
    const cell = getCell(cellId);
    const ps = this.propertyState[cellId];
    if (!ps || ps.owner !== p.id || ps.mortgaged) return false;
    if (!this.allowsShares(cell)) return false;
    if ((ps.houses || 0) < 1) return false;
    const group = getGroupProperties(cell.group);
    const maxH = Math.max(...group.map(g => this.propertyState[g.id]?.houses || 0));
    if (ps.houses < maxH) return false;
    const cash = Math.floor(cell.houseCost / 2);
    ps.houses -= 1;
    this.housesBuilt = Math.max(0, this.housesBuilt - 1);
    p.money += cash;
    this.addLog(`${p.name} продаёт акцию «${cell.name}» (+$${cash.toLocaleString('ru-RU')})`);
    return true;
  }

  /** Заложить компанию — половина цены, иконка замка на клетке */
  mortgageProperty(cellId) {
    const p = this.currentPlayer;
    const cell = getCell(cellId);
    const ps = this.propertyState[cellId];
    if (!cell || !ps || ps.owner !== p.id || ps.mortgaged) return false;
    if (ps.houses > 0) return false;
    if (!['property', 'railroad', 'utility'].includes(cell.type)) return false;
    const cash = Math.floor((cell.price || 0) / 2);
    ps.mortgaged = true;
    p.money += cash;
    this.addLog(`${p.name} закладывает «${cell.name}» (+$${cash.toLocaleString('ru-RU')})`);
    return true;
  }

  /** Выкупить из залога — цена ×0.55 */
  unmortgageProperty(cellId) {
    const p = this.currentPlayer;
    const cell = getCell(cellId);
    const ps = this.propertyState[cellId];
    if (!cell || !ps || ps.owner !== p.id || !ps.mortgaged) return false;
    const cost = Math.floor((cell.price || 0) * 0.55);
    if (!this.canAfford(p, cost)) return false;
    p.money -= cost;
    ps.mortgaged = false;
    this.addLog(`${p.name} выкупает «${cell.name}» (−$${cost.toLocaleString('ru-RU')})`);
    return true;
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
    this._lastRollDoubles = false;
    this.pendingAction = null;
    this.deal = null;
    this.dealUiOpen = false;
    this.shareUiOpen = false;
    this.sharesBoughtThisTurn = 0;
    this._turnLeftMs = null;
    this.beginTurnTimer();
    this.addLog(`— Ход: ${this.currentPlayer.name} —`);
    return true;
  }

  handleBankruptcy(debtor, creditor, amount) {
    this.addLog(`💀 ${debtor.name} обанкротился!`);
    this.liquidatePlayer(debtor, creditor);
    this.pendingAction = null;
    this.doubles = false;

    if (this.activePlayers.length <= 1) {
      this.winner = this.activePlayers[0] || creditor;
      this.phase = PHASE.GAME_OVER;
      this.addLog(`🏆 ${this.winner?.name} побеждает!`);
      return;
    }
    this.phase = PHASE.END;
    this.endTurn();
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
    // сбрасываем тост покупки на следующем действии (кроме ставок аукциона)
    if (action.type !== 'auctionBid') this.notice = null;

    if (action.type === 'auctionBid') {
      if (!this.placeAuctionBid(playerId)) return { ok: false, error: 'Нельзя сделать ставку' };
      return { ok: true, auction: true };
    }
    if (action.type === 'auctionLeave') {
      if (!this.leaveAuction(playerId)) return { ok: false, error: 'Нельзя выйти из аукциона' };
      return { ok: true, auction: true };
    }
    if (action.type === 'auctionEnd') {
      if (this.phase !== PHASE.AUCTION) return { ok: false, error: 'Нет аукциона' };
      this.finishAuction();
      return { ok: true };
    }

    if (action.type === 'acceptDeal') {
      if (!this.acceptDeal(playerId)) return { ok: false, error: 'Нельзя принять сделку' };
      return { ok: true };
    }
    if (action.type === 'rejectDeal') {
      if (!this.rejectDeal(playerId)) return { ok: false, error: 'Нельзя отклонить сделку' };
      return { ok: true };
    }

    if (this.currentPlayer.id !== playerId) return { ok: false, error: 'Не ваш ход' };

    switch (action.type) {
      case 'roll':
        if (this.phase !== PHASE.ROLL) return { ok: false, error: 'Сейчас нельзя бросать' };
        if (this.deal) return { ok: false, error: 'Сначала завершите сделку' };
        if (this.shareUiOpen) this.shareUiOpen = false;
        this.rollDice();
        return { ok: true };

      case 'beginDealUi':
        if (this.shareUiOpen) this.cancelShareUi(playerId);
        if (!this.beginDealUi(playerId)) return { ok: false, error: 'Сейчас нельзя предложить сделку' };
        return { ok: true };

      case 'cancelDealUi':
        if (!this.cancelDealUi(playerId)) return { ok: false, error: 'Нечего отменять' };
        return { ok: true };

      case 'proposeDeal':
        if (!this.proposeDeal(playerId, action)) return { ok: false, error: 'Нельзя предложить сделку' };
        return { ok: true, deal: true };

      case 'beginShareUi':
        if (this.dealUiOpen) this.cancelDealUi(playerId);
        if (!this.beginShareUi(playerId)) return { ok: false, error: 'Сейчас нельзя купить акции' };
        return { ok: true };

      case 'cancelShareUi':
        if (!this.cancelShareUi(playerId)) return { ok: false, error: 'Нечего закрывать' };
        return { ok: true };

      case 'buy':
        if (!this.buyProperty()) return { ok: false, error: 'Нельзя купить' };
        return { ok: true };

      case 'pass':
        if (!this.passProperty()) return { ok: false, error: 'Нельзя начать аукцион' };
        return { ok: true, auction: true };

      case 'build':
        if (this.phase !== PHASE.BUILD && !(this.phase === PHASE.ROLL && this.shareUiOpen)) {
          return { ok: false, error: 'Сейчас нельзя покупать акции' };
        }
        if (!this.buildHouse(action.cellId)) return { ok: false, error: 'Нельзя купить акцию' };
        return { ok: true };

      case 'finishBuild':
        if (this.phase === PHASE.ROLL && this.shareUiOpen) {
          this.cancelShareUi(playerId);
          return { ok: true };
        }
        if (this.phase !== PHASE.BUILD) return { ok: false, error: 'Не фаза покупки акций' };
        this.finishBuild();
        return { ok: true };

      case 'endTurn':
        if (this.phase !== PHASE.END && this.phase !== PHASE.BUILD) return { ok: false, error: 'Нельзя завершить ход' };
        this.endTurn();
        return { ok: true };

      case 'payJailBail':
        if (!this.payJailBail()) return { ok: false, error: 'Нельзя заплатить залог' };
        return { ok: true };

      case 'payDebt': {
        const kind = this.pendingAction?.type;
        if (kind === 'rent') {
          if (!this.payRentDebt()) return { ok: false, error: 'Нет долга к погашению' };
          return { ok: true };
        }
        if (kind === 'tax') {
          if (!this.payTaxDebt()) return { ok: false, error: 'Нет налога к погашению' };
          return { ok: true };
        }
        if (kind === 'force') {
          if (!this.payCardDebt()) return { ok: false, error: 'Нет убытка к погашению' };
          return { ok: true };
        }
        return { ok: false, error: 'Нет долга к погашению' };
      }

      case 'sellShare':
        if (
          this.phase !== PHASE.END
          && this.phase !== PHASE.BUILD
          && !(this.phase === PHASE.ACTION && ['rent', 'tax', 'force'].includes(this.pendingAction?.type))
        ) {
          return { ok: false, error: 'Сейчас нельзя продавать акции' };
        }
        if (!this.sellShare(action.cellId)) return { ok: false, error: 'Нельзя продать акцию' };
        return { ok: true };

      case 'mortgage':
        if (
          this.phase !== PHASE.END
          && this.phase !== PHASE.BUILD
          && !(this.phase === PHASE.ACTION && ['rent', 'tax', 'force'].includes(this.pendingAction?.type))
        ) {
          return { ok: false, error: 'Сейчас нельзя закладывать' };
        }
        if (!this.mortgageProperty(action.cellId)) return { ok: false, error: 'Нельзя заложить' };
        return { ok: true };

      case 'unmortgage':
        if (this.phase !== PHASE.END && this.phase !== PHASE.BUILD) {
          return { ok: false, error: 'Сейчас нельзя выкупить' };
        }
        if (!this.unmortgageProperty(action.cellId)) return { ok: false, error: 'Нельзя выкупить' };
        return { ok: true };

      default:
        return { ok: false, error: 'Неизвестное действие' };
    }
  }
}

function rand() {
  return Math.floor(Math.random() * 6) + 1;
}

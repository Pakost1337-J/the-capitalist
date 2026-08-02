import { BOARD, BOARD_SIZE, COUNTRY_FLAG_SRC, GROUP_COLORS, JAIL_BAIL, AUCTION_STEP, getGridPosition } from './config.js';
import { formatMoney, formatPriceShort, sleep } from './utils.js';
import { PHASE } from './game.js';
import { iconHTML, resolveIconSrc } from './icons.js';
import {
  makeDieCubeHTML,
  throwDice,
  resolveMovePath,
  DIE_FACE_ROT,
} from './animations.js';

export class UI {
  constructor(engine, network) {
    this.engine = engine;
    this.network = network;
    this.mySlot = null;
    this.lastState = null;
    this.lastDiceKey = '';
    this.displayPos = {};
    this.tokenEls = {};
    this.animating = false;
    this.pendingState = null;
    this._resizeTimer = null;

    this.boardEl = document.getElementById('board');
    this.playersPanel = document.getElementById('players-panel');
    this.actionArea = document.getElementById('action-area');
    this.gameLog = document.getElementById('game-log');
    this.chatLines = [];
    this.die1 = document.getElementById('die1');
    this.die2 = document.getElementById('die2');
    this.die1Throw = document.getElementById('die1-throw');
    this.die2Throw = document.getElementById('die2-throw');
    this.dieSum = null;
    this.diceStage = document.getElementById('dice-stage');
    this.hubTurn = document.getElementById('hub-turn');
    this.hubName = document.getElementById('hub-name');
    this.hubCash = document.getElementById('hub-cash');
    this.hubCapital = document.getElementById('hub-capital');
    this.hubCompanies = document.getElementById('hub-companies');

    this.choicePanel = document.getElementById('choice-panel');

    document.getElementById('new-game')?.addEventListener('click', () => {
      this.showChoiceButtons({
        title: 'Выйти из игры?',
        left: 'Остаться',
        right: 'Выйти',
        onLeft: () => {},
        onRight: () => location.reload(),
      });
    });

    if (this.die1) this.die1.innerHTML = makeDieCubeHTML();
    if (this.die2) this.die2.innerHTML = makeDieCubeHTML();
    this.setDieFace(this.die1, 1);
    this.setDieFace(this.die2, 1);

    this.setupChat();
    this.buildBoard();
    this.fitLayout();

    window.addEventListener('resize', () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this.fitLayout();
        this.repositionTokens();
      }, 80);
    });
  }

  /** Растягивает поле на весь экран; игроки остаются сразу справа от доски */
  fitLayout() {
    const shell = document.getElementById('game-layout');
    if (!shell || shell.hidden) return;

    const pad = 16;
    const gap = 10;
    const narrow = window.innerWidth <= 860;
    const rail = narrow ? 0 : Math.round(Math.min(230, Math.max(188, window.innerWidth * 0.15)));
    const availW = Math.max(320, shell.clientWidth - pad - (narrow ? 0 : rail + gap));
    const availH = Math.max(280, shell.clientHeight - pad - (narrow ? 120 : 0));

    // Линии делителей board-frame.png (1024×698) → 13×8, 38 клеток
    // Координаты — металлопланки с кадра (top/bot + центр)
    const IMG_W = 1024;
    const IMG_H = 698;
    const ASPECT = IMG_W / IMG_H;
    const WOOD_X = [13, 152, 217, 283, 348, 413, 478, 544, 609, 674, 739, 805, 870, 1010];
    const WOOD_Y = [13, 149, 215.5, 282, 348.5, 415, 481.5, 548, 685];

    let boardW = availW;
    let boardH = Math.floor(boardW / ASPECT);
    if (boardH > availH) {
      boardH = availH;
      boardW = Math.floor(boardH * ASPECT);
    }
    boardH = Math.round(boardW * IMG_H / IMG_W);

    const sx = boardW / IMG_W;
    const sy = boardH / IMG_H;

    // Абсолютное округление линий — без накопления ошибки по mid-клеткам
    const xPx = WOOD_X.map((v) => Math.round(v * sx));
    const yPx = WOOD_Y.map((v) => Math.round(v * sy));
    const padX = xPx[0];
    const padY = yPx[0];
    const padXR = Math.max(0, boardW - xPx[xPx.length - 1]);
    const padYB = Math.max(0, boardH - yPx[yPx.length - 1]);

    const colTracks = [];
    for (let i = 0; i < xPx.length - 1; i++) {
      colTracks.push(Math.max(1, xPx[i + 1] - xPx[i]));
    }
    const rowTracks = [];
    for (let i = 0; i < yPx.length - 1; i++) {
      rowTracks.push(Math.max(1, yPx[i + 1] - yPx[i]));
    }

    // Подгон из‑за padXR/padYB округлений
    const gridW = boardW - padX - padXR;
    const gridH = boardH - padY - padYB;
    const sumCols = colTracks.reduce((a, b) => a + b, 0);
    colTracks[colTracks.length - 1] += gridW - sumCols;
    const sumRows = rowTracks.reduce((a, b) => a + b, 0);
    rowTracks[rowTracks.length - 1] += gridH - sumRows;

    const corner = colTracks[0];
    const cornerBot = rowTracks[rowTracks.length - 1];
    const cellW = colTracks[1];
    const cellH = rowTracks[1];
    const logoW = Math.max(18, cellW - 6);
    const logoH = Math.max(14, Math.round(Math.min(cellW, cellH) * 0.38));
    const colCss = colTracks.map((px) => `${px}px`).join(' ');
    const rowCss = rowTracks.map((px) => `${px}px`).join(' ');

    const root = document.documentElement;
    const apply = (el) => {
      if (!el) return;
      el.style.setProperty('--frame-pad-x', `${padX}px`);
      el.style.setProperty('--frame-pad-y', `${padY}px`);
      el.style.setProperty('--frame-pad-xr', `${padXR}px`);
      el.style.setProperty('--frame-pad-yb', `${padYB}px`);
      el.style.setProperty('--corner', `${corner}px`);
      el.style.setProperty('--corner-bot', `${cornerBot}px`);
      el.style.setProperty('--cell-w', `${cellW}px`);
      el.style.setProperty('--cell-h', `${cellH}px`);
      el.style.setProperty('--logo-w', `${logoW}px`);
      el.style.setProperty('--logo-h', `${logoH}px`);
    };
    apply(root);
    apply(this.boardEl);
    root.style.setProperty('--rail-w', narrow ? '100%' : `${rail}px`);
    if (this.boardEl) {
      this.boardEl.style.width = `${boardW}px`;
      this.boardEl.style.height = `${boardH}px`;
      this.boardEl.style.padding = `${padY}px ${padXR}px ${padYB}px ${padX}px`;
      this.boardEl.style.gridTemplateColumns = colCss;
      this.boardEl.style.gridTemplateRows = rowCss;
    }
    this._logoSize = { w: logoW, h: logoH, corner, cornerBot, cellW, cellH, padX, padY };
  }

  setupChat() {
    const input = document.getElementById('chat-input');
    const send = document.getElementById('chat-send');
    if (!input || !send) return;

    const submit = () => {
      const text = input.value.trim();
      if (!text || !this.lastState) return;
      const me = this.lastState.players.find(p => p.id === this.mySlot);
      const line = `${me?.name || 'Игрок'}: ${text}`;
      this.network.socket?.emit('chat', { text });
      this.appendChat(line);
      input.value = '';
    };

    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    this.network.socket?.on('chat-message', (msg) => {
      if (msg?.from === this.network.socket.id) return;
      this.appendChat(`${msg.name}: ${msg.text}`);
    });
  }

  appendChat(line) {
    this.chatLines.push(line);
    if (this.chatLines.length > 40) this.chatLines.shift();
    if (this.lastState) this.renderLog(this.lastState);
    else this.paintLogLines([]);
  }

  paintLogLines(gameLines) {
    if (!this.gameLog) return;
    const all = [...gameLines, ...this.chatLines];
    this.gameLog.innerHTML = all.map(line =>
      `<div class="log-line">${escapeHtml(line)}</div>`
    ).join('');
    // Сообщения прижаты к низу (flex-end); докручиваем скролл после отрисовки
    requestAnimationFrame(() => {
      this.gameLog.scrollTop = this.gameLog.scrollHeight;
    });
  }

  buildBoard() {
    this.cells = {};
    for (let i = 0; i < BOARD_SIZE; i++) {
      const pos = getGridPosition(i);
      const cell = BOARD[i];
      const el = document.createElement('div');
      el.className = `cell cell--${cell.type}`;
      el.dataset.id = i;
      el.style.gridRow = pos.row + 1;
      el.style.gridColumn = pos.col + 1;
      if (cell.group) el.style.setProperty('--group-color', GROUP_COLORS[cell.group]);
      el.innerHTML = this.renderCellHTML(cell, i);
      this.boardEl.appendChild(el);
      this.cells[i] = el;
    }

    this.tokenLayer = document.createElement('div');
    this.tokenLayer.className = 'board__tokens';
    this.boardEl.appendChild(this.tokenLayer);
  }

  cellSide(index) {
    if (index >= 1 && index <= 11) return 'top';
    if (index >= 13 && index <= 18) return 'right';
    if (index >= 20 && index <= 30) return 'bottom';
    if (index >= 32 && index <= 37) return 'left';
    return 'corner';
  }

  renderCellHTML(cell, index) {
    const side = this.cellSide(index);
    const isCorner = side === 'corner';
    const isCompany = cell.type === 'property' || cell.type === 'railroad' || cell.type === 'utility';

    let body;
    if (isCompany) {
      const country = cell.country || '';
      const company = cell.name || cell.brand || '';
      const price = cell.price != null ? formatPriceShort(cell.price) : '';
      const flagSrc = COUNTRY_FLAG_SRC[country] || '';
      const flagHtml = flagSrc
        ? `<img class="cell__flag-img" src="${flagSrc}" alt="" />`
        : (cell.flag ? `<span class="cell__flag">${cell.flag}</span>` : '');
      // DOM: страна → логотип → деньги → акции; flex по стороне тянет страну к краю доски
      body = `
        <div class="cell__country-slot">${flagHtml}</div>
        <div class="cell__logo" title="Слот логотипа">
          <span class="cell__logo-text">${escapeHtml(company)}</span>
        </div>
        ${price ? `<span class="cell__price">${price}</span>` : ''}
        <div class="cell__shares" data-houses="${index}" aria-label="Акции"></div>
      `;
    } else if (cell.type === 'tax') {
      body = `
        <span class="cell__tax-marks">%%%</span>
        <span class="cell__name">${escapeHtml(cell.name)}</span>
      `;
    } else if (isCorner) {
      // Углы — только арт с board-frame, без надписей
      body = '';
    } else {
      body = `
        <span class="cell__name">${escapeHtml(cell.name)}</span>
        ${cell.icon ? iconHTML(cell.icon, 'cell__icon') : ''}
      `;
    }

    return `
      <div class="cell__body cell__body--${side} ${isCorner ? 'cell__body--corner' : ''}">
        ${body}
      </div>
    `;
  }

  /** Две кнопки вместо ползунка */
  showChoiceButtons({ title, left, right, onLeft, onRight }) {
    if (!this.choicePanel) return;
    this.choicePanel.hidden = false;
    this.choicePanel.innerHTML = `
      <div class="choice-buttons">
        <div class="choice-buttons__title">${escapeHtml(title)}</div>
        <div class="choice-buttons__row">
          <button type="button" class="btn btn--pass" id="choice-left">${escapeHtml(left)}</button>
          <button type="button" class="btn btn--roll" id="choice-right">${escapeHtml(right)}</button>
        </div>
      </div>
    `;
    this.choicePanel.querySelector('#choice-left').addEventListener('click', () => {
      this.hideChoiceButtons();
      onLeft?.();
    });
    this.choicePanel.querySelector('#choice-right').addEventListener('click', () => {
      this.hideChoiceButtons();
      onRight?.();
    });
  }

  hideChoiceButtons() {
    if (!this.choicePanel) return;
    this.choicePanel.hidden = true;
    this.choicePanel.innerHTML = '';
  }

  hideChoiceSlider() {
    this.hideChoiceButtons();
  }

  render(state) {
    if (this.animating) {
      this.pendingState = state;
      // обновляем панели, но позиции фишек — после анимации
      if (state.mySlot !== undefined) this.mySlot = state.mySlot;
      this.renderHub(state);
      this.renderPlayers(state);
      this.renderHouses(state);
      this.renderLog(state);
      this.syncAuctionUi(state);
      if (state.phase === PHASE.AUCTION) this.renderActions(state);
      return;
    }

    const prev = this.lastState;
    if (state.mySlot !== undefined) this.mySlot = state.mySlot;

    this.renderHub(state);
    this.renderPlayers(state);
    this.renderHouses(state);
    this.renderLog(state);
    this.highlightCurrentCell(state);
    this.syncAuctionUi(state);

    const diceChanged = this.diceChanged(prev, state);
    const movers = this.findMovers(prev, state);

    if (!prev) {
      this.syncDiceFaces(state);
      this.ensureTokens(state);
      this.snapTokens(state);
      this.renderActions(state);
      this.lastState = state;
      return;
    }

    this.lastState = state;
    this.runTurnAnimations(state, { diceChanged, movers });
  }

  diceChanged(prev, state) {
    if (!prev) return false;
    const rolled = (state.log || []).find(l => /бросает\s+\d+\s*:\s*\d+/.test(l));
    if (!rolled) return false;
    return !(prev.log || []).includes(rolled);
  }

  findMovers(prev, state) {
    if (!prev) return [];
    const movers = [];
    for (const p of state.players) {
      if (p.bankrupt) continue;
      const old = prev.players.find(x => x.id === p.id);
      if (!old) continue;
      if (old.position !== p.position) {
        movers.push({
          id: p.id,
          from: old.position,
          to: p.position,
          player: p,
        });
      }
    }
    return movers;
  }

  async runTurnAnimations(state, { diceChanged, movers }) {
    this.animating = true;
    this.renderActions({ ...state, phase: PHASE.MOVING, isMyTurn: false });

    try {
      if (diceChanged) {
        await this.animateDiceThrow(state);
      } else {
        this.syncDiceFaces(state);
      }

      this.ensureTokens(state);

      const diceSum = (state.dice?.[0] || 0) + (state.dice?.[1] || 0);
      for (const m of movers) {
        await this.animateTokenMove(m.id, m.from, m.to, diceSum, m.player);
      }

      // выровнять стек на клетках
      this.layoutTokenStacks(state);
    } finally {
      this.animating = false;
      const next = this.pendingState;
      this.pendingState = null;
      if (next && next !== state) {
        this.render(next);
      } else {
        this.renderActions(state);
        this.highlightCurrentCell(state);
      }
    }
  }

  setDieFace(cube, value) {
    if (!cube) return;
    const face = DIE_FACE_ROT[value] || DIE_FACE_ROT[1];
    cube.style.transition = 'none';
    cube.style.transform = `rotateX(${face.x}deg) rotateY(${face.y}deg)`;
  }

  syncDiceFaces(state) {
    const d1 = clampDie(state.dice?.[0]);
    const d2 = clampDie(state.dice?.[1]);
    this.setDieFace(this.die1, d1);
    this.setDieFace(this.die2, d2);
    this.die1Throw?.classList.toggle('die-throw--doubles', !!state.doubles);
    this.die2Throw?.classList.toggle('die-throw--doubles', !!state.doubles);
  }

  async animateDiceThrow(state) {
    const d1 = clampDie(state.dice?.[0]);
    const d2 = clampDie(state.dice?.[1]);
    this.diceStage?.classList.remove('table-toss--landed');
    await throwDice(
      [this.die1Throw, this.die2Throw],
      [this.die1, this.die2],
      [d1, d2],
      { doubles: !!state.doubles, stageEl: this.diceStage },
    );
  }

  ensureTokens(state) {
    const alive = new Set();
    for (const p of state.players) {
      if (p.bankrupt) {
        this.tokenEls[p.id]?.remove();
        delete this.tokenEls[p.id];
        delete this.displayPos[p.id];
        continue;
      }
      alive.add(p.id);
      if (!this.tokenEls[p.id]) {
        const el = this.createTokenEl(p);
        this.tokenLayer.appendChild(el);
        this.tokenEls[p.id] = el;
        this.displayPos[p.id] = p.position;
      } else {
        this.tokenEls[p.id].style.setProperty('--token-color', p.color);
        this.tokenEls[p.id].title = p.name;
      }
    }
    for (const id of Object.keys(this.tokenEls)) {
      if (!alive.has(Number(id))) {
        this.tokenEls[id]?.remove();
        delete this.tokenEls[id];
        delete this.displayPos[id];
      }
    }
  }

  createTokenEl(p) {
    const el = document.createElement('div');
    el.className = 'token token-fly token--board';
    el.dataset.player = String(p.id);
    el.style.setProperty('--token-color', p.color);
    el.title = p.name;
    const img = resolveIconSrc(p.tokenImage || '');
    if (img) {
      el.classList.add('token--img');
      el.innerHTML = `<img src="${img}" alt="" />`;
    } else {
      el.innerHTML = '<span class="token__ring"></span><span class="token__core"></span>';
    }
    return el;
  }

  tokenImgHtml(p) {
    const img = resolveIconSrc(p.tokenImage || '');
    if (img) {
      return `<div class="token token--img p-card__token" title="${escapeHtml(p.name)}" style="--token-color: ${p.color}"><img src="${img}" alt="" /></div>`;
    }
    return `<div class="token p-card__token" title="${escapeHtml(p.name)}" style="--token-color: ${p.color}"><span class="token__ring"></span><span class="token__core"></span></div>`;
  }

  getCellPoint(index, stackIndex = 0, stackCount = 1) {
    const cell = this.cells[index];
    if (!cell || !this.boardEl) return { x: 0, y: 0 };
    const boardRect = this.boardEl.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const ox = ((stackIndex % 2) - (stackCount > 1 ? 0.35 : 0)) * 12;
    const oy = (Math.floor(stackIndex / 2) - (stackCount > 2 ? 0.35 : 0)) * 12;
    return {
      x: cellRect.left - boardRect.left + cellRect.width * 0.72 + ox,
      y: cellRect.top - boardRect.top + cellRect.height * 0.68 + oy,
    };
  }

  placeToken(id, index, { animate = false, stackIndex = 0, stackCount = 1 } = {}) {
    const el = this.tokenEls[id];
    if (!el) return;
    const { x, y } = this.getCellPoint(index, stackIndex, stackCount);
    const transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;

    if (!animate) {
      el.style.transition = 'none';
      el.style.transform = transform;
      void el.offsetWidth;
      el.style.transition = '';
    } else {
      el.classList.remove('token-fly--teleport');
      el.style.transition = 'transform 0.15s linear';
      el.style.transform = transform;
    }
    this.displayPos[id] = index;
  }

  snapTokens(state) {
    const byPos = groupByPosition(state.players);
    for (const [pos, list] of Object.entries(byPos)) {
      list.forEach((p, i) => {
        this.placeToken(p.id, Number(pos), {
          animate: false,
          stackIndex: i,
          stackCount: list.length,
        });
      });
    }
  }

  layoutTokenStacks(state) {
    const byPos = groupByPosition(state.players);
    for (const [pos, list] of Object.entries(byPos)) {
      list.forEach((p, i) => {
        this.placeToken(p.id, Number(pos), {
          animate: true,
          hop: false,
          stackIndex: i,
          stackCount: list.length,
        });
      });
    }
  }

  repositionTokens() {
    if (!this.lastState || this.animating) return;
    this.snapTokens(this.lastState);
  }

  async animateTokenMove(id, from, to, diceSum, player) {
    const { path, teleport } = resolveMovePath(from, to, diceSum);
    if (!path.length) {
      this.placeToken(id, to, { animate: false });
      return;
    }

    if (teleport) {
      this.placeToken(id, to, { animate: true });
      await sleep(160);
      this.highlightCell(to);
      return;
    }

    for (const step of path) {
      this.placeToken(id, step, { animate: true });
      this.highlightCell(step);
      await sleep(150);
    }
  }

  highlightCell(index) {
    document.querySelectorAll('.cell--highlight').forEach(c => c.classList.remove('cell--highlight'));
    this.cells[index]?.classList.add('cell--highlight');
  }

  calcCapital(player, state) {
    let capital = player.money;
    for (const pid of player.properties) {
      const cell = BOARD[pid];
      const ps = state.propertyState[pid];
      if (!cell) continue;
      capital += cell.price || 0;
      if (cell.houseCost && ps) capital += (ps.houses || 0) * cell.houseCost;
    }
    return capital;
  }

  renderHub(state) {
    const current = state.players[state.currentPlayerIndex];
    const me = state.players.find(p => p.id === this.mySlot) || current;

    if (this.hubTurn) {
      this.hubTurn.textContent = state.phase === PHASE.GAME_OVER
        ? 'ИГРА ОКОНЧЕНА'
        : state.phase === PHASE.AUCTION
          ? 'АУКЦИОН'
          : `ХОД ИГРОКА ${current?.name || ''}`.toUpperCase();
    }

    const focus = state.isMyTurn ? me : current;
    if (this.hubName) this.hubName.textContent = focus?.name || '—';
    if (this.hubCash) this.hubCash.textContent = formatMoney(focus?.money || 0);
    if (this.hubCapital) this.hubCapital.textContent = formatMoney(this.calcCapital(focus || { money: 0, properties: [] }, state));
    if (this.hubCompanies) this.hubCompanies.textContent = String(focus?.properties?.length || 0);
  }

  renderPlayers(state) {
    this.playersPanel.innerHTML = state.players.map((p, i) => {
      const capital = this.calcCapital(p, state);
      const isTurn = i === state.currentPlayerIndex;
      return `
        <div class="p-card ${isTurn ? 'p-card--active' : ''} ${p.bankrupt ? 'p-card--out' : ''} ${p.id === this.mySlot ? 'p-card--me' : ''}"
             style="--pc: ${p.color}">
          <div class="p-card__info">
            <div class="p-card__name">${escapeHtml(p.name)}</div>
            <div class="p-card__badge">${p.isBot ? 'Бот' : (p.id === this.mySlot ? 'Вы' : 'Игрок')}${p.inJail ? ' · тюрьма' : ''}</div>
          </div>
          ${this.tokenImgHtml(p)}
          <div class="p-card__rows">
            <div><span>Баланс</span><strong class="money">${formatMoney(p.money)}</strong></div>
            <div><span>Капитал</span><strong>${formatMoney(capital)}</strong></div>
          </div>
          ${isTurn && state.phase !== PHASE.GAME_OVER ? '<div class="p-card__turn">Ваш ход</div>' : ''}
        </div>
      `;
    }).join('');
  }

  renderHouses(state) {
    document.querySelectorAll('[data-houses]').forEach(el => { el.innerHTML = ''; });
    document.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('cell--owned');
      c.style.removeProperty('--owner-color');
    });

    for (const [cellId, ps] of Object.entries(state.propertyState)) {
      if (ps.houses > 0) {
        const container = document.querySelector(`[data-houses="${cellId}"]`);
        const owner = state.players[ps.owner];
        if (container) {
          for (let i = 0; i < ps.houses; i++) {
            const house = document.createElement('div');
            house.className = 'house';
            house.style.background = owner?.color || '#666';
            container.appendChild(house);
          }
        }
      }
      const cell = this.cells[cellId];
      if (cell && ps.owner !== null) {
        cell.classList.add('cell--owned');
        cell.style.setProperty('--owner-color', state.players[ps.owner]?.color);
      }
    }
  }

  async doAction(action) {
    const res = await this.network.sendAction(action);
    if (!res?.ok) console.warn('Action failed:', res?.error);
  }

  renderActions(state) {
    const p = state.players[state.currentPlayerIndex];
    const isMyTurn = state.isMyTurn;
    this.actionArea.innerHTML = '';

    if (state.phase === PHASE.GAME_OVER) {
      const won = state.winner?.id === this.mySlot;
      this.actionArea.innerHTML = `
        <div class="winner-banner">${won ? '🏆 Вы победили!' : `🏆 ${state.winner?.name} победил!`}</div>
        <button class="btn btn--roll" onclick="location.reload()">Играть снова</button>
      `;
      return;
    }

    if (state.phase === PHASE.AUCTION && state.auction) {
      this.renderAuctionActions(state);
      return;
    }

    if (!isMyTurn || state.phase === PHASE.MOVING) {
      this.actionArea.innerHTML = `<div class="wait-turn">Ход: <strong>${escapeHtml(p.name)}</strong></div>`;
      return;
    }

    if (p.bankrupt) return;

    if (state.phase === PHASE.ROLL) {
      const rollBtn = document.createElement('button');
      rollBtn.className = 'btn btn--roll';
      rollBtn.textContent = p.inJail ? 'Тюрьма: выбрать действие' : 'Бросить кубики';
      rollBtn.addEventListener('click', () => {
        if (p.inJail && p.money >= JAIL_BAIL) {
          this.showChoiceButtons({
            title: 'Тюрьма: выберите действие',
            left: 'Бросить кубики',
            right: `Залог ${formatMoney(JAIL_BAIL)}`,
            onLeft: () => {
              rollBtn.disabled = true;
              this.doAction({ type: 'roll' });
            },
            onRight: () => {
              rollBtn.disabled = true;
              this.doAction({ type: 'payJailBail' });
            },
          });
          return;
        }
        rollBtn.disabled = true;
        this.doAction({ type: 'roll' });
      });
      this.actionArea.appendChild(rollBtn);
    }

    if (state.phase === PHASE.ACTION && state.pendingAction?.type === 'buy') {
      const cell = BOARD[state.pendingAction.cellId];
      this.actionArea.innerHTML = `
        <div class="buy-prompt">
          <p>Купить <strong>${escapeHtml(cell.name)}</strong> за ${formatMoney(state.pendingAction.price)}?</p>
          <div class="buy-prompt__btns">
            <button class="btn btn--buy" id="btn-buy">Купить</button>
            <button class="btn btn--pass" id="btn-pass">Аукцион</button>
          </div>
        </div>
      `;
      document.getElementById('btn-buy').addEventListener('click', () => this.doAction({ type: 'buy' }));
      document.getElementById('btn-pass').addEventListener('click', () => this.doAction({ type: 'pass' }));
    }

    if (state.phase === PHASE.BUILD && state.pendingAction?.type === 'build') {
      const options = state.pendingAction.options;
      this.actionArea.innerHTML = `
        <div class="build-prompt">
          <p>🏗️ Строить филиалы?</p>
          <div class="build-prompt__list">
            ${options.map(id => {
              const cell = BOARD[id];
              const ps = state.propertyState[id];
              return `<button class="btn btn--build" data-build="${id}">
                ${escapeHtml(cell.name)} (${ps.houses}/5) ${formatMoney(cell.houseCost)}
              </button>`;
            }).join('')}
          </div>
          <button class="btn btn--pass" id="btn-finish-build">Готово</button>
        </div>
      `;
      this.actionArea.querySelectorAll('[data-build]').forEach(btn => {
        btn.addEventListener('click', () => this.doAction({ type: 'build', cellId: Number(btn.dataset.build) }));
      });
      document.getElementById('btn-finish-build').addEventListener('click', () => this.doAction({ type: 'finishBuild' }));
    }

    if (state.phase === PHASE.END || (state.phase === PHASE.BUILD && !state.pendingAction)) {
      const endBtn = document.createElement('button');
      endBtn.className = 'btn btn--end';
      endBtn.textContent = '➡️ Завершить ход';
      endBtn.addEventListener('click', () => this.doAction({ type: 'endTurn' }));
      this.actionArea.appendChild(endBtn);
    }
  }

  renderLog(state) {
    // Игровой лог: старые сверху, новые снизу
    const gameLines = [...(state.log || [])].slice(0, 36).reverse();
    this.paintLogLines(gameLines);
  }

  highlightCurrentCell(state) {
    const p = state.players[state.currentPlayerIndex];
    if (!p?.bankrupt) this.highlightCell(p.position);
  }

  syncAuctionUi(state) {
    const hub = document.querySelector('.hub');
    const isAuction = state.phase === PHASE.AUCTION && state.auction;
    hub?.classList.toggle('hub--auction', !!isAuction);
    if (!isAuction) {
      clearInterval(this._auctionTick);
      this._auctionTick = null;
      return;
    }
    if (!this._auctionTick) {
      this._auctionTick = setInterval(() => {
        if (this.lastState?.phase === PHASE.AUCTION) this.renderActions(this.lastState);
      }, 500);
    }
  }

  renderAuctionActions(state) {
    const a = state.auction;
    const cell = BOARD[a.cellId];
    const leader = a.highBidder != null ? state.players[a.highBidder] : null;
    const next = state.nextAuctionPrice ?? (a.highBidder == null ? a.startPrice : a.currentBid + (a.step || AUCTION_STEP));
    const leftMs = Math.max(0, (a.endsAt || 0) - Date.now());
    const sec = Math.ceil(leftMs / 1000);
    const me = state.players.find(p => p.id === this.mySlot);
    const canBid = state.canAuctionBid && me && me.money >= next && a.highBidder !== this.mySlot;

    this.actionArea.innerHTML = `
      <div class="auction-panel">
        <div class="auction-panel__title">Аукцион: ${escapeHtml(cell?.name || '')}</div>
        <div class="auction-panel__timer">${sec}с</div>
        <div class="auction-panel__meta">
          Старт: ${formatMoney(a.startPrice)} · шаг ${formatMoney(a.step || AUCTION_STEP)}
        </div>
        <div class="auction-panel__bid">
          ${leader
            ? `Лидер: <strong>${escapeHtml(leader.name)}</strong> — ${formatMoney(a.currentBid)}`
            : 'Ставок пока нет'}
        </div>
        <div class="auction-panel__next">След. ставка: <strong>${formatMoney(next)}</strong></div>
        <button class="btn btn--buy" id="btn-auction-bid" ${canBid ? '' : 'disabled'}>
          Поставить ${formatMoney(next)}
        </button>
      </div>
    `;
    document.getElementById('btn-auction-bid')?.addEventListener('click', () => {
      this.doAction({ type: 'auctionBid' });
    });
  }
}

function groupByPosition(players) {
  const byPos = {};
  for (const p of players) {
    if (p.bankrupt) continue;
    if (!byPos[p.position]) byPos[p.position] = [];
    byPos[p.position].push(p);
  }
  return byPos;
}

function clampDie(n) {
  const v = Number(n) || 1;
  return Math.min(6, Math.max(1, v));
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

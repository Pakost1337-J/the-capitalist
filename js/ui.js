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

    // Делители: mid из SVG-сетки, края — inset дерева на board-frame (не 0/1023)
    // 13×8 → 38 клеток: угол + 11 mid + угол / угол + 6 mid + угол
    const IMG_W = 1024;
    const IMG_H = 698;
    const ASPECT = IMG_W / IMG_H;
    const WOOD_X = [13, 153, 218, 284, 349, 414, 479, 544, 610, 674, 740, 805, 870, 1010];
    const WOOD_Y = [13, 154, 220, 285, 350, 415, 480, 546, 685];

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

    // Чёрное отверстие в board-frame.png (1024×698) — +1px, чтобы не было щелей
    const HOLE = { l: 148, t: 149, r: 876, b: 550 };
    const holeL = Math.round(HOLE.l * sx);
    const holeT = Math.round(HOLE.t * sy);
    const holeR = Math.round((IMG_W - HOLE.r) * sx);
    const holeB = Math.round((IMG_H - HOLE.b) * sy);

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
      el.style.setProperty('--hole-l', `${holeL}px`);
      el.style.setProperty('--hole-t', `${holeT}px`);
      el.style.setProperty('--hole-r', `${holeR}px`);
      el.style.setProperty('--hole-b', `${holeB}px`);
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
      const logo = `
        <div class="cell__logo" title="Слот логотипа">
          <span class="cell__logo-text">${escapeHtml(company)}</span>
        </div>`;
      const priceEl = price ? `<span class="cell__price">${price}</span>` : '';
      const flagEl = `<div class="cell__country-slot">${flagHtml}</div>`;
      const shares = `<div class="cell__shares" data-houses="${index}" aria-label="Акции"></div>`;
      const ownerMark = `
        <div class="cell__owner" data-owner="${index}" hidden></div>
        <img class="cell__lock" data-lock="${index}" src="/assets/ownership/lock.png" alt="" hidden />`;
      // Верх/низ: флаг у края → лого → цена
      // Бока (как Ferrari): стопка лого+цена к центру, флаг к внешнему краю
      if (side === 'left' || side === 'right') {
        body = `
          ${ownerMark}
          <div class="cell__stack">
            ${logo}
            ${priceEl}
          </div>
          ${flagEl}
          ${shares}`;
      } else {
        body = `${ownerMark}${flagEl}${logo}${priceEl}${shares}`;
      }
    } else if (cell.type === 'tax') {
      const pct = cell.taxPercent != null ? `${cell.taxPercent}%` : '6%';
      body = `
        <div class="cell__tax">
          <span class="cell__tax-title">НАЛОГ</span>
          <span class="cell__tax-pct">${escapeHtml(pct)}</span>
        </div>
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
    const img = resolveIconSrc(p.tokenBoardImage || p.tokenImage || '');
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
      return `<img class="p-card__chip" src="${img}" alt="" title="${escapeHtml(p.name)}" width="56" height="56" />`;
    }
    return `<div class="p-card__chip p-card__chip--fallback" title="${escapeHtml(p.name)}" style="--token-color: ${p.color}"></div>`;
  }

  getCellPoint(index, stackIndex = 0, stackCount = 1) {
    const cell = this.cells[index];
    if (!cell || !this.boardEl) return { x: 0, y: 0 };
    const boardRect = this.boardEl.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const cs = getComputedStyle(this.boardEl);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;

    // Фишка в углу у края к центру доски (как в Monopoly Club), внутри клетки
    const side = this.cellSide(index);
    let fx = 0.5;
    let fy = 0.5;
    if (side === 'top') { fx = 0.72; fy = 0.78; }       // низ-право
    else if (side === 'right') { fx = 0.26; fy = 0.72; }  // низ-лево
    else if (side === 'bottom') { fx = 0.28; fy = 0.26; } // верх-лево
    else if (side === 'left') { fx = 0.74; fy = 0.28; }   // верх-право
    else if (index === 0) { fx = 0.68; fy = 0.68; }
    else if (index === 12) { fx = 0.32; fy = 0.68; }
    else if (index === 19) { fx = 0.32; fy = 0.32; }
    else if (index === 31) { fx = 0.68; fy = 0.32; }

    const cols = Math.min(2, stackCount);
    const col = stackIndex % cols;
    const row = Math.floor(stackIndex / cols);
    const ox = (col - (cols - 1) / 2) * Math.min(11, cellRect.width * 0.16);
    const oy = (row - (Math.ceil(stackCount / cols) - 1) / 2) * Math.min(10, cellRect.height * 0.15);

    return {
      x: cellRect.left - boardRect.left - padL + cellRect.width * fx + ox,
      y: cellRect.top - boardRect.top - padT + cellRect.height * fy + oy,
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
      const jailNote = p.inJail ? ' · тюрьма' : '';
      const props = (p.properties || []).map(id => {
        const cell = BOARD[id];
        const ps = state.propertyState[id];
        if (!cell || !ps) return '';
        const locked = ps.mortgaged || p.bankrupt;
        const title = locked ? `${cell.name} (залог)` : cell.name;
        return `
          <span class="p-card__prop ${locked ? 'p-card__prop--locked' : ''}" title="${escapeHtml(title)}"
                style="--pc: ${p.color}">
            ${locked ? '<img class="p-card__prop-lock" src="/assets/ownership/lock.png" alt="" />' : ''}
          </span>`;
      }).join('');
      return `
        <div class="p-card ${isTurn ? 'p-card--active' : ''} ${p.bankrupt ? 'p-card--out' : ''} ${p.id === this.mySlot ? 'p-card--me' : ''}"
             style="--pc: ${p.color}">
          <div class="p-card__inner">
            <div class="p-card__head">
              <svg class="p-card__mail" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
              <div class="p-card__name">${escapeHtml(p.name)}</div>
            </div>
            <div class="p-card__cash">${formatMoney(p.money)}</div>
            <div class="p-card__capital">Капитал: ${formatMoney(capital)}${jailNote}</div>
            ${props ? `<div class="p-card__props">${props}</div>` : ''}
            ${this.tokenImgHtml(p)}
          </div>
        </div>
      `;
    }).join('');
  }

  ownershipAsset(ownerSlot, side, mortgaged) {
    const sideKey = ['top', 'right', 'bottom', 'left'].includes(side) ? side : 'top';
    if (mortgaged) return `/assets/ownership/dark_${sideKey}.png`;
    const n = (Number(ownerSlot) % 5) + 1; // слоты 0..4 → chip 1..5
    return `/assets/ownership/${n}_${sideKey}.png`;
  }

  renderHouses(state) {
    document.querySelectorAll('[data-houses]').forEach(el => { el.innerHTML = ''; });
    document.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('cell--owned', 'cell--mortgaged');
      c.style.removeProperty('--owner-color');
    });
    document.querySelectorAll('[data-owner]').forEach(el => {
      el.hidden = true;
      el.style.backgroundImage = '';
    });
    document.querySelectorAll('[data-lock]').forEach(el => { el.hidden = true; });

    for (const [cellId, ps] of Object.entries(state.propertyState)) {
      const owner = ps.owner != null ? state.players[ps.owner] : null;
      const cellEl = this.cells[cellId];
      const side = this.cellSide(Number(cellId));

      if (ps.houses > 0 && owner) {
        const container = document.querySelector(`[data-houses="${cellId}"]`);
        if (container) {
          for (let i = 0; i < ps.houses; i++) {
            const house = document.createElement('div');
            house.className = 'house';
            house.style.background = owner.color || '#666';
            container.appendChild(house);
          }
        }
      }

      if (!cellEl || ps.owner == null || !owner) continue;

      const mortgaged = !!ps.mortgaged || !!owner.bankrupt;
      cellEl.classList.add('cell--owned');
      if (mortgaged) cellEl.classList.add('cell--mortgaged');
      cellEl.style.setProperty('--owner-color', owner.color);

      const mark = cellEl.querySelector(`[data-owner="${cellId}"]`);
      if (mark && side !== 'corner') {
        mark.hidden = false;
        mark.style.backgroundImage = `url("${this.ownershipAsset(owner.id, side, mortgaged)}")`;
      }

      const lock = cellEl.querySelector(`[data-lock="${cellId}"]`);
      if (lock && mortgaged) lock.hidden = false;
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
      if (isMyTurn && p) {
        const mortgageable = p.properties.filter(id => {
          const ps = state.propertyState[id];
          const cell = BOARD[id];
          return ps && !ps.mortgaged && (ps.houses || 0) === 0 && cell?.price;
        });
        const unmortgageable = p.properties.filter(id => state.propertyState[id]?.mortgaged);
        if (mortgageable.length || unmortgageable.length) {
          const box = document.createElement('div');
          box.className = 'mortgage-prompt';
          box.innerHTML = `
            ${mortgageable.slice(0, 4).map(id => `
              <button class="btn btn--pass" data-mortgage="${id}">🔒 ${escapeHtml(BOARD[id].name)}</button>
            `).join('')}
            ${unmortgageable.slice(0, 4).map(id => `
              <button class="btn btn--buy" data-unmortgage="${id}">🔓 ${escapeHtml(BOARD[id].name)}</button>
            `).join('')}
          `;
          box.querySelectorAll('[data-mortgage]').forEach(btn => {
            btn.addEventListener('click', () => this.doAction({ type: 'mortgage', cellId: Number(btn.dataset.mortgage) }));
          });
          box.querySelectorAll('[data-unmortgage]').forEach(btn => {
            btn.addEventListener('click', () => this.doAction({ type: 'unmortgage', cellId: Number(btn.dataset.unmortgage) }));
          });
          this.actionArea.appendChild(box);
        }
      }
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

import {
  BOARD, BOARD_SIZE, BRAND_LOGO_SRC, COUNTRY_FLAG_SRC, COUNTRY_LABEL_RU, GROUP_COLORS,
  JAIL_BAIL, AUCTION_STEP, GO_SALARY, getGridPosition, getGroupProperties, playerOwnTint,
} from './config.js';
import { formatMoney, formatPriceShort, sleep } from './utils.js';
import { PHASE } from './game.js';
import { iconHTML, resolveIconSrc } from './icons.js';
import { resolveMovePath } from './animations.js';
import { DiceScene } from './dice3d.js';

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
    this._throwQueue = [];
    this._resizeTimer = null;

    this.boardEl = document.getElementById('board');
    this.playersPanel = document.getElementById('players-panel');
    this.actionArea = document.getElementById('action-area');
    this.gameLog = document.getElementById('game-log');
    this.dieSum = null;
    this.diceStage = document.getElementById('dice-stage');
    this.dice3d = null;
    this.hubTurn = null;

    this.choicePanel = document.getElementById('choice-panel');
    this.ownToast = document.getElementById('own-toast');
    this.companyInfo = document.getElementById('company-info');
    this.gameDialog = document.getElementById('game-dialog');
    this.cellTip = document.getElementById('cell-tip');
    this._cellTipTimer = null;
    this._exitUnlockTimer = null;
    this._dismissedNoticeId = null;
    this._noticeTimer = null;
    this._dealCompose = null;
    this._shareBuy = false;
    this._rentMortgagePick = false;
    this._rentSharesPick = false;
    this._companyInfoOpen = false;

    if (this.diceStage) {
      try {
        this.dice3d = new DiceScene(this.diceStage);
      } catch (err) {
        console.warn('Three.js dice failed:', err);
      }
    }

    this.setupChat();
    this.buildBoard();
    this._syncOrientation();
    this.fitLayout();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.gameDialog && !this.gameDialog.hidden) this.hideGameDialog();
      else if (this._companyInfoOpen) this.hideCompanyInfo();
      else if (this.cellTip && !this.cellTip.hidden) this.hideCellTip();
    });

    const onViewportChange = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this._syncOrientation();
        this.fitLayout();
        this.repositionTokens();
        this.dice3d?.resize();
      }, 80);
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
  }

  /** Portrait → overlay; try landscape lock when API allows */
  _syncOrientation() {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    document.body.classList.toggle('orientation-portrait', portrait);
    const lockEl = document.getElementById('orientation-lock');
    if (lockEl) lockEl.hidden = !portrait || !document.body.classList.contains('is-playing');
    if (!portrait) this.tryLockLandscape();
  }

  tryLockLandscape() {
    const orient = screen.orientation;
    if (!orient || typeof orient.lock !== 'function') return;
    orient.lock('landscape').catch(() => {});
  }

  /** Растягивает эталонную сцену (доска + rail справа) в viewport; единый --ui-scale */
  fitLayout() {
    const shell = document.getElementById('game-layout');
    if (!shell || shell.hidden) return;

    // Portrait: не крутим layout — поверх overlay
    if (document.body.classList.contains('orientation-portrait')) return;

    const gap = 10;
    const REF_RAIL = 220;
    // Делители: mid из SVG-сетки, края — inset дерева на board-frame (не 0/1023)
    // 13×8 → 38 клеток: угол + 11 mid + угол / угол + 6 mid + угол
    // board-frame.png после обрезки края −2px с каждой стороны
    const IMG_W = 1020;
    const IMG_H = 694;
    const REF_STAGE_W = IMG_W + gap + REF_RAIL;
    const REF_STAGE_H = IMG_H;
    const WOOD_X = [11, 151, 216, 282, 347, 412, 477, 542, 608, 672, 738, 803, 868, 1008];
    const WOOD_Y = [11, 152, 218, 283, 348, 413, 478, 544, 683];

    const st = getComputedStyle(shell);
    const padL = parseFloat(st.paddingLeft) || 0;
    const padR = parseFloat(st.paddingRight) || 0;
    const padT = parseFloat(st.paddingTop) || 0;
    const padB = parseFloat(st.paddingBottom) || 0;
    const availW = Math.max(280, shell.clientWidth - padL - padR);
    const availH = Math.max(200, shell.clientHeight - padT - padB);

    const scale = Math.min(availW / REF_STAGE_W, availH / REF_STAGE_H);
    let boardW = Math.max(1, Math.floor(IMG_W * scale));
    let boardH = Math.round(boardW * IMG_H / IMG_W);
    let rail = Math.round(REF_RAIL * (boardW / IMG_W));

    // Поджать округления, чтобы сцена не вылезала из viewport
    while (boardW + gap + rail > availW && boardW > 200) {
      boardW -= 1;
      boardH = Math.round(boardW * IMG_H / IMG_W);
      rail = Math.round(REF_RAIL * (boardW / IMG_W));
    }
    while (boardH > availH && boardW > 200) {
      boardW -= 1;
      boardH = Math.round(boardW * IMG_H / IMG_W);
      rail = Math.round(REF_RAIL * (boardW / IMG_W));
    }

    const sx = boardW / IMG_W;
    const sy = boardH / IMG_H;
    const uiScale = sx;

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
    const boardRadius = Math.max(8, Math.round(16 * uiScale));
    const colCss = colTracks.map((px) => `${px}px`).join(' ');
    const rowCss = rowTracks.map((px) => `${px}px`).join(' ');

    // Центральная кожа (coords после crop −2px края доски)
    const HOLE = { l: 147, t: 148, r: 872, b: 546 };
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
      el.style.setProperty('--board-radius', `${boardRadius}px`);
      el.style.setProperty('--hole-l', `${holeL}px`);
      el.style.setProperty('--hole-t', `${holeT}px`);
      el.style.setProperty('--hole-r', `${holeR}px`);
      el.style.setProperty('--hole-b', `${holeB}px`);
    };
    apply(root);
    apply(this.boardEl);
    root.style.setProperty('--ui-scale', String(uiScale));
    root.style.setProperty('--rail-w', `${rail}px`);
    if (this.boardEl) {
      this.boardEl.style.width = `${boardW}px`;
      this.boardEl.style.height = `${boardH}px`;
      this.boardEl.style.padding = `${padY}px ${padXR}px ${padYB}px ${padX}px`;
      this.boardEl.style.borderRadius = `${boardRadius}px`;
      this.boardEl.style.gridTemplateColumns = colCss;
      this.boardEl.style.gridTemplateRows = rowCss;
    }
    this._logoSize = { w: logoW, h: logoH, corner, cornerBot, cellW, cellH, padX, padY };
    this.dice3d?.resize();
  }

  setupChat() {
    const input = document.getElementById('chat-input');
    const send = document.getElementById('chat-send');
    if (!input || !send) return;

    const submit = () => {
      const text = input.value.trim();
      if (!text || !this.lastState) return;
      this.network?.socket?.emit('chat', { text });
      input.value = '';
    };

    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  paintLogLines(gameLines) {
    if (!this.gameLog) return;
    this.gameLog.innerHTML = gameLines.map(line => {
      const parts = String(line).split('\n').filter(Boolean);
      if (parts.length > 1) {
        return `<div class="log-line log-beat">${parts.map((p, i) =>
          `<div class="${i === 0 ? 'log-beat-title' : 'log-beat-result'}">${escapeHtml(p)}</div>`
        ).join('')}</div>`;
      }
      return `<div class="log-line">${escapeHtml(line)}</div>`;
    }).join('');
    // Лента ходов+чата: новые снизу, скролл за ними
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
      const side = this.cellSide(i);
      if (side !== 'corner') el.classList.add(`cell--side-${side}`);
      if (['go', 'jail', 'parking', 'gotojail', 'chance', 'forcemajeure', 'tax'].includes(cell.type)) {
        el.dataset.tip = '1';
        el.classList.add('cell--tip');
        el.title = 'Подсказка';
      }
      el.innerHTML = this.renderCellHTML(cell, i);
      this.boardEl.appendChild(el);
      this.cells[i] = el;
    }

    this.tokenLayer = document.createElement('div');
    this.tokenLayer.className = 'board__tokens';
    this.boardEl.appendChild(this.tokenLayer);

    this.boardEl.addEventListener('click', (e) => {
      if (document.body.classList.contains('layout-edit')) return;
      const logo = e.target.closest('.cell__logo--clickable[data-info]');
      if (logo) {
        e.preventDefault();
        e.stopPropagation();
        this.showCompanyInfo(Number(logo.dataset.info));
        return;
      }
      const tipEl = e.target.closest('.cell[data-tip]');
      if (tipEl) {
        e.preventDefault();
        e.stopPropagation();
        this.showCellTip(Number(tipEl.dataset.id));
      }
    });
    this.boardEl.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('layout-edit')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const logo = e.target.closest?.('.cell__logo--clickable[data-info]');
      if (logo) {
        e.preventDefault();
        this.showCompanyInfo(Number(logo.dataset.info));
      }
    });
  }

  cellSide(index) {
    // углы 38-клеточной доски: 0 старт, 12 тюрьма, 19 отдых, 31 арест
    if ([0, 12, 19, 31].includes(index)) return 'corner';
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
      const isUtilityMult = cell.type === 'utility' && cell.rent?.[0] != null;
      const priceVal = isUtilityMult
        ? formatPriceShort(cell.rent[0])
        : (cell.price != null ? formatPriceShort(cell.price) : '');
      const flagSrc = COUNTRY_FLAG_SRC[country] || '';
      const flagHtml = flagSrc
        ? `<img class="cell__flag-img" src="${flagSrc}" alt="" />`
        : (cell.flag ? `<span class="cell__flag">${cell.flag}</span>` : '');
      const logoSrc = BRAND_LOGO_SRC[company] || BRAND_LOGO_SRC[cell.brand] || '';
      const logo = logoSrc
        ? `<div class="cell__logo cell__logo--clickable" data-info="${index}" role="button" tabindex="0" title="${escapeHtml(company)}">
             <img class="cell__logo-img" src="${logoSrc}" alt="${escapeHtml(company)}" />
           </div>`
        : `<div class="cell__logo cell__logo--clickable" data-info="${index}" role="button" tabindex="0" title="${escapeHtml(company)}">
             <span class="cell__logo-text">${escapeHtml(company)}</span>
           </div>`;
      const priceEl = priceVal
        ? `<span class="cell__price${isUtilityMult ? ' cell__price--mult' : ''}">
             <span class="cell__price-core">
               <span class="cell__price-val">${priceVal}</span>
               ${isUtilityMult ? '<span class="cell__price-x" aria-hidden="true">×</span>' : ''}
             </span>
           </span>`
        : '';
      const flagEl = `<div class="cell__country-slot">${flagHtml}</div>`;
      const shares = `<div class="cell__shares" data-houses="${index}" aria-label="Акции"></div>`;
      // Абсолютная раскладка внутри клетки (позиции в % — не съезжают при scale)
      body = `${flagEl}${logo}${priceEl}${shares}`;
    } else if (cell.type === 'tax') {
      const pct = cell.taxPercent != null ? `${cell.taxPercent}%` : '6%';
      body = `
        <div class="cell__tax">
          <span class="cell__tax-title">НАЛОГ</span>
          <span class="cell__tax-pct">${escapeHtml(pct)}</span>
        </div>
      `;
    } else if (isCorner || ['go', 'jail', 'parking', 'gotojail'].includes(cell.type)) {
      // Углы (старт / тюрьма / отдых / арест) — только арт с board-frame
      body = '';
    } else if (cell.type === 'chance' || cell.type === 'forcemajeure') {
      const title = cell.type === 'chance' ? 'ШАНС' : 'ФОРС';
      const sub = cell.type === 'chance' ? '' : 'МАЖОР';
      body = `
        <div class="cell__tax cell__special">
          <span class="cell__tax-title">${title}</span>
          ${sub ? `<span class="cell__tax-pct">${sub}</span>` : ''}
        </div>
      `;
    } else {
      body = `
        <span class="cell__name">${escapeHtml(cell.name)}</span>
        ${cell.icon ? iconHTML(cell.icon, 'cell__icon') : ''}
      `;
    }

    const ownerLayer = isCompany
      ? `<div class="cell__owner" data-owner="${index}" data-side="${side === 'corner' ? 'top' : side}" hidden></div>
         <img class="cell__lock" data-lock="${index}" src="/assets/ownership/lock.png" alt="" hidden />`
      : '';

    return `
      ${ownerLayer}
      <div class="cell__body cell__body--${side} ${isCorner ? 'cell__body--corner' : ''}">
        ${body}
      </div>
    `;
  }

  /** Две кнопки вместо ползунка */
  showChoiceButtons({ title, left, right, onLeft, onRight }) {
    if (!this.choicePanel) return;
    this.choicePanel.hidden = false;
    document.querySelector('.hub')?.classList.add('hub--choice');
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
    document.querySelector('.hub')?.classList.remove('hub--choice');
  }

  hideChoiceSlider() {
    this.hideChoiceButtons();
  }

  render(state) {
    if (this.animating) {
      this.pendingState = state;
      // обновляем панели, но позиции фишек — после анимации
      if (state.mySlot !== undefined) this.mySlot = state.mySlot;
      // Не пропускаем броски ботов, пришедшие во время чужой анимации
      const prevSeq = this._animRollSeq ?? this.lastState?.rollSeq ?? 0;
      if ((state.rollSeq || 0) > prevSeq) {
        const lastQ = this._throwQueue[this._throwQueue.length - 1];
        if (!lastQ || lastQ.rollSeq !== state.rollSeq) {
          const fromPrev = lastQ?.state || this.lastState;
          this._throwQueue.push({
            rollSeq: state.rollSeq,
            dice: [...(state.dice || [1, 1])],
            doubles: !!state.doubles,
            movers: this.findMovers(fromPrev, state),
            state,
          });
        }
      }
      this.renderHub(state);
      this.renderPlayers(state);
      this.renderHouses(state);
      this.renderLog(state);
      this.syncTimedUi(state);
      this.syncOwnNotice(state);
      // Не открываем buy/rent/auction во время броска — иначе кости скрываются и анимация срывается
      return;
    }

    const prev = this.lastState;
    if (state.mySlot !== undefined) this.mySlot = state.mySlot;

    const diceChanged = this.diceChanged(prev, state);
    const movers = this.findMovers(prev, state);
    const willAnimate = !!(prev && (diceChanged || movers.length > 0));

    this.renderHub(state);
    this.renderPlayers(state);
    this.renderHouses(state);
    this.renderLog(state);
    this.highlightCurrentCell(state);
    this.syncOwnNotice(state);

    if (!prev) {
      this.syncTimedUi(state);
      this.syncDiceFaces(state);
      this.ensureTokens(state);
      this.snapTokens(state);
      this.renderActions(state);
      this.lastState = state;
      return;
    }

    this.lastState = state;

    // Не гоняем «анимацию хода» на каждый апдейт — иначе сбрасываются меню сделки/залога
    if (!willAnimate) {
      this.syncTimedUi(state);
      this.syncDiceFaces(state);
      this.ensureTokens(state);
      this.layoutTokenStacks(state);
      this.renderActions(state);
      return;
    }

    // Сразу в режим броска — иначе hub--rent прячет кости до старта анимации
    this.runTurnAnimations(state, { diceChanged, movers });
  }

  diceChanged(prev, state) {
    if (!prev) return false;
    if ((state.rollSeq || 0) !== (prev.rollSeq || 0)) return true;
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
    this._animRollSeq = state.rollSeq || 0;
    const hub = document.querySelector('.hub');
    hub?.classList.add('hub--throwing');
    // Во время броска/хода прячем кнопки, но не трогаем локальные флаги меню
    const savedDeal = this._dealCompose;
    const savedShare = this._shareBuy;
    const savedMortgage = this._rentMortgagePick;
    const savedSharesPick = this._rentSharesPick;
    this.actionArea.innerHTML = `<div class="wait-turn">Ход…</div>`;
    // Показать кости до throw (hub--rent иначе display:none → WebGL 0×0)
    this.syncTimedUi(state);
    this.dice3d?.resize();

    try {
      if (diceChanged) {
        await this.animateDiceThrow(state.dice, state.doubles);
      } else {
        this.syncDiceFaces(state);
      }

      this.ensureTokens(state);

      const diceSum = (state.dice?.[0] || 0) + (state.dice?.[1] || 0);
      for (const m of movers) {
        await this.animateTokenMove(m.id, m.from, m.to, diceSum, m.player);
      }

      this.layoutTokenStacks(state);

      // Доигрываем броски, пришедшие во время анимации (боты)
      while (this._throwQueue.length) {
        const job = this._throwQueue.shift();
        this._animRollSeq = job.rollSeq || this._animRollSeq;
        this.lastState = job.state;
        await this.animateDiceThrow(job.dice, job.doubles);
        this.ensureTokens(job.state);
        const sum = (job.dice?.[0] || 0) + (job.dice?.[1] || 0);
        for (const m of job.movers || []) {
          await this.animateTokenMove(m.id, m.from, m.to, sum, m.player);
        }
        this.layoutTokenStacks(job.state);
      }
    } finally {
      const doneSeq = this._animRollSeq;
      this.animating = false;
      this._animRollSeq = null;
      hub?.classList.remove('hub--throwing');
      this._dealCompose = savedDeal;
      this._shareBuy = savedShare;
      this._rentMortgagePick = savedMortgage;
      this._rentSharesPick = savedSharesPick;
      // Сообщаем серверу: анимация доиграна — можно commitMove
      if (doneSeq != null && this.network?.sendAction) {
        this.network.sendAction({ type: 'animDone', rollSeq: doneSeq }).catch(() => {});
      }
      const next = this.pendingState;
      this.pendingState = null;
      if (next) {
        this.render(next);
      } else {
        this.syncTimedUi(state);
        this.renderActions(state);
        this.highlightCurrentCell(state);
      }
    }
  }

  syncDiceFaces(state) {
    if (!this.dice3d) return;
    this.dice3d.setValues(
      clampDie(state.dice?.[0]),
      clampDie(state.dice?.[1]),
      { doubles: !!state.doubles },
    );
  }

  async animateDiceThrow(dice, doubles = false) {
    if (!this.dice3d) return;
    const d = Array.isArray(dice) ? dice : [1, 1];
    await this.dice3d.throw(
      clampDie(d[0]),
      clampDie(d[1]),
      { doubles: !!doubles },
    );
  }

  ensureTokens(state) {
    const alive = new Set();
    for (const p of state.players) {
      if (p.bankrupt || p.left) {
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
      el.innerHTML = `<img src="${img}" alt="" draggable="false" />`;
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

  renderHub(_state) {
    // Капитал / компании / наличные — только на карточках справа (как в Club)
  }

  syncOwnNotice(state) {
    const hub = document.querySelector('.hub');
    const notice = state?.notice;
    if (!this.ownToast) return;

    if (!notice || notice.type !== 'own' || notice.id === this._dismissedNoticeId) {
      if (!notice) this._dismissedNoticeId = null;
      this.ownToast.hidden = true;
      this.ownToast.innerHTML = '';
      hub?.classList.remove('hub--own');
      return;
    }

    if (this.ownToast.dataset.noticeId === String(notice.id)) {
      hub?.classList.add('hub--own');
      this.ownToast.hidden = false;
      return;
    }

    this.ownToast.dataset.noticeId = String(notice.id);
    this.ownToast.innerHTML = `
      <div class="own-toast__ring" aria-hidden="true">
        <svg class="own-toast__svg" viewBox="0 0 36 36">
          <circle class="own-toast__track" cx="18" cy="18" r="15.5" />
          <circle class="own-toast__progress" cx="18" cy="18" r="15.5" />
        </svg>
        <span class="own-toast__check">✓</span>
      </div>
      <p class="own-toast__title">Поздравляем, ${escapeHtml(notice.playerName)}!</p>
      <p class="own-toast__text">Вы стали владельцем контрольного пакета (51%) акций компании ${escapeHtml(notice.company)}</p>
    `;
    this.ownToast.hidden = false;
    hub?.classList.add('hub--own');

    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      this._dismissedNoticeId = notice.id;
      this.ownToast.hidden = true;
      this.ownToast.innerHTML = '';
      delete this.ownToast.dataset.noticeId;
      hub?.classList.remove('hub--own');
    }, 3800);
  }

  renderPlayers(state) {

    this.playersPanel.innerHTML = state.players.map((p, i) => {
      const capital = this.calcCapital(p, state);
      const isTurn = i === state.currentPlayerIndex && !p.bankrupt;
      const jailNote = p.inJail && !p.bankrupt ? ' · тюр.' : '';
      const companies = (p.properties || []).length;
      // Страны — только полностью собранные группы
      const groups = new Set(
        (p.properties || []).map(id => BOARD[id]?.group).filter(Boolean),
      );
      let countries = 0;
      for (const group of groups) {
        const props = getGroupProperties(group);
        if (!props.length) continue;
        const complete = props.every(c => (
          state.propertyState[c.id]?.owner === p.id
          && !state.propertyState[c.id]?.mortgaged
        ));
        if (complete) countries += 1;
      }
      const displayName = escapeHtml(
        p.isBot && !/^Бот\s*-/.test(p.name) ? `Бот - ${p.name}` : p.name,
      );
      let moneyBlock;
      if (p.left) {
        moneyBlock = `<div class="p-card__cash p-card__cash--out">Покинул</div>`;
      } else if (p.bankrupt) {
        moneyBlock = `<div class="p-card__cash p-card__cash--out">Банкрот</div>`;
      } else if (p.disconnected) {
        moneyBlock = `<div class="p-card__cash p-card__cash--out">Нет сети…</div>
            <div class="p-card__capital">Капитал: ${formatMoney(capital)}${jailNote}</div>
            <div class="p-card__stats">
              <div>Компаний: ${companies}</div>
              <div>Страны: ${countries}</div>
            </div>`;
      } else {
        moneyBlock = `<div class="p-card__cash">${formatMoney(p.money)}</div>
            <div class="p-card__capital">Капитал: ${formatMoney(capital)}${jailNote}</div>
            <div class="p-card__stats">
              <div>Компаний: ${companies}</div>
              <div>Страны: ${countries}</div>
            </div>`;
      }
      const outClass = (p.bankrupt || p.left || p.disconnected) ? 'p-card--out' : '';
      return `
        <div class="p-card ${isTurn ? 'p-card--active' : ''} ${outClass} ${p.left ? 'p-card--left' : ''} ${p.id === this.mySlot ? 'p-card--me' : ''}"
             style="--pc: ${p.color}">
          <div class="p-card__inner">
            <div class="p-card__head">
              <div class="p-card__name">${displayName}${p.left ? ' · выход' : p.disconnected ? ' · сеть' : ''}</div>
            </div>
            ${moneyBlock}
            ${p.left ? '' : this.tokenImgHtml(p)}
          </div>
        </div>
      `;
    }).join('');
  }

  hideCompanyInfo() {
    this._companyInfoOpen = false;
    if (this.companyInfo) {
      this.companyInfo.hidden = true;
      this.companyInfo.innerHTML = '';
    }
    document.querySelector('.hub')?.classList.remove('hub--company-info');
  }

  hideGameDialog() {
    if (this._exitUnlockTimer) {
      clearTimeout(this._exitUnlockTimer);
      this._exitUnlockTimer = null;
    }
    if (this.gameDialog) {
      this.gameDialog.hidden = true;
      this.gameDialog.innerHTML = '';
    }
  }

  hideCellTip() {
    if (this._cellTipTimer) {
      clearTimeout(this._cellTipTimer);
      this._cellTipTimer = null;
    }
    if (this.cellTip) {
      this.cellTip.hidden = true;
      this.cellTip.innerHTML = '';
    }
  }

  /** Игровой диалог выхода: «Выход» 3с серый, «Остаюсь», клик снаружи */
  showExitDialog({ isSpectator, onConfirm }) {
    if (!this.gameDialog) return;
    this.hideCellTip();
    this.hideCompanyInfo();
    const text = isSpectator
      ? 'Выйти из режима наблюдения?'
      : 'Покинуть игру? Ваши компании станут свободными.';
    this.gameDialog.hidden = false;
    this.gameDialog.innerHTML = `
      <div class="game-dialog__card" role="dialog" aria-modal="true">
        <p class="game-dialog__text">${escapeHtml(text)}</p>
        <div class="game-dialog__btns">
          <button type="button" class="btn btn--club-muted" id="dialog-stay">Остаюсь</button>
          <button type="button" class="btn btn--club game-dialog__exit" id="dialog-exit" disabled>Выход</button>
        </div>
      </div>
    `;
    const exitBtn = document.getElementById('dialog-exit');
    const stayBtn = document.getElementById('dialog-stay');
    stayBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideGameDialog();
    });
    exitBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (exitBtn.disabled) return;
      this.hideGameDialog();
      onConfirm?.();
    });
    // фон — со следующего кадра, чтобы клик открытия не закрыл диалог сразу
    this.gameDialog.onclick = null;
    requestAnimationFrame(() => {
      if (this.gameDialog?.hidden) return;
      this.gameDialog.onclick = (e) => {
        if (e.target === this.gameDialog) this.hideGameDialog();
      };
    });
    if (this._exitUnlockTimer) clearTimeout(this._exitUnlockTimer);
    this._exitUnlockTimer = setTimeout(() => {
      this._exitUnlockTimer = null;
      if (!exitBtn || this.gameDialog?.hidden) return;
      exitBtn.disabled = false;
      exitBtn.classList.add('is-ready');
    }, 3000);
  }

  cellTipText(cellId) {
    const cell = BOARD[cellId];
    if (!cell) return '';
    switch (cell.type) {
      case 'go':
        return `Старт: проход или остановка — получите ${formatMoney(GO_SALARY)}.`;
      case 'jail':
        return 'Тюрьма: просто гостите, если попали мимо. Из заключения — дубль или залог.';
      case 'parking':
        return 'Отдых: ничего не происходит, просто пропускаете ход клетки.';
      case 'gotojail':
        return 'Арест: сразу отправляетесь в тюрьму без зарплаты со Старта.';
      case 'chance':
        return 'Шанс: случайная карта — бонус, перемещение или небольшое событие.';
      case 'forcemajeure':
        return 'Форс-мажор: случайный штраф, ремонт или неприятность для бизнеса.';
      case 'tax':
        return `Налог ${cell.taxPercent ?? 6}%: платите долю от своего капитала.`;
      default:
        return cell.name || '';
    }
  }

  showCellTip(cellId) {
    if (!this.cellTip) return;
    const text = this.cellTipText(cellId);
    if (!text) return;
    this.hideCellTip();
    this.cellTip.hidden = false;
    this.cellTip.innerHTML = `
      <div class="cell-tip__card">
        <p class="cell-tip__text">${escapeHtml(text)}</p>
      </div>
    `;
    this.cellTip.onclick = (e) => {
      if (e.target === this.cellTip || e.target.closest('.cell-tip__card')) this.hideCellTip();
    };
    this._cellTipTimer = setTimeout(() => this.hideCellTip(), 4500);
  }

  showCompanyInfo(cellId) {
    const cell = BOARD[cellId];
    if (!cell || !this.companyInfo) return;
    if (cell.type !== 'property' && cell.type !== 'utility' && cell.type !== 'railroad') return;

    const state = this.lastState;
    const country = COUNTRY_LABEL_RU[cell.country] || cell.country || '';
    const company = cell.name || cell.brand || '';
    const logoSrc = BRAND_LOGO_SRC[company] || BRAND_LOGO_SRC[cell.brand] || '';
    const groupCells = cell.group ? getGroupProperties(cell.group) : [];
    const logoHtml = logoSrc
      ? `<img class="company-info__logo-img" src="${logoSrc}" alt="" />`
      : `<span class="company-info__logo-text">${escapeHtml(company)}</span>`;

    let rentRows = '';
    let bonusHtml = '';
    let shareCostHtml = '';

    if (cell.type === 'utility' || cell.diceRent) {
      const one = cell.rent?.[0] || 0;
      const two = cell.rent?.[1] || one;
      rentRows = `
        <div class="company-info__row">
          <img class="company-info__share-icon" src="${this.shareSpriteSrc('ko', 1)}" alt="" />
          <span>1 комп.</span>
          <strong>${formatPriceShort(one)}×</strong>
        </div>
        <div class="company-info__row">
          <img class="company-info__share-icon" src="${this.shareSpriteSrc('ko', 2)}" alt="" />
          <span>2 комп.</span>
          <strong>${formatPriceShort(two)}×</strong>
        </div>`;
      bonusHtml = `<p class="company-info__bonus">Страна: ${formatPriceShort(two)} за очко костей</p>`;
      shareCostHtml = `<p class="company-info__meta">Без акций · аренда = кости × тариф</p>`;
    } else if (cell.noShares || cell.group === 'cn') {
      const labels = ['1 комп.', '2 комп.', '3 комп.', '4 комп.'];
      rentRows = (cell.rent || []).slice(0, 4).map((r, i) => `
        <div class="company-info__row">
          <img class="company-info__share-icon" src="${this.shareSpriteSrc('chn', i + 1)}" alt="" />
          <span>${labels[i] || `${i + 1}`}</span>
          <strong>${formatPriceShort(r)}</strong>
        </div>`).join('');
      bonusHtml = `<p class="company-info__bonus">Страна (${groupCells.length}): ${formatPriceShort(cell.rent?.[groupCells.length - 1] || cell.rent?.[cell.rent.length - 1] || 0)}</p>`;
      shareCostHtml = `<p class="company-info__meta">Без акций · аренда от числа компаний</p>`;
    } else {
      const base = cell.rent?.[0] || 0;
      const mono = base * 2;
      shareCostHtml = cell.houseCost != null
        ? `<p class="company-info__meta">Акция: <strong>${formatPriceShort(cell.houseCost)}</strong> · нужна вся страна</p>`
        : '';
      bonusHtml = `<p class="company-info__bonus">Страна без акций: ×2 → <strong>${formatPriceShort(mono)}</strong></p>`;
      rentRows = `
        <div class="company-info__row company-info__row--base">
          <span class="company-info__share-empty">0</span>
          <span>Без акций</span>
          <strong>${formatPriceShort(base)}</strong>
        </div>
        <div class="company-info__row company-info__row--base">
          <span class="company-info__share-empty">★</span>
          <span>Страна</span>
          <strong>${formatPriceShort(mono)}</strong>
        </div>`
        + [1, 2, 3, 4, 5].map((n) => {
          const src = this.shareSpriteSrc('leaf', n, false);
          const label = n === 5 ? '5 (51%)' : `${n} акц.`;
          return `
            <div class="company-info__row">
              <img class="company-info__share-icon" src="${src}" alt="" />
              <span>${label}</span>
              <strong>${formatPriceShort(cell.rent?.[n] || 0)}</strong>
            </div>`;
        }).join('');
    }

    let currentPay = '';
    if (state?.propertyState?.[cellId]) {
      const ps = state.propertyState[cellId];
      if (ps.owner != null && !ps.mortgaged) {
        const owner = state.players[ps.owner];
        let amount = 0;
        if (cell.type === 'utility' || cell.diceRent) {
          const n = this.countOwnedInGroup(state, ps.owner, cell.group);
          const perPip = cell.rent?.[n >= 2 ? 1 : 0] || 0;
          currentPay = `<p class="company-info__current">Сейчас: ${escapeHtml(owner?.name || 'игрок')} · ${formatPriceShort(perPip)}×кости</p>`;
        } else if (cell.noShares || cell.group === 'cn') {
          const n = this.countOwnedInGroup(state, ps.owner, cell.group);
          const idx = Math.max(0, Math.min(n - 1, (cell.rent?.length || 1) - 1));
          amount = cell.rent?.[idx] || 0;
          currentPay = `<p class="company-info__current">Сейчас: <strong>${formatPriceShort(amount)}</strong> · ${escapeHtml(owner?.name || 'игрок')}</p>`;
        } else {
          const houses = ps.houses || 0;
          const hasMono = groupCells.length > 0 && groupCells.every(c => (
            state.propertyState[c.id]?.owner === ps.owner
            && !state.propertyState[c.id]?.mortgaged
          ));
          const baseRent = cell.rent?.[0] || 0;
          amount = houses > 0 ? (cell.rent?.[houses] || 0) : (hasMono ? baseRent * 2 : baseRent);
          currentPay = `<p class="company-info__current">Сейчас: <strong>${formatPriceShort(amount)}</strong> · ${escapeHtml(owner?.name || 'игрок')}</p>`;
        }
      } else if (ps.mortgaged) {
        currentPay = `<p class="company-info__current">В залоге — без аренды</p>`;
      }
    }

    this._companyInfoOpen = true;
    this.hideCellTip();
    this.hideGameDialog();
    this.companyInfo.hidden = false;
    this.companyInfo.innerHTML = `
      <div class="company-info__card">
        <button type="button" class="company-info__close" id="company-info-close" aria-label="Закрыть">×</button>
        <div class="company-info__head">
          <div class="company-info__logo">${logoHtml}</div>
          <div class="company-info__titles">
            <p class="company-info__name">${escapeHtml(company)}</p>
            ${country ? `<p class="company-info__country">${escapeHtml(country)}</p>` : ''}
          </div>
        </div>
        ${cell.price != null ? `<p class="company-info__meta">Компания: <strong>${formatPriceShort(cell.price)}</strong></p>` : ''}
        ${shareCostHtml}
        ${bonusHtml}
        <div class="company-info__list">
          <p class="company-info__list-title">Оплата при наступании</p>
          ${rentRows}
        </div>
        ${currentPay}
      </div>
    `;
    document.getElementById('company-info-close')?.addEventListener('click', () => this.hideCompanyInfo());
    this.companyInfo.onclick = (e) => {
      if (e.target === this.companyInfo) this.hideCompanyInfo();
    };
  }

  /** Спрайт акций / маркеров страны на клетке */
  shareSpriteSrc(kind, count, vertical) {
    const n = Math.max(1, Math.min(Number(count) || 1, kind === 'ko' ? 2 : kind === 'chn' ? 4 : 5));
    if (kind === 'leaf') {
      if (n >= 5) return vertical ? '/assets/icons/shares/gold-v.png' : '/assets/icons/shares/gold.png';
      return `/assets/icons/shares/leaf-${n}${vertical ? 'v' : ''}.png`;
    }
    if (kind === 'chn') return `/assets/icons/shares/chn-${n}.png`;
    if (kind === 'ko') return `/assets/icons/shares/ko-${n}.png`;
    return '';
  }

  countOwnedInGroup(state, ownerId, group) {
    return BOARD.filter(c => (
      c.group === group
      && state.propertyState[c.id]?.owner === ownerId
      && !state.propertyState[c.id]?.mortgaged
    )).length;
  }

  paintShareMarker(container, src, countClass) {
    if (!container || !src) return;
    container.innerHTML = `<img class="share-mark ${countClass || ''}" src="${src}" alt="" draggable="false" />`;
  }

  renderHouses(state) {
    document.querySelectorAll('[data-houses]').forEach(el => { el.innerHTML = ''; });
    document.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('cell--owned', 'cell--mortgaged');
      c.style.removeProperty('--owner-color');
      c.style.removeProperty('--own-tint');
    });
    document.querySelectorAll('[data-owner]').forEach(el => {
      el.hidden = true;
      el.style.removeProperty('--own-tint');
    });
    document.querySelectorAll('[data-lock]').forEach(el => { el.hidden = true; });

    for (const [cellId, ps] of Object.entries(state.propertyState)) {
      const owner = ps.owner != null ? state.players[ps.owner] : null;
      const cellEl = this.cells[cellId];
      const side = this.cellSide(Number(cellId));
      const cell = BOARD[Number(cellId)];
      const vertical = side === 'left' || side === 'right';
      const container = document.querySelector(`[data-houses="${cellId}"]`);

      if (owner && cell && !ps.mortgaged) {
        if (cell.group === 'cn') {
          const n = this.countOwnedInGroup(state, owner.id, 'cn');
          if (n > 0) {
            this.paintShareMarker(container, this.shareSpriteSrc('chn', n, false), `share-mark--chn share-mark--n${n}`);
          }
        } else if (cell.group === 'kr') {
          const n = this.countOwnedInGroup(state, owner.id, 'kr');
          if (n > 0) {
            this.paintShareMarker(container, this.shareSpriteSrc('ko', n, false), `share-mark--ko share-mark--n${n}`);
          }
        } else if ((ps.houses || 0) > 0) {
          const n = Math.min(5, ps.houses);
          this.paintShareMarker(
            container,
            this.shareSpriteSrc('leaf', n, vertical),
            `share-mark--leaf share-mark--n${n}${n >= 5 ? ' share-mark--gold' : ''}`,
          );
        }
      }

      if (!cellEl || ps.owner == null || !owner) continue;

      const mortgaged = !!ps.mortgaged || !!owner.bankrupt;
      cellEl.classList.add('cell--owned');
      if (mortgaged) cellEl.classList.add('cell--mortgaged');
      cellEl.style.setProperty('--owner-color', owner.color);

      const mark = cellEl.querySelector(`[data-owner="${cellId}"]`);
      if (mark && side !== 'corner') {
        const sideKey = ['top', 'right', 'bottom', 'left'].includes(side) ? side : 'top';
        mark.hidden = false;
        mark.dataset.side = sideKey;
        mark.style.setProperty('--own-tint', playerOwnTint(owner, sideKey));
      }

      const lock = cellEl.querySelector(`[data-lock="${cellId}"]`);
      if (lock && mortgaged) lock.hidden = false;
    }
  }

  async doAction(action) {
    const res = await this.network.sendAction(action);
    if (!res?.ok) console.warn('Action failed:', res?.error);
    return res;
  }

  /** Только слот текущего хода видит меню покупки/долга/акций */
  isCurrentActor(state) {
    if (state?.isSpectator || this.isSpectator) return false;
    const me = state?.players?.[state.mySlot];
    return state?.mySlot != null
      && state.mySlot === state.currentPlayerIndex
      && me
      && !me.bankrupt
      && !me.left;
  }

  renderActions(state) {
    this.isSpectator = !!state.isSpectator;
    document.body.classList.toggle('is-spectator', this.isSpectator);
    const p = state.players[state.currentPlayerIndex];
    const isActor = this.isCurrentActor(state);
    this.actionArea.innerHTML = '';

    if (state.isSpectator) {
      this._dealCompose = null;
      this._shareBuy = false;
      if (state.phase === PHASE.GAME_OVER) {
        this.actionArea.innerHTML = `
          <div class="winner-banner">🏆 ${escapeHtml(state.winner?.name || '—')} победил!</div>
          <p class="spectator-banner">Режим наблюдения</p>
        `;
        return;
      }
      const turnName = escapeHtml(p?.name || '—');
      this.actionArea.innerHTML = `
        <p class="spectator-banner">👁 Наблюдение · ход: ${turnName}</p>
      `;
      return;
    }

    if (state.phase === PHASE.GAME_OVER) {
      this._dealCompose = null;
      const won = state.winner?.id === this.mySlot;
      this.actionArea.innerHTML = `
        <div class="winner-banner">${won ? '🏆 Вы победили!' : `🏆 ${state.winner?.name} победил!`}</div>
        <button class="btn btn--roll" onclick="location.reload()">Играть снова</button>
      `;
      return;
    }

    // Сделка — только участникам (от кого / кому)
    if (state.deal) {
      this._dealCompose = null;
      if (state.isDealParty) {
        this.renderDealPending(state);
      } else {
        this.actionArea.innerHTML = `<div class="wait-turn">Идёт сделка…</div>`;
      }
      return;
    }

    // Аукцион видят все участники комнаты (свои кнопки — по правам)
    if (state.phase === PHASE.AUCTION && state.auction) {
      this._dealCompose = null;
      this.renderAuctionActions(state);
      return;
    }

    // Покупка / долг / акции — строго только текущему игроку
    if (!isActor || state.phase === PHASE.MOVING) {
      this._dealCompose = null;
      this._shareBuy = false;
      this._rentMortgagePick = false;
      this._rentSharesPick = false;
      this.actionArea.innerHTML = `<div class="wait-turn">Ход игрока <strong>${escapeHtml(p?.name || '')}</strong></div>`;
      return;
    }

    if (
      state.phase === PHASE.ACTION
      && ['rent', 'tax', 'force'].includes(state.pendingAction?.type)
    ) {
      this._dealCompose = null;
      this.renderRentActions(state);
      return;
    }

    if (state.phase === PHASE.ACTION && state.pendingAction?.type === 'buy') {
      this._dealCompose = null;
      this.renderBuyActions(state);
      return;
    }

    if (p.bankrupt) return;

    if (state.phase === PHASE.ROLL) {
      if (this._dealCompose || state.dealUiOpen) {
        if (!this._dealCompose) {
          this._dealCompose = {
            step: 'partner', toId: null, offerMoney: 0, askMoney: 0, offerCells: [], askCells: [],
          };
        }
        this.renderDealCompose(state);
        return;
      }
      if (this._shareBuy || state.shareUiOpen) {
        this._shareBuy = true;
        this.renderShareBuy(state);
        return;
      }
      this.renderRollActions(state);
      return;
    }

    if (state.phase === PHASE.BUILD && state.pendingAction?.type === 'build') {
      this.renderShareBuy(state, state.pendingAction.options);
      return;
    }

    // Ход переключается автоматически — END почти не показывается
    if (state.phase === PHASE.END) {
      this.actionArea.innerHTML = `<div class="wait-turn">Переход хода…</div>`;
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

  /** Локальные меню, которые нельзя сбрасывать таймером/синком */
  isActionFormOpen(state = this.lastState) {
    if (!this.isCurrentActor(state)) {
      return !!(state?.isDealParty && state?.deal);
    }
    return !!(
      this._dealCompose
      || this._shareBuy
      || this._rentMortgagePick
      || this._rentSharesPick
      || state?.dealUiOpen
      || state?.shareUiOpen
    );
  }

  turnLeftMs(state) {
    if (state.deal?.endsAt != null) return Math.max(0, state.deal.endsAt - Date.now());
    if (state.turnEndsAt != null) return Math.max(0, state.turnEndsAt - Date.now());
    if (state.turnPauseLeftMs != null) return Math.max(0, state.turnPauseLeftMs);
    if (state.pendingAction?.endsAt != null) return Math.max(0, state.pendingAction.endsAt - Date.now());
    if (state.auction?.endsAt != null) return Math.max(0, state.auction.endsAt - Date.now());
    return 0;
  }

  syncTimedUi(state) {
    const hub = document.querySelector('.hub');
    const throwing = !!this.animating;
    const isAuction = !throwing && state.phase === PHASE.AUCTION && state.auction;
    const actor = this.isCurrentActor(state);
    // Меню покупки/долга/акций — только у того, чей ход
    const isRent = !throwing && actor && state.phase === PHASE.ACTION && (
      ['rent', 'tax', 'force'].includes(state.pendingAction?.type)
    );
    const isBuy = !throwing && actor && state.phase === PHASE.ACTION && state.pendingAction?.type === 'buy';
    const isRollTimed = !throwing && actor && state.phase === PHASE.ROLL && !state.deal;
    const isDeal = !throwing && !!state.deal && !!state.isDealParty;
    const myShareMenu = !!(actor && (this._shareBuy || state.shareUiOpen));
    const myDealMenu = !!(actor && (this._dealCompose || state.dealUiOpen));
    const menuOpen = !throwing && !!(
      isRent || isBuy || isDeal || myDealMenu || myShareMenu
    );
    // Кнопки хода (бросок/сделка/акции) — без костей, иначе меню обрезается
    const rollMenu = !!(isRollTimed && !menuOpen);
    hub?.classList.toggle('hub--throwing', throwing);
    hub?.classList.toggle('hub--auction', !!isAuction);
    hub?.classList.toggle('hub--rent', menuOpen);
    hub?.classList.toggle('hub--roll-timed', rollMenu);

    if (!isRent) {
      this._rentMortgagePick = false;
      this._rentSharesPick = false;
    }

    // Меню сделки/акций: только у текущего игрока; чужим флаги не поднимаем
    if (state.phase !== PHASE.ROLL || state.deal || !actor) {
      this._dealCompose = null;
      this._shareBuy = false;
    } else {
      if (state.dealUiOpen && !this._dealCompose) {
        this._dealCompose = {
          step: 'partner', toId: null, offerMoney: 0, askMoney: 0, offerCells: [], askCells: [],
        };
      }
      if (state.shareUiOpen) this._shareBuy = true;
      // !shareUiOpen / !dealUiOpen — НЕ сбрасываем: клик ставит флаг до ответа сервера
    }

    const uiOpen = this.isActionFormOpen(state);
    const timed = isAuction || isRent || isBuy || isRollTimed || isDeal || uiOpen;
    if (!timed) {
      clearInterval(this._auctionTick);
      this._auctionTick = null;
      return;
    }
    if (!this._auctionTick) {
      this._auctionTick = setInterval(() => {
        const s = this.lastState;
        if (!s) return;
        // Только цифры таймера — полный re-render убивает :hover и кнопки мерцают
        this.refreshFlipTimers(s);
      }, 250);
    }
  }

  refreshFlipTimers(state) {
    const timer = this.actionArea?.querySelector('.flip-timer');
    if (!timer) return;
    const leftMs = this.turnLeftMs(state);
    const total = Math.max(0, Math.ceil(leftMs / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const chars = [...mm, ...ss];
    timer.setAttribute('aria-label', `${mm}:${ss}`);
    const digits = timer.querySelectorAll('.flip-timer__digit');
    digits.forEach((el, i) => {
      const next = chars[i];
      if (!next || el.dataset.val === next) return;
      this.flipDigit(el, next);
    });
  }

  setFlipDigitFace(el, val) {
    const v = String(val);
    el.dataset.val = v;
    const base = el.querySelector('.flip-timer__base');
    const top = el.querySelector('.flip-timer__top');
    const bottom = el.querySelector('.flip-timer__bottom');
    if (base) base.textContent = v;
    if (top) top.innerHTML = `<span>${v}</span>`;
    if (bottom) bottom.innerHTML = `<span>${v}</span>`;
  }

  /** Перелистывание одной цифры flip-clock */
  flipDigit(el, nextVal) {
    const prev = el.dataset.val ?? '0';
    if (String(prev) === String(nextVal)) return;
    if (el.classList.contains('is-flipping')) {
      el.querySelector('.flip-timer__flap')?.remove();
      el.classList.remove('is-flipping');
      this.setFlipDigitFace(el, nextVal);
      return;
    }

    const top = el.querySelector('.flip-timer__top');
    const bottom = el.querySelector('.flip-timer__bottom');
    const base = el.querySelector('.flip-timer__base');
    // Сверху сразу новая, снизу старая — flap перекидывает
    if (base) base.textContent = nextVal;
    if (top) top.innerHTML = `<span>${nextVal}</span>`;
    if (bottom) bottom.innerHTML = `<span>${prev}</span>`;
    el.dataset.val = String(nextVal);

    const flap = document.createElement('span');
    flap.className = 'flip-timer__flap';
    flap.innerHTML = `
      <span class="flip-timer__flap-front"><span>${prev}</span></span>
      <span class="flip-timer__flap-back"><span>${nextVal}</span></span>
    `;
    el.appendChild(flap);
    el.classList.add('is-flipping');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (bottom) bottom.innerHTML = `<span>${nextVal}</span>`;
      flap.remove();
      el.classList.remove('is-flipping');
    };
    flap.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 520);
  }

  renderRollActions(state) {
    const p = state.players[state.currentPlayerIndex];
    const canDeal = !!state.canDeal;
    const canBuyShares = !!state.canBuyShares;
    const leftMs = this.turnLeftMs(state);

    this.actionArea.innerHTML = `
      <div class="roll-panel">
        <div class="roll-panel__btns">
          <button type="button" class="btn btn--roll" id="btn-roll">
            ${p.inJail ? 'ТЮРЬМА: ВЫБРАТЬ' : 'БРОСИТЬ КОСТИ'}
          </button>
          ${canDeal ? `
            <button type="button" class="btn btn--roll" id="btn-deal">
              ПРЕДЛОЖИТЬ СДЕЛКУ
            </button>
          ` : ''}
          ${canBuyShares ? `
            <button type="button" class="btn btn--roll" id="btn-shares">
              КУПИТЬ АКЦИИ
            </button>
          ` : ''}
        </div>
        ${this.flipTimerHtml(leftMs)}
      </div>
    `;

    document.getElementById('btn-roll')?.addEventListener('click', () => {
      const btn = document.getElementById('btn-roll');
      if (p.inJail && p.money >= JAIL_BAIL) {
        this.showChoiceButtons({
          title: 'Тюрьма: выберите действие',
          left: 'Бросить кубики',
          right: `Залог ${formatMoney(JAIL_BAIL)}`,
          onLeft: () => {
            if (btn) btn.disabled = true;
            this.doAction({ type: 'roll' });
          },
          onRight: () => {
            if (btn) btn.disabled = true;
            this.doAction({ type: 'payJailBail' });
          },
        });
        return;
      }
      if (btn) btn.disabled = true;
      this.doAction({ type: 'roll' });
    });

    document.getElementById('btn-deal')?.addEventListener('click', async () => {
      this._shareBuy = false;
      this._dealCompose = { step: 'partner', toId: null, offerMoney: 0, askMoney: 0, offerCells: [], askCells: [] };
      // Сразу рисуем меню — не ждём сеть (иначе тик таймера перетирает экран)
      this.renderDealCompose(this.lastState || state);
      await this.doAction({ type: 'beginDealUi' });
      if (this._dealCompose && (this.lastState || state)?.phase === PHASE.ROLL) {
        this.renderDealCompose(this.lastState || state);
      }
    });

    document.getElementById('btn-shares')?.addEventListener('click', async () => {
      this._dealCompose = null;
      this._shareBuy = true;
      this.renderShareBuy(this.lastState || state);
      await this.doAction({ type: 'beginShareUi' });
      if (this._shareBuy && (this.lastState || state)?.phase === PHASE.ROLL) {
        this.renderShareBuy(this.lastState || state);
      }
    });
  }

  renderShareBuy(state, optionIds = null) {
    const options = optionIds
      ? optionIds.map(id => {
          const cell = BOARD[id];
          const ps = state.propertyState[id];
          return {
            cellId: id,
            name: cell?.name || '',
            price: cell?.houseCost || 0,
            houses: ps?.houses || 0,
            max: 5,
          };
        })
      : (state.shareBuyOptions || []);
    const me = state.players.find(pl => pl.id === this.mySlot);

    const leftMs = this.turnLeftMs(state);
    this.actionArea.innerHTML = `
      <div class="deal-panel">
        <p class="deal-panel__title">Купить акции</p>
        <p class="deal-panel__hint">1 акция за ход · у вас ${formatMoney(me?.money || 0)}</p>
        <div class="deal-panel__list">
          ${options.length
            ? options.map(o => `
                <button type="button" class="btn btn--club" data-buy-share="${o.cellId}">
                  ${escapeHtml(o.name)} · ${o.houses}/${o.max} · ${formatMoney(o.price)}
                </button>
              `).join('')
            : `<p class="deal-empty">${(state.sharesBoughtThisTurn || 0) >= 1 ? 'На этот ход акция уже куплена' : 'Нечего покупать'}</p>`}
        </div>
        <button type="button" class="btn btn--club-muted" id="btn-shares-done">Готово</button>
        ${state.phase === PHASE.ROLL ? this.flipTimerHtml(leftMs) : ''}
      </div>
    `;

    this.actionArea.querySelectorAll('[data-buy-share]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await this.doAction({ type: 'build', cellId: Number(btn.dataset.buyShare) });
        if (this.lastState) this.renderShareBuy(this.lastState);
      });
    });
    document.getElementById('btn-shares-done')?.addEventListener('click', async () => {
      this._shareBuy = false;
      if (state.phase === PHASE.BUILD) {
        await this.doAction({ type: 'finishBuild' });
      } else {
        await this.doAction({ type: 'cancelShareUi' });
        if (this.lastState?.phase === PHASE.ROLL) this.renderRollActions(this.lastState);
      }
    });
  }

  dealCompanyChipHtml(cellId) {
    const cell = BOARD[cellId];
    if (!cell) return '';
    const logo = BRAND_LOGO_SRC[cell.name] || BRAND_LOGO_SRC[cell.brand] || '';
    return `
      <div class="deal-chip" title="${escapeHtml(cell.name)}">
        ${logo
          ? `<img class="deal-chip__logo" src="${logo}" alt="${escapeHtml(cell.name)}" />`
          : `<span class="deal-chip__letter">${escapeHtml((cell.brand || cell.name || '?').slice(0, 1))}</span>`}
      </div>
    `;
  }

  dealBundleHtml({ money = 0, cells = [] }) {
    const parts = [];
    for (const id of cells) parts.push(this.dealCompanyChipHtml(id));
    if (money > 0) {
      if (parts.length) parts.push('<div class="deal-plus">+</div>');
      parts.push(`<div class="deal-money">${formatMoney(money)}</div>`);
    }
    if (!parts.length) parts.push('<div class="deal-empty">—</div>');
    return `<div class="deal-bundle">${parts.join('')}</div>`;
  }

  renderDealCompose(state) {
    const me = state.players.find(pl => pl.id === this.mySlot);
    const partners = (state.players || []).filter(p => !p.bankrupt && p.id !== this.mySlot);
    const mine = state.myTradeableCompanies || [];
    const theirsAll = state.dealableCompanies || [];
    const draft = this._dealCompose || {
      step: 'partner',
      toId: null,
      offerMoney: 0,
      askMoney: 0,
      offerCells: [],
      askCells: [],
    };

    if (!partners.length) {
      this._dealCompose = null;
      this.renderRollActions(state);
      return;
    }

    const composeLeft = this.turnLeftMs(state);

    if (draft.step === 'partner' || draft.toId == null) {
      this.actionArea.innerHTML = `
        <div class="deal-panel">
          <p class="deal-panel__title">Кому предложить сделку?</p>
          <div class="deal-panel__list">
            ${partners.map(p => `
              <button type="button" class="btn btn--club" data-deal-to="${p.id}">
                ${escapeHtml(p.name)} · ${formatMoney(p.money)}
              </button>
            `).join('')}
          </div>
          <button type="button" class="btn btn--club-muted" id="deal-cancel">Отмена</button>
          ${this.flipTimerHtml(composeLeft)}
        </div>
      `;
      this.actionArea.querySelectorAll('[data-deal-to]').forEach(btn => {
        btn.addEventListener('click', () => {
          this._dealCompose = {
            step: 'build',
            toId: Number(btn.dataset.dealTo),
            offerMoney: 0,
            askMoney: 0,
            offerCells: [],
            askCells: [],
          };
          this.renderDealCompose(this.lastState || state);
        });
      });
      document.getElementById('deal-cancel')?.addEventListener('click', async () => {
        this._dealCompose = null;
        await this.doAction({ type: 'cancelDealUi' });
        if (this.lastState?.phase === PHASE.ROLL) this.renderRollActions(this.lastState);
      });
      return;
    }

    const partner = partners.find(p => p.id === draft.toId);
    const theirs = theirsAll.filter(c => c.ownerId === draft.toId);
    const offerSet = new Set(draft.offerCells || []);
    const askSet = new Set(draft.askCells || []);

    const toggleChip = (setName, id) => {
      const set = new Set(this._dealCompose[setName] || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      this._dealCompose[setName] = [...set];
      this.renderDealCompose(this.lastState || state);
    };

    const pickBtn = (c, on, dataAttr) => {
      const logo = BRAND_LOGO_SRC[c.name] || BRAND_LOGO_SRC[c.brand] || '';
      return `
        <button type="button" class="deal-pick ${on ? 'is-on' : ''}" ${dataAttr}="${c.cellId}"
          title="${escapeHtml(c.name)}">
          ${logo
            ? `<img class="deal-pick__logo" src="${logo}" alt="${escapeHtml(c.name)}" />`
            : `<span class="deal-pick__letter">${escapeHtml((c.brand || c.name || '?').slice(0, 1))}</span>`}
        </button>`;
    };

    this.actionArea.innerHTML = `
      <div class="deal-panel deal-panel--compose">
        <p class="deal-panel__title">Сделка с ${escapeHtml(partner?.name || 'игроком')}</p>
        <p class="deal-panel__hint">Компании обязательны. Деньги — доплата с одной стороны.</p>

        <div class="deal-compose__block">
          <div class="deal-compose__label">Вы отдадите</div>
          <label class="deal-panel__label">Доплата
            <input type="number" id="deal-offer-money" class="deal-panel__input"
              min="0" max="${me?.money || 0}" step="10000" value="${draft.offerMoney || 0}" />
          </label>
          <div class="deal-compose__chips">
            ${mine.length
              ? mine.map(c => pickBtn(c, offerSet.has(c.cellId), 'data-offer-cell')).join('')
              : '<span class="deal-empty">Нет своих компаний</span>'}
          </div>
        </div>

        <div class="deal-compose__block">
          <div class="deal-compose__label">Вы получите</div>
          <label class="deal-panel__label">Доплата
            <input type="number" id="deal-ask-money" class="deal-panel__input"
              min="0" max="${partner?.money || 0}" step="10000" value="${draft.askMoney || 0}" />
          </label>
          <div class="deal-compose__chips">
            ${theirs.length
              ? theirs.map(c => pickBtn(c, askSet.has(c.cellId), 'data-ask-cell')).join('')
              : '<span class="deal-empty">У соперника нет компаний</span>'}
          </div>
        </div>

        <div class="deal-panel__btns">
          <button type="button" class="btn btn--club" id="deal-send">Отправить</button>
          <button type="button" class="btn btn--club-muted" id="deal-back">Назад</button>
        </div>
        ${this.flipTimerHtml(composeLeft)}
      </div>
    `;

    this.actionArea.querySelectorAll('[data-offer-cell]').forEach(btn => {
      btn.addEventListener('click', () => toggleChip('offerCells', Number(btn.dataset.offerCell)));
    });
    this.actionArea.querySelectorAll('[data-ask-cell]').forEach(btn => {
      btn.addEventListener('click', () => toggleChip('askCells', Number(btn.dataset.askCell)));
    });
    const syncMoney = () => {
      if (!this._dealCompose) return;
      this._dealCompose.offerMoney = Math.max(0, Math.floor(Number(document.getElementById('deal-offer-money')?.value) || 0));
      this._dealCompose.askMoney = Math.max(0, Math.floor(Number(document.getElementById('deal-ask-money')?.value) || 0));
    };
    document.getElementById('deal-offer-money')?.addEventListener('input', syncMoney);
    document.getElementById('deal-ask-money')?.addEventListener('input', syncMoney);
    document.getElementById('deal-send')?.addEventListener('click', async () => {
      syncMoney();
      const offerMoney = this._dealCompose.offerMoney || 0;
      const askMoney = this._dealCompose.askMoney || 0;
      const offerCells = this._dealCompose.offerCells || [];
      const askCells = this._dealCompose.askCells || [];
      if (!offerCells.length && !askCells.length) {
        console.warn('Сделка: нужны компании — обмен только деньгами нельзя');
        return;
      }
      if (!offerMoney && !askMoney && !offerCells.length && !askCells.length) return;
      const toId = this._dealCompose.toId;
      const res = await this.doAction({ type: 'proposeDeal', toId, offerMoney, askMoney, offerCells, askCells });
      if (res?.ok) this._dealCompose = null;
    });
    document.getElementById('deal-back')?.addEventListener('click', () => {
      this._dealCompose = { step: 'partner', toId: null, offerMoney: 0, askMoney: 0, offerCells: [], askCells: [] };
      this.renderDealCompose(this.lastState || state);
    });
  }

  renderDealPending(state) {
    const d = state.deal;
    const from = state.players[d.fromId];
    const to = state.players[d.toId];
    const leftMs = this.turnLeftMs(state);
    const iAmTo = state.canRespondDeal;
    const iAmFrom = d.fromId === this.mySlot;

    let offerMoney = Math.max(0, Number(d.offerMoney) || 0);
    let askMoney = Math.max(0, Number(d.askMoney) || 0);
    let offerCells = [...(d.offerCells || [])];
    let askCells = [...(d.askCells || [])];
    if (d.cellId != null && !askCells.length) {
      askCells = [d.cellId];
      if (!offerMoney && d.price != null) offerMoney = Number(d.price) || 0;
    }

    // Для получателя: «предлагает вам» = offerCells + offerMoney; «отдадите» = askCells + askMoney
    const youGet = this.dealBundleHtml({ money: offerMoney, cells: offerCells });
    const youGive = this.dealBundleHtml({ money: askMoney, cells: askCells });

    if (iAmTo) {
      this.actionArea.innerHTML = `
        <div class="deal-view">
          <p class="deal-view__head">${escapeHtml(from?.name || 'Игрок')} предлагает вам</p>
          ${youGet}
          <p class="deal-view__mid">Вы отдадите</p>
          ${youGive}
          <div class="deal-view__bar">
            <button type="button" class="btn btn--club" id="deal-reject">Отказаться</button>
            ${this.flipTimerHtml(leftMs)}
            <button type="button" class="btn btn--club" id="deal-accept">Принять условия</button>
          </div>
        </div>
      `;
      document.getElementById('deal-accept')?.addEventListener('click', () => this.doAction({ type: 'acceptDeal' }));
      document.getElementById('deal-reject')?.addEventListener('click', () => this.doAction({ type: 'rejectDeal' }));
      return;
    }

    if (iAmFrom) {
      this.actionArea.innerHTML = `
        <div class="deal-view">
          <p class="deal-view__head">Ожидание ответа от ${escapeHtml(to?.name || 'игрока')}</p>
          <p class="deal-view__mid">Вы отдадите</p>
          ${this.dealBundleHtml({ money: offerMoney, cells: offerCells })}
          <p class="deal-view__mid">Вы получите</p>
          ${this.dealBundleHtml({ money: askMoney, cells: askCells })}
          <div class="deal-view__bar deal-view__bar--single">
            <button type="button" class="btn btn--club-muted" id="deal-cancel-pending">Отменить</button>
            ${this.flipTimerHtml(leftMs)}
          </div>
        </div>
      `;
      document.getElementById('deal-cancel-pending')?.addEventListener('click', () => this.doAction({ type: 'rejectDeal' }));
      return;
    }

    this.actionArea.innerHTML = `
      <div class="deal-view">
        <p class="deal-view__head">Сделка: ${escapeHtml(from?.name || '')} → ${escapeHtml(to?.name || '')}</p>
        ${this.flipTimerHtml(leftMs)}
      </div>
    `;
  }

  /** Flip-clock MM:SS */
  flipTimerHtml(leftMs) {
    const total = Math.max(0, Math.ceil(leftMs / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const digits = [...mm, ':', ...ss];
    return `
      <div class="flip-timer" aria-label="${mm}:${ss}">
        <div class="flip-timer__well">
          ${digits.map(ch => (
            ch === ':'
              ? '<span class="flip-timer__colon" aria-hidden="true"></span>'
              : `<span class="flip-timer__digit" data-val="${ch}">
                   <span class="flip-timer__base" aria-hidden="true">${ch}</span>
                   <span class="flip-timer__top" aria-hidden="true"><span>${ch}</span></span>
                   <span class="flip-timer__bottom" aria-hidden="true"><span>${ch}</span></span>
                 </span>`
          )).join('')}
        </div>
      </div>
    `;
  }

  renderBuyActions(state) {
    // Защита: чужим клиентам это меню не рисуем
    if (!this.isCurrentActor(state)) {
      const p = state.players[state.currentPlayerIndex];
      this.actionArea.innerHTML = `<div class="wait-turn">Ход игрока <strong>${escapeHtml(p?.name || '')}</strong></div>`;
      return;
    }
    const pa = state.pendingAction;
    const cell = BOARD[pa.cellId];
    const buyer = state.players[state.currentPlayerIndex];
    const leftMs = this.turnLeftMs(state);
    const country = COUNTRY_LABEL_RU[cell?.country] || cell?.country || '';

    this.actionArea.innerHTML = `
      <div class="rent-panel buy-panel">
        <div class="rent-panel__info">
          <p class="rent-panel__title">Вы попали на поле ${escapeHtml(cell?.name || '')}</p>
          ${country ? `<p class="rent-panel__country">(${escapeHtml(country)})</p>` : ''}
          <p class="rent-panel__pay">Стоимость поля: ${formatMoney(pa.price)}</p>
          <p class="rent-panel__pay">У вас средств: ${formatMoney(buyer?.money || 0)}</p>
          <p class="rent-panel__hint">Купить сейчас или выставить на аукцион</p>
        </div>
        <div class="rent-panel__side">
          <div class="rent-panel__btns">
            <button type="button" class="btn btn--club" id="btn-buy">
              Купить
            </button>
            <button type="button" class="btn btn--club" id="btn-pass">
              Объявить аукцион
            </button>
          </div>
          ${this.flipTimerHtml(leftMs)}
        </div>
      </div>
    `;

    document.getElementById('btn-buy')?.addEventListener('click', () => this.doAction({ type: 'buy' }));
    document.getElementById('btn-pass')?.addEventListener('click', () => this.doAction({ type: 'pass' }));
  }

  renderRentActions(state) {
    if (!this.isCurrentActor(state)) {
      const cur = state.players[state.currentPlayerIndex];
      this.actionArea.innerHTML = `<div class="wait-turn">Ход игрока <strong>${escapeHtml(cur?.name || '')}</strong></div>`;
      return;
    }
    const pa = state.pendingAction;
    const isTax = pa.type === 'tax';
    const isForce = pa.type === 'force';
    const cell = BOARD[pa.cellId];
    const payer = state.players[state.currentPlayerIndex];
    const canAct = true;
    const leftMs = this.turnLeftMs(state);
    const country = COUNTRY_LABEL_RU[cell?.country] || cell?.country || '';
    const canPay = payer && payer.money >= pa.amount;
    const mortgageable = (payer?.properties || []).filter(id => {
      const ps = state.propertyState[id];
      const c = BOARD[id];
      return ps && !ps.mortgaged && (ps.houses || 0) === 0 && c?.price;
    });
    const withShares = (payer?.properties || []).filter(id => {
      const ps = state.propertyState[id];
      const c = BOARD[id];
      return ps && !ps.mortgaged && (ps.houses || 0) > 0 && c?.houseCost;
    });
    const shareable = withShares.filter(id => {
      const c = BOARD[id];
      const group = BOARD.filter(x => x.group === c.group && x.type === 'property');
      const maxH = Math.max(...group.map(g => state.propertyState[g.id]?.houses || 0));
      return (state.propertyState[id].houses || 0) >= maxH;
    });
    const hasShares = withShares.length > 0;
    const showMortgagePick = canAct && this._rentMortgagePick;
    const showSharesPick = canAct && this._rentSharesPick;

    let rightHtml;
    if (showSharesPick) {
      rightHtml = `
        <div class="rent-panel__btns">
          ${shareable.length
            ? shareable.slice(0, 6).map(id => {
                const ps = state.propertyState[id];
                const cash = Math.floor((BOARD[id].houseCost || 0) / 2);
                return `
                  <button type="button" class="btn btn--club" data-sell-share="${id}">
                    ${escapeHtml(BOARD[id].name)} (−1) +${formatMoney(cash)} · ${ps.houses} акц.
                  </button>`;
              }).join('')
            : '<p class="rent-panel__empty">Нет акций</p>'}
          <button type="button" class="btn btn--club-muted" id="btn-rent-back">Назад</button>
        </div>
      `;
    } else if (showMortgagePick) {
      rightHtml = `
        <div class="rent-panel__btns">
          ${mortgageable.length
            ? mortgageable.slice(0, 6).map(id => `
                <button type="button" class="btn btn--club" data-mortgage="${id}">
                  ${escapeHtml(BOARD[id].name)}
                </button>
              `).join('')
            : '<p class="rent-panel__empty">Нечего закладывать</p>'}
          <button type="button" class="btn btn--club-muted" id="btn-rent-back">Назад</button>
        </div>
      `;
    } else {
      rightHtml = `
        <div class="rent-panel__btns">
          <button type="button" class="btn btn--club" id="btn-pay-debt" ${canAct ? '' : 'disabled'}>
            Погасить долг
          </button>
          ${hasShares ? `
            <button type="button" class="btn btn--club" id="btn-shares-open" ${canAct ? '' : 'disabled'}>
              Продать акции
            </button>
          ` : ''}
          ${mortgageable.length ? `
            <button type="button" class="btn btn--club" id="btn-mortgage-open" ${canAct ? '' : 'disabled'}>
              Заложить компании
            </button>
          ` : ''}
        </div>
      `;
    }

    let hint;
    if (canPay) {
      if (hasShares && mortgageable.length) {
        hint = 'У вас достаточно средств для погашения долга. Но, если хотите, можете продать акции некоторых ваших компаний или заложить компании';
      } else if (hasShares) {
        hint = 'У вас достаточно средств для погашения долга. Но, если хотите, можете продать акции некоторых ваших компаний';
      } else if (mortgageable.length) {
        hint = 'У вас достаточно средств для погашения долга. Но, если хотите, можете заложить некоторые ваши компании';
      } else {
        hint = 'У вас достаточно средств для погашения долга';
      }
    } else if (hasShares && mortgageable.length) {
      hint = 'Не хватает средств. Чтобы погасить долг, заложите компании или продайте акции';
    } else if (hasShares) {
      hint = 'Не хватает средств. Чтобы погасить долг, продайте акции';
    } else if (mortgageable.length) {
      hint = 'Не хватает средств. Чтобы погасить долг, заложите компании';
    } else {
      hint = 'Не хватает средств. Погашение долга приведёт к банкротству';
    }

    let title;
    let payLine;
    let cardHtml = '';
    if (isForce) {
      title = `Вы попали на поле ${escapeHtml(pa.fieldName || 'Форс мажор')}`;
      cardHtml = pa.text
        ? `<p class="rent-panel__card">${escapeHtml(pa.text)}</p>`
        : '';
      payLine = `Убытки ${formatMoney(pa.amount)}`;
    } else if (isTax) {
      title = `Вы попали на поле ${escapeHtml(cell?.name || 'Налог')}`;
      payLine = `Придётся заплатить налог в размере ${formatMoney(pa.amount)} (${pa.percent || 6}% от вашего капитала)`;
    } else {
      title = `Вы попали на поле ${escapeHtml(cell?.name || '')}${country ? ` (${escapeHtml(country)})` : ''}`;
      payLine = `Придётся заплатить владельцу этой компании ${formatMoney(pa.amount)}`;
    }

    this.actionArea.innerHTML = `
      <div class="rent-panel${isForce ? ' rent-panel--force' : ''}">
        <div class="rent-panel__info">
          <p class="rent-panel__title">${title}</p>
          ${cardHtml}
          <p class="rent-panel__pay">${payLine}</p>
          <p class="rent-panel__hint">${hint}</p>
        </div>
        <div class="rent-panel__side">
          ${rightHtml}
          ${this.flipTimerHtml(leftMs)}
        </div>
      </div>
    `;

    document.getElementById('btn-pay-debt')?.addEventListener('click', () => {
      this._rentMortgagePick = false;
      this._rentSharesPick = false;
      this.doAction({ type: 'payDebt' });
    });
    document.getElementById('btn-shares-open')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._rentSharesPick = true;
      this._rentMortgagePick = false;
      this.renderRentActions(this.lastState || state);
    });
    document.getElementById('btn-mortgage-open')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._rentMortgagePick = true;
      this._rentSharesPick = false;
      this.renderRentActions(this.lastState || state);
    });
    document.getElementById('btn-rent-back')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._rentMortgagePick = false;
      this._rentSharesPick = false;
      this.renderRentActions(this.lastState || state);
    });
    this.actionArea.querySelectorAll('[data-mortgage]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._rentMortgagePick = true;
        await this.doAction({ type: 'mortgage', cellId: Number(btn.dataset.mortgage) });
        if (this.lastState?.phase === PHASE.ACTION) this.renderRentActions(this.lastState);
      });
    });
    this.actionArea.querySelectorAll('[data-sell-share]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._rentSharesPick = true;
        await this.doAction({ type: 'sellShare', cellId: Number(btn.dataset.sellShare) });
        if (this.lastState?.phase === PHASE.ACTION) this.renderRentActions(this.lastState);
      });
    });
  }

  renderAuctionActions(state) {
    const a = state.auction;
    const cell = BOARD[a.cellId];
    const leader = a.highBidder != null ? state.players[a.highBidder] : null;
    const next = state.nextAuctionPrice ?? (a.highBidder == null ? a.startPrice : a.currentBid + (a.step || AUCTION_STEP));
    const leftMs = this.turnLeftMs(state);
    const me = state.players.find(p => p.id === this.mySlot);
    const canBid = !!state.canAuctionBid && me && me.money >= next && a.highBidder !== this.mySlot;
    const canLeave = !!state.canAuctionLeave;
    const spectator = !!state.auctionSpectator;
    const starter = state.players[a.startedBy];

    let actionsHtml;
    if (spectator) {
      actionsHtml = `<p class="auction-panel__watch">Вы выставили поле — наблюдаете за аукционом</p>`;
    } else if ((a.optedOut || []).includes(this.mySlot)) {
      actionsHtml = `<p class="auction-panel__watch">Вы не участвуете в аукционе</p>`;
    } else {
      actionsHtml = `
        <div class="auction-panel__next">След. ставка: <strong>${formatMoney(next)}</strong></div>
        <button class="btn btn--club" id="btn-auction-bid" ${canBid ? '' : 'disabled'}>
          Поставить ${formatMoney(next)}
        </button>
        ${canLeave ? `
          <button type="button" class="btn btn--club-muted" id="btn-auction-leave">
            Пропустить аукцион
          </button>
        ` : ''}
      `;
    }

    const logo = cell
      ? (BRAND_LOGO_SRC[cell.name] || BRAND_LOGO_SRC[cell.brand] || '')
      : '';
    const titleInner = logo
      ? `<img class="auction-panel__logo" src="${logo}" alt="${escapeHtml(cell?.name || '')}" title="${escapeHtml(cell?.name || '')}" />`
      : escapeHtml(cell?.name || '');

    this.actionArea.innerHTML = `
      <div class="auction-panel">
        <div class="auction-panel__title">
          <span class="auction-panel__label">Аукцион</span>
          ${titleInner}
        </div>
        ${this.flipTimerHtml(leftMs)}
        <div class="auction-panel__meta">
          Старт: ${formatMoney(a.startPrice)} · шаг ${formatMoney(a.step || AUCTION_STEP)}
          ${starter ? ` · от ${escapeHtml(starter.name)}` : ''}
        </div>
        <div class="auction-panel__bid">
          ${leader
            ? `Лидер: <strong>${escapeHtml(leader.name)}</strong> — ${formatMoney(a.currentBid)}`
            : 'Ставок пока нет'}
        </div>
        ${actionsHtml}
      </div>
    `;
    document.getElementById('btn-auction-bid')?.addEventListener('click', () => {
      this.doAction({ type: 'auctionBid' });
    });
    document.getElementById('btn-auction-leave')?.addEventListener('click', () => {
      this.doAction({ type: 'auctionLeave' });
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

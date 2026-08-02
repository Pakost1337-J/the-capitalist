import { BOARD, GROUP_COLORS, JAIL_BAIL, getGridPosition } from './config.js';
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
    this.die1 = document.getElementById('die1');
    this.die2 = document.getElementById('die2');
    this.die1Throw = document.getElementById('die1-throw');
    this.die2Throw = document.getElementById('die2-throw');
    this.dieSum = document.getElementById('die-sum');
    this.diceStage = document.getElementById('dice-stage');
    this.hubTurn = document.getElementById('hub-turn');
    this.hubName = document.getElementById('hub-name');
    this.hubCash = document.getElementById('hub-cash');
    this.hubCapital = document.getElementById('hub-capital');
    this.hubCompanies = document.getElementById('hub-companies');

    this.choicePanel = document.getElementById('choice-panel');

    document.getElementById('new-game')?.addEventListener('click', () => {
      this.showChoiceSlider({
        title: 'Выйти из игры?',
        left: 'Остаться',
        right: 'Выйти',
        onConfirm: (value) => {
          if (value === 1) location.reload();
        },
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
    const rail = narrow ? 0 : Math.round(Math.min(180, Math.max(140, window.innerWidth * 0.11)));
    const availW = Math.max(320, shell.clientWidth - pad - (narrow ? 0 : rail + gap));
    const availH = Math.max(280, shell.clientHeight - pad - (narrow ? 120 : 0));

    // 13×9 клеток — заполняем доступное место
    let cellW = Math.floor(availW / 13);
    let cellH = Math.floor(availH / 9);

    // чуть шире, чем выше — прямоугольное поле
    if (cellW / cellH > 1.25) cellW = Math.floor(cellH * 1.2);
    if (cellH / cellW > 1.05) cellH = Math.floor(cellW * 0.95);

    cellW = Math.max(34, Math.min(cellW, 110));
    cellH = Math.max(30, Math.min(cellH, 96));

    const root = document.documentElement;
    root.style.setProperty('--cell-w', `${cellW}px`);
    root.style.setProperty('--cell-h', `${cellH}px`);
    root.style.setProperty('--rail-w', narrow ? '100%' : `${rail}px`);
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
      this.prependLog(line);
      input.value = '';
    };

    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    this.network.socket?.on('chat-message', (msg) => {
      if (msg?.from === this.network.socket.id) return;
      this.prependLog(`${msg.name}: ${msg.text}`);
    });
  }

  prependLog(line) {
    if (!this.gameLog) return;
    const el = document.createElement('div');
    el.className = 'log-line';
    el.textContent = line;
    this.gameLog.prepend(el);
  }

  buildBoard() {
    this.cells = {};
    for (let i = 0; i < 40; i++) {
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

  renderCellHTML(cell, index) {
    const isCorner = [0, 12, 20, 32].includes(index);
    const isSide = (index >= 13 && index <= 20) || (index >= 33 && index <= 39);
    const colorBar = cell.group ? `<div class="cell__color-bar"></div>` : '';
    const isCompany = cell.type === 'property' || cell.type === 'railroad' || cell.type === 'utility';

    let body;
    if (isCompany) {
      const country = cell.country || '';
      const company = cell.name || cell.brand || '';
      const price = cell.price != null ? formatPriceShort(cell.price) : '';
      body = `
        ${cell.flag ? `<span class="cell__flag">${cell.flag}</span>` : ''}
        ${country ? `<span class="cell__country">${escapeHtml(country)}</span>` : ''}
        <span class="cell__company">${escapeHtml(company)}</span>
        ${price ? `<span class="cell__price">${price}</span>` : ''}
      `;
    } else {
      const price = cell.amount != null ? `<span class="cell__price">${formatPriceShort(cell.amount)}</span>` : '';
      body = `
        ${cell.icon ? iconHTML(cell.icon, 'cell__icon') : ''}
        <span class="cell__name">${escapeHtml(cell.name)}</span>
        ${price}
      `;
    }

    return `
      ${colorBar}
      <div class="cell__body ${isSide ? 'cell__body--side' : ''} ${isCorner ? 'cell__body--corner' : ''}">
        ${body}
      </div>
      <div class="cell__houses" data-houses="${index}"></div>
    `;
  }

  /** Ползунок выбора вместо confirm/alert */
  showChoiceSlider({ title, left, right, onConfirm, initial = 0 }) {
    if (!this.choicePanel) return;
    this.choicePanel.hidden = false;
    this.choicePanel.innerHTML = `
      <div class="choice-slider">
        <div class="choice-slider__title">${escapeHtml(title)}</div>
        <div class="choice-slider__labels">
          <span class="choice-left ${initial === 0 ? 'is-active' : ''}">${escapeHtml(left)}</span>
          <span class="choice-right ${initial === 1 ? 'is-active' : ''}">${escapeHtml(right)}</span>
        </div>
        <input type="range" min="0" max="1" step="1" value="${initial}" id="choice-range" />
        <div class="choice-slider__btns">
          <button type="button" class="btn btn--pass" id="choice-cancel">Отмена</button>
          <button type="button" class="btn btn--roll" id="choice-ok">ОК</button>
        </div>
      </div>
    `;

    const range = this.choicePanel.querySelector('#choice-range');
    const leftEl = this.choicePanel.querySelector('.choice-left');
    const rightEl = this.choicePanel.querySelector('.choice-right');
    const sync = () => {
      const v = Number(range.value);
      leftEl.classList.toggle('is-active', v === 0);
      rightEl.classList.toggle('is-active', v === 1);
    };
    range.addEventListener('input', sync);

    this.choicePanel.querySelector('#choice-cancel').addEventListener('click', () => {
      this.hideChoiceSlider();
    });
    this.choicePanel.querySelector('#choice-ok').addEventListener('click', () => {
      const v = Number(range.value);
      this.hideChoiceSlider();
      onConfirm?.(v);
    });
  }

  hideChoiceSlider() {
    if (!this.choicePanel) return;
    this.choicePanel.hidden = true;
    this.choicePanel.innerHTML = '';
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
      return;
    }

    const prev = this.lastState;
    if (state.mySlot !== undefined) this.mySlot = state.mySlot;

    this.renderHub(state);
    this.renderPlayers(state);
    this.renderHouses(state);
    this.renderLog(state);
    this.highlightCurrentCell(state);

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
    if (this.dieSum) this.dieSum.textContent = String(d1 + d2);
    this.die1Throw?.classList.toggle('die-throw--doubles', !!state.doubles);
    this.die2Throw?.classList.toggle('die-throw--doubles', !!state.doubles);
  }

  async animateDiceThrow(state) {
    const d1 = clampDie(state.dice?.[0]);
    const d2 = clampDie(state.dice?.[1]);
    const sum = d1 + d2;
    this.diceStage?.classList.remove('table-toss--landed');
    if (this.dieSum) this.dieSum.textContent = '…';
    await throwDice(
      [this.die1Throw, this.die2Throw],
      [this.die1, this.die2],
      [d1, d2],
      { doubles: !!state.doubles, stageEl: this.diceStage },
    );
    if (this.dieSum) this.dieSum.textContent = String(sum);
    const sumWrap = document.getElementById('die-sum-wrap');
    sumWrap?.classList.remove('hub__sum-circle--pop');
    void sumWrap?.offsetWidth;
    sumWrap?.classList.add('hub__sum-circle--pop');
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
    el.className = 'token token-fly';
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

  placeToken(id, index, { animate = false, teleport = false, stackIndex = 0, stackCount = 1 } = {}) {
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
      el.classList.toggle('token-fly--teleport', teleport);
      el.style.transition = teleport
        ? 'transform 0.55s cubic-bezier(0.4, 0.05, 0.2, 1)'
        : 'transform 0.16s cubic-bezier(0.25, 0.85, 0.3, 1)';
      el.style.transform = transform;
    }
    this.displayPos[id] = index;
  }

  async hopToken(id, index) {
    const el = this.tokenEls[id];
    if (!el) return;
    const { x, y } = this.getCellPoint(index);
    el.style.transition = 'transform 0.09s cubic-bezier(0.2, 0.9, 0.3, 1)';
    el.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50% - 12px)) scale(1.08)`;
    await sleep(90);
    el.style.transition = 'transform 0.09s cubic-bezier(0.4, 0.2, 0.2, 1)';
    el.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%)) scale(1)`;
    await sleep(90);
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
      const el = this.tokenEls[id];
      if (el) {
        el.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        el.style.opacity = '0.35';
        el.style.transform = `${el.style.transform} scale(1.25)`;
        await sleep(220);
      }
      this.placeToken(id, to, { animate: true, teleport: true });
      if (el) {
        await sleep(520);
        el.style.opacity = '1';
      }
      this.highlightCell(to);
      return;
    }

    for (const step of path) {
      await this.hopToken(id, step);
      this.highlightCell(step);
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
          <div class="p-card__chip" title="${escapeHtml(p.name)}"></div>
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

    if (!isMyTurn || state.phase === PHASE.MOVING) {
      this.actionArea.innerHTML = `<div class="wait-turn">⏳ Ход: <strong>${escapeHtml(p.name)}</strong></div>`;
      return;
    }

    if (p.bankrupt) return;

    if (state.phase === PHASE.ROLL) {
      const rollBtn = document.createElement('button');
      rollBtn.className = 'btn btn--roll';
      rollBtn.textContent = p.inJail ? '🎲 Действие в тюрьме' : '🎲 Бросить кубики';
      rollBtn.addEventListener('click', () => {
        if (p.inJail && p.money >= JAIL_BAIL) {
          this.showChoiceSlider({
            title: 'Тюрьма: выберите действие',
            left: 'Бросить кубики',
            right: `Залог ${formatMoney(JAIL_BAIL)}`,
            onConfirm: (value) => {
              rollBtn.disabled = true;
              if (value === 1) this.doAction({ type: 'payJailBail' });
              else this.doAction({ type: 'roll' });
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
            <button class="btn btn--buy" id="btn-buy">✅ Купить</button>
            <button class="btn btn--pass" id="btn-pass">❌ Пас</button>
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
    if (!this.gameLog) return;
    this.gameLog.innerHTML = (state.log || []).slice(0, 8).map(line =>
      `<div class="log-line">${escapeHtml(line)}</div>`
    ).join('');
  }

  highlightCurrentCell(state) {
    const p = state.players[state.currentPlayerIndex];
    if (!p?.bankrupt) this.highlightCell(p.position);
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

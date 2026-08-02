import { BOARD, GROUP_COLORS, JAIL_BAIL, getGridPosition } from './config.js';
import { formatMoney } from './utils.js';
import { PHASE } from './game.js';
import { iconHTML, resolveIconSrc } from './icons.js';

export class UI {
  constructor(engine, network) {
    this.engine = engine;
    this.network = network;
    this.mySlot = null;
    this.lastState = null;
    this.lastDiceKey = '';

    this.boardEl = document.getElementById('board');
    this.playersPanel = document.getElementById('players-panel');
    this.actionArea = document.getElementById('action-area');
    this.gameLog = document.getElementById('game-log');
    this.die1 = document.getElementById('die1');
    this.die2 = document.getElementById('die2');
    this.dieSum = document.getElementById('die-sum');
    this.diceStage = document.getElementById('dice-stage');
    this.hubTurn = document.getElementById('hub-turn');
    this.hubName = document.getElementById('hub-name');
    this.hubCash = document.getElementById('hub-cash');
    this.hubCapital = document.getElementById('hub-capital');
    this.hubCompanies = document.getElementById('hub-companies');

    document.getElementById('new-game')?.addEventListener('click', () => {
      if (confirm('Выйти из игры?')) location.reload();
    });

    this.setupChat();
    this.buildBoard();
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
  }

  renderCellHTML(cell, index) {
    const isCorner = [0, 12, 20, 32].includes(index);
    const isVertical = (index >= 13 && index <= 20) || (index >= 33 && index <= 39);
    const colorBar = cell.group ? `<div class="cell__color-bar"></div>` : '';
    const price = cell.price != null
      ? `<span class="cell__price">${formatMoney(cell.price)}</span>`
      : (cell.amount != null ? `<span class="cell__price">${formatMoney(cell.amount)}</span>` : '');

    const brand = cell.brand || cell.name;
    const showBrand = cell.type === 'property' || cell.type === 'railroad' || cell.type === 'utility';

    return `
      ${colorBar}
      <div class="cell__body ${isVertical ? 'cell__body--vertical' : ''} ${isCorner ? 'cell__body--corner' : ''}">
        ${cell.flag ? `<span class="cell__flag">${cell.flag}</span>` : ''}
        ${showBrand
          ? `<span class="cell__brand">${escapeHtml(brand)}</span>`
          : (cell.icon ? iconHTML(cell.icon, 'cell__icon') : '')}
        ${!showBrand && cell.name ? `<span class="cell__name">${escapeHtml(cell.name)}</span>` : ''}
        ${showBrand ? `<span class="cell__name">${escapeHtml(cell.name)}</span>` : ''}
        ${price}
      </div>
      <div class="cell__tokens" data-tokens="${index}"></div>
      <div class="cell__houses" data-houses="${index}"></div>
    `;
  }

  render(state) {
    this.lastState = state;
    if (state.mySlot !== undefined) this.mySlot = state.mySlot;

    this.renderHub(state);
    this.renderPlayers(state);
    this.renderTokens(state);
    this.renderHouses(state);
    this.renderDice(state);
    this.renderActions(state);
    this.renderLog(state);
    this.highlightCurrentCell(state);
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
          <div class="p-card__top">
            <div class="p-card__avatar">${tokenDisplay(p)}</div>
            <div>
              <div class="p-card__name">${escapeHtml(p.name)}</div>
              <div class="p-card__badge">${p.isBot ? 'Бот' : (p.id === this.mySlot ? 'Вы' : 'Игрок')}${p.inJail ? ' · тюрьма' : ''}</div>
            </div>
          </div>
          <div class="p-card__rows">
            <div><span>Баланс</span><strong class="money">${formatMoney(p.money)}</strong></div>
            <div><span>Капитал</span><strong>${formatMoney(capital)}</strong></div>
            <div><span>Компании</span><strong>${p.properties.length}</strong></div>
          </div>
          ${isTurn && state.phase !== PHASE.GAME_OVER ? '<div class="p-card__turn">⏱ Ваш ход</div>' : ''}
        </div>
      `;
    }).join('');
  }

  renderTokens(state) {
    document.querySelectorAll('[data-tokens]').forEach(el => { el.innerHTML = ''; });
    const byPos = {};
    for (const p of state.players) {
      if (p.bankrupt) continue;
      if (!byPos[p.position]) byPos[p.position] = [];
      byPos[p.position].push(p);
    }
    for (const [pos, players] of Object.entries(byPos)) {
      const container = document.querySelector(`[data-tokens="${pos}"]`);
      if (!container) continue;
      players.forEach((p, i) => {
        const token = document.createElement('div');
        token.className = 'token';
        token.style.background = p.color;
        token.title = p.name;
        const img = resolveIconSrc(p.tokenImage || '');
        if (img) {
          token.classList.add('token--img');
          token.innerHTML = `<img src="${img}" alt="" />`;
        }
        token.style.transform = `translate(${(i % 2) * 10 - 4}px, ${Math.floor(i / 2) * 10 - 4}px)`;
        container.appendChild(token);
      });
    }
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

  renderDice(state) {
    const d1 = clampDie(state.dice?.[0]);
    const d2 = clampDie(state.dice?.[1]);
    const sum = d1 + d2;
    const key = `${d1}:${d2}:${state.log?.[0] || ''}`;

    if (this.die1) this.die1.dataset.face = String(d1);
    if (this.die2) this.die2.dataset.face = String(d2);
    if (this.dieSum) this.dieSum.textContent = String(sum || 0);
    this.die1?.classList.toggle('die--doubles', !!state.doubles);
    this.die2?.classList.toggle('die--doubles', !!state.doubles);

    if (key !== this.lastDiceKey && this.lastDiceKey !== '') {
      this.animateDice();
    }
    this.lastDiceKey = key;
  }

  async doAction(action) {
    if (action.type === 'roll') this.animateDice();
    const res = await this.network.sendAction(action);
    if (!res?.ok) console.warn('Action failed:', res?.error);
    else if (action.type === 'roll') this.animateDice();
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

    if (!isMyTurn) {
      this.actionArea.innerHTML = `<div class="wait-turn">⏳ Ход: <strong>${escapeHtml(p.name)}</strong></div>`;
      return;
    }

    if (p.bankrupt) return;

    if (state.phase === PHASE.ROLL) {
      const rollBtn = document.createElement('button');
      rollBtn.className = 'btn btn--roll';
      rollBtn.textContent = p.inJail
        ? `🎲 Бросить / Залог ${formatMoney(JAIL_BAIL)}`
        : '🎲 Бросить кубики';
      rollBtn.addEventListener('click', async () => {
        if (p.inJail && p.money >= JAIL_BAIL) {
          const useBail = confirm(`Заплатить ${formatMoney(JAIL_BAIL)} залог? (Отмена = бросить кубики)`);
          if (useBail) return this.doAction({ type: 'payJailBail' });
        }
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
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('cell--highlight'));
    const p = state.players[state.currentPlayerIndex];
    if (!p?.bankrupt && this.cells[p.position]) {
      this.cells[p.position].classList.add('cell--highlight');
    }
  }

  animateDice() {
    if (!this.diceStage) return;
    this.diceStage.classList.remove('dice-stage--falling');
    // restart CSS animation
    void this.diceStage.offsetWidth;
    this.diceStage.classList.add('dice-stage--falling');
    clearTimeout(this._diceTimer);
    this._diceTimer = setTimeout(() => {
      this.diceStage?.classList.remove('dice-stage--falling');
    }, 900);
  }
}

function clampDie(n) {
  const v = Number(n) || 1;
  return Math.min(6, Math.max(1, v));
}

function tokenDisplay(p) {
  const src = resolveIconSrc(p.tokenImage || '');
  if (src) {
    return `<img class="player-card__token-img" src="${src}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />`;
  }
  return `<span class="chip" style="background:${p.color}" title="${escapeHtml(p.name)}"></span>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

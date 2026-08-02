import { BOARD, GROUP_COLORS, getGridPosition } from './config.js';
import { formatMoney } from './utils.js';
import { PHASE } from './game.js';

export class UI {
  constructor(engine, network) {
    this.engine = engine;
    this.network = network;
    this.mySlot = null;

    this.boardEl = document.getElementById('board');
    this.playersPanel = document.getElementById('players-panel');
    this.actionArea = document.getElementById('action-area');
    this.gameLog = document.getElementById('game-log');
    this.die1 = document.getElementById('die1');
    this.die2 = document.getElementById('die2');
    this.roomTitleEl = document.getElementById('room-title-display');

    document.getElementById('new-game').addEventListener('click', () => {
      if (confirm('Выйти из игры?')) location.reload();
    });

    this.buildBoard();
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

      if (cell.group) {
        el.style.setProperty('--group-color', GROUP_COLORS[cell.group]);
      }

      el.innerHTML = this.renderCellHTML(cell, i);
      this.boardEl.appendChild(el);
      this.cells[i] = el;
    }
  }

  renderCellHTML(cell, index) {
    const isCorner = [0, 10, 20, 30].includes(index);
    const isVertical = (index >= 11 && index <= 19) || (index >= 31 && index <= 39);

    const colorBar = cell.group ? `<div class="cell__color-bar"></div>` : '';
    const price = cell.price ? `<span class="cell__price">${formatMoney(cell.price)}</span>` : '';

    return `
      ${colorBar}
      <div class="cell__body ${isVertical ? 'cell__body--vertical' : ''} ${isCorner ? 'cell__body--corner' : ''}">
        ${cell.icon ? `<span class="cell__icon">${cell.icon}</span>` : ''}
        <span class="cell__name">${cell.name}</span>
        ${price}
      </div>
      <div class="cell__tokens" data-tokens="${index}"></div>
      <div class="cell__houses" data-houses="${index}"></div>
    `;
  }

  render(state) {
    if (state.mySlot !== undefined) this.mySlot = state.mySlot;
    if (state.roomName && this.roomTitleEl) {
      this.roomTitleEl.textContent = state.roomName;
    }

    this.renderPlayers(state);
    this.renderTokens(state);
    this.renderHouses(state);
    this.renderDice(state);
    this.renderActions(state);
    this.renderLog(state);
    this.highlightCurrentCell(state);
  }

  renderPlayers(state) {
    this.playersPanel.innerHTML = state.players.map((p, i) => `
      <div class="player-card ${i === state.currentPlayerIndex ? 'player-card--active' : ''} ${p.bankrupt ? 'player-card--out' : ''} ${p.id === this.mySlot ? 'player-card--me' : ''}"
           style="--player-color: ${p.color}">
        <div class="player-card__token">${p.token}</div>
        <div class="player-card__info">
          <div class="player-card__name">${p.name}${p.id === this.mySlot ? ' (вы)' : ''}${p.isBot ? ' 🤖' : ''}</div>
          <div class="player-card__money">${formatMoney(p.money)}</div>
          <div class="player-card__props">${p.properties.length} предприятий</div>
          ${p.inJail ? '<div class="player-card__jail">🔒 В тюрьме</div>' : ''}
        </div>
      </div>
    `).join('');
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
        token.textContent = p.token;
        token.title = p.name;
        token.style.transform = `translate(${(i % 2) * 14 - 7}px, ${Math.floor(i / 2) * 14 - 7}px)`;
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
    this.die1.textContent = state.dice[0];
    this.die2.textContent = state.dice[1];
    this.die1.classList.toggle('die--doubles', state.doubles);
    this.die2.classList.toggle('die--doubles', state.doubles);
  }

  async doAction(action) {
    const res = await this.network.sendAction(action);
    if (!res.ok) {
      console.warn('Action failed:', res.error);
    } else {
      this.animateDice();
    }
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
      this.actionArea.innerHTML = `<div class="wait-turn">⏳ Ход: <strong>${p.name}</strong></div>`;
      return;
    }

    if (p.bankrupt) return;

    if (state.phase === PHASE.ROLL) {
      const rollBtn = document.createElement('button');
      rollBtn.className = 'btn btn--roll';
      rollBtn.textContent = p.inJail ? '🎲 Бросить / 🗝️ Залог $50' : '🎲 Бросить кубики';
      rollBtn.addEventListener('click', async () => {
        if (p.inJail && p.money >= 50) {
          const useBail = confirm('Заплатить $50 залог? (Отмена = бросить кубики)');
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
          <p>Купить <strong>${cell.name}</strong> за ${formatMoney(state.pendingAction.price)}?</p>
          <div class="buy-prompt__btns">
            <button class="btn btn--buy" id="btn-buy">✅ Купить</button>
            <button class="btn btn--pass" id="btn-pass">❌ Отказаться</button>
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
                ${cell.name} (${ps.houses}/5) ${formatMoney(cell.houseCost)}
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
    this.gameLog.innerHTML = state.log.slice(0, 8).map(line =>
      `<div class="log-line">${line}</div>`
    ).join('');
  }

  highlightCurrentCell(state) {
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('cell--highlight'));
    const p = state.players[state.currentPlayerIndex];
    if (!p.bankrupt && this.cells[p.position]) {
      this.cells[p.position].classList.add('cell--highlight');
    }
  }

  animateDice() {
    this.die1.classList.add('die--rolling');
    this.die2.classList.add('die--rolling');
    setTimeout(() => {
      this.die1.classList.remove('die--rolling');
      this.die2.classList.remove('die--rolling');
    }, 500);
  }
}

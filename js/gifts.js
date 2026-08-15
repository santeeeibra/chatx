/**
 * gifts.js — Sistema de regalos virtuales (estilo TikTok roses)
 * Monedas: 100 gratis al registrarse, compra via CCBill (futuro)
 * Comisión: 30% plataforma, 70% creador (registrado en gift_transactions)
 */

import { getBalance, recordGift } from './supabase-client.js';

export const GIFT_CATALOG = [
  { id: 'rose',     emoji: '🌹', name: 'Rosa',     coins: 10,  hot: false },
  { id: 'heart',    emoji: '💖', name: 'Corazón',  coins: 20,  hot: false },
  { id: 'crown',    emoji: '👑', name: 'Corona',   coins: 50,  hot: false },
  { id: 'diamond',  emoji: '💎', name: 'Diamante', coins: 100, hot: false },
  { id: 'fire',     emoji: '🔥', name: 'Fuego',    coins: 15,  hot: true  },
  { id: 'kiss',     emoji: '💋', name: 'Beso',     coins: 30,  hot: true  },
  { id: 'peach',    emoji: '🍑', name: 'Durazno',  coins: 25,  hot: true  },
  { id: 'party',    emoji: '🎉', name: 'Fiesta',   coins: 40,  hot: true  },
];

export class GiftsManager {
  constructor(isPremium, fingerprint) {
    this.isPremium    = isPremium;
    this.fingerprint  = fingerprint;
    this.channel      = null;
    this.toFingerprint = null;
    this.panel        = null;
    this.overlay      = null;
    this.balanceEl    = null;
    this.coins        = 0;
    this._open        = false;
  }

  async init(btnEl, panelEl, overlayEl) {
    this.panel   = panelEl;
    this.overlay = overlayEl;

    this._buildPanel();
    btnEl.addEventListener('click', () => this._toggle());
    await this._syncBalance();
  }

  setChannel(channel, toFingerprint) {
    this.channel       = channel;
    this.toFingerprint = toFingerprint;
  }

  disable() {
    this.channel       = null;
    this.toFingerprint = null;
    this.close();
  }

  close() {
    this.panel?.classList.add('hidden');
    this._open = false;
  }

  receive(emoji) {
    this._animate(emoji, true);
  }

  // ──────────────────────────────────────────
  async _syncBalance() {
    try {
      this.coins = await getBalance(this.fingerprint);
    } catch (_) {
      this.coins = 0;
    }
    this._updateBalanceEl();
  }

  _updateBalanceEl() {
    if (this.balanceEl) this.balanceEl.textContent = `🪙 ${this.coins}`;
  }

  _buildPanel() {
    if (!this.panel) return;
    this.panel.innerHTML = '';

    // Fila de saldo
    const balRow = document.createElement('div');
    balRow.className = 'gift-panel__balance';

    this.balanceEl = document.createElement('span');
    this.balanceEl.className = 'gift-balance';
    this._updateBalanceEl();

    const buyBtn = document.createElement('button');
    buyBtn.className = 'btn btn--ghost btn--xs';
    buyBtn.textContent = '+ Cargar';
    buyBtn.addEventListener('click', () => window.open('premium.html#coins', '_blank'));

    balRow.appendChild(this.balanceEl);
    balRow.appendChild(buyBtn);
    this.panel.appendChild(balRow);

    // Grid de regalos
    const grid = document.createElement('div');
    grid.className = 'gift-grid';

    for (const g of GIFT_CATALOG) {
      // Regalos hot solo para premium
      if (g.hot && !this.isPremium) {
        const locked = document.createElement('button');
        locked.className = 'gift-item gift-item--locked';
        locked.title = 'Solo usuarios Pro';
        locked.innerHTML = `<span class="gift-emoji">${g.emoji}</span><span class="gift-name">${g.name}</span><span class="gift-cost pro-badge">PRO</span>`;
        grid.appendChild(locked);
        continue;
      }

      const item = document.createElement('button');
      item.className = 'gift-item';
      item.innerHTML = `<span class="gift-emoji">${g.emoji}</span><span class="gift-name">${g.name}</span><span class="gift-cost">🪙${g.coins}</span>`;
      item.addEventListener('click', () => this._send(g));
      grid.appendChild(item);
    }

    this.panel.appendChild(grid);
  }

  _toggle() {
    if (!this.channel) return;
    this._open = !this._open;
    this.panel?.classList.toggle('hidden', !this._open);
  }

  async _send(gift) {
    if (!this.channel || !this.toFingerprint) return;

    if (this.coins < gift.coins) {
      _toast('Monedas insuficientes. ¡Cargá más en el panel Premium!');
      return;
    }

    // Descuento optimista
    this.coins -= gift.coins;
    this._updateBalanceEl();

    this.channel.publish('message', {
      type:        'gift',
      giftId:      gift.id,
      emoji:       gift.emoji,
      name:        gift.name,
      coins:       gift.coins,
      fingerprint: this.fingerprint,
    });

    this._animate(gift.emoji, false);
    this.close();

    // Persistir en Supabase (fire-and-forget)
    recordGift(this.fingerprint, this.toFingerprint, gift.id, gift.coins).catch(console.error);
  }

  _animate(emoji, incoming) {
    if (!this.overlay) return;
    const count = incoming ? 10 : 5;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = `gift-float${incoming ? ' gift-float--big' : ''}`;
        el.textContent = emoji;
        el.style.left = `${5 + Math.random() * 90}%`;
        el.style.animationDuration = `${1.4 + Math.random() * 0.8}s`;
        el.style.animationDelay = `${i * 0.08}s`;
        this.overlay.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
      }, i * 80);
    }
  }
}

function _toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

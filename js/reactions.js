const EMOJIS = ['❤️', '🔥', '😂', '👏', '😮', '💀'];

export class ReactionsManager {
  constructor() {
    this._overlay = null;
    this._bar = null;
    this._channel = null;
    this._fingerprint = null;
    this._enabled = false;
  }

  init(overlayEl, barEl) {
    this._overlay = overlayEl;
    this._bar = barEl;

    EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'reaction-btn';
      btn.textContent = emoji;
      btn.addEventListener('click', () => this.send(emoji));
      barEl.appendChild(btn);
    });
  }

  setChannel(channel, fingerprint) {
    this._channel = channel;
    this._fingerprint = fingerprint;
    this._enabled = true;
    this._bar?.classList.remove('hidden');
  }

  disable() {
    this._enabled = false;
    this._bar?.classList.add('hidden');
    this._channel = null;
  }

  send(emoji) {
    if (!this._enabled || !this._channel) return;
    this._spawn(emoji);
    this._channel.publish('message', { type: 'reaction', emoji, fingerprint: this._fingerprint });
  }

  receive(emoji) {
    this._spawn(emoji);
  }

  _spawn(emoji) {
    if (!this._overlay) return;
    const el = document.createElement('span');
    el.className = 'reaction-float';
    el.textContent = emoji;
    el.style.left = (15 + Math.random() * 70) + '%';
    this._overlay.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

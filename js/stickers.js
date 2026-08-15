const PACK_FREE = ['😀','😂','🥰','😎','🤔','😤','🥳','😴','🤯','🫡','👍','🙏','💪','🤝','👀'];
const PACK_HOT  = ['🔥','💋','😈','🫦','💦','👅','🍑','💄','🥵','😏','🌶️','💣','😜','🎰','💯'];

export class StickersManager {
  constructor(isPremium, onSend) {
    this._isPremium = isPremium;
    this._onSend = onSend;
    this._panel = null;
    this._open = false;
  }

  init(panelEl, toggleBtn) {
    this._panel = panelEl;

    const addPack = (emojis, label, locked) => {
      const section = document.createElement('div');
      section.className = 'sticker-section';
      const lbl = document.createElement('p');
      lbl.className = 'sticker-label';
      lbl.textContent = locked ? `🔒 ${label} (Premium)` : label;
      section.appendChild(lbl);
      const grid = document.createElement('div');
      grid.className = 'sticker-grid';
      emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'sticker-btn' + (locked ? ' sticker-btn--locked' : '');
        btn.textContent = emoji;
        if (locked) {
          btn.disabled = true;
          btn.title = 'Solo usuarios Premium';
        } else {
          btn.addEventListener('click', () => {
            this._onSend(emoji);
            this.close();
          });
        }
        grid.appendChild(btn);
      });
      section.appendChild(grid);
      panelEl.appendChild(section);
    };

    addPack(PACK_FREE, '😀 General', false);
    addPack(PACK_HOT, '🔥 Hot', !this._isPremium);

    toggleBtn.addEventListener('click', () => this._open ? this.close() : this.open());

    document.addEventListener('click', (e) => {
      if (this._open && !panelEl.contains(e.target) && e.target !== toggleBtn) {
        this.close();
      }
    });
  }

  open() {
    this._open = true;
    this._panel?.classList.remove('hidden');
  }

  close() {
    this._open = false;
    this._panel?.classList.add('hidden');
  }
}

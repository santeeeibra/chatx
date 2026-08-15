import { supabase } from './supabase-client.js';

const MAX_DURATION_MS = 30_000;

function getSupportedMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
}

export class VoiceMessagesManager {
  constructor(fingerprint, onReceive) {
    this._fp = fingerprint;
    this._onReceive = onReceive;
    this._recorder = null;
    this._chunks = [];
    this._startTime = 0;
    this._timer = null;
    this._channel = null;
    this._enabled = false;
    this._btn = null;
  }

  init(btnEl) {
    this._btn = btnEl;
    btnEl.setAttribute('disabled', '');
    btnEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this._start(); });
    btnEl.addEventListener('pointerup', () => this._stop());
    btnEl.addEventListener('pointerleave', () => { if (this._recorder?.state === 'recording') this._stop(); });
  }

  setChannel(channel) {
    this._channel = channel;
    this._enabled = true;
    this._btn?.removeAttribute('disabled');
  }

  disable() {
    this._enabled = false;
    this._channel = null;
    this._btn?.setAttribute('disabled', '');
    if (this._recorder?.state === 'recording') this._recorder.stop();
  }

  async _start() {
    if (!this._enabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._chunks = [];
      this._recorder = new MediaRecorder(stream, { mimeType: getSupportedMime() });
      this._recorder.ondataavailable = (e) => { if (e.data.size > 0) this._chunks.push(e.data); };
      this._recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        this._uploadAndSend();
      };
      this._recorder.start();
      this._startTime = Date.now();
      this._btn.classList.add('recording');
      this._timer = setTimeout(() => this._stop(), MAX_DURATION_MS);
    } catch (err) {
      console.error('[VoiceMsg] Micrófono no disponible', err);
    }
  }

  _stop() {
    clearTimeout(this._timer);
    if (this._recorder?.state === 'recording') this._recorder.stop();
    this._btn?.classList.remove('recording');
  }

  async _uploadAndSend() {
    const duration = Math.round((Date.now() - this._startTime) / 100) / 10;
    if (duration < 0.5) return;

    const mime = getSupportedMime();
    const ext = mime.includes('ogg') ? 'ogg' : 'webm';
    const blob = new Blob(this._chunks, { type: mime });
    const path = `${this._fp}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from('voice-messages').upload(path, blob, { contentType: mime });
    if (error) { console.error('[VoiceMsg] Upload error', error); return; }

    const { data: { publicUrl } } = supabase.storage.from('voice-messages').getPublicUrl(path);

    this._channel?.publish('message', {
      type: 'voice-msg',
      url: publicUrl,
      duration,
      fingerprint: this._fp,
    });

    this._onReceive?.({ url: publicUrl, duration, mine: true });
  }
}

export function renderVoiceMsg(url, duration, mine) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg voice-msg ' + (mine ? 'chat-msg--mine' : 'chat-msg--theirs');

  const audio = document.createElement('audio');
  audio.src = url;
  audio.preload = 'none';

  const playBtn = document.createElement('button');
  playBtn.className = 'voice-play-btn';
  playBtn.textContent = '▶';
  let playing = false;

  playBtn.addEventListener('click', () => {
    if (playing) { audio.pause(); playBtn.textContent = '▶'; playing = false; }
    else { audio.play(); playBtn.textContent = '⏸'; playing = true; }
  });
  audio.addEventListener('ended', () => { playBtn.textContent = '▶'; playing = false; });

  const dur = document.createElement('span');
  dur.className = 'voice-duration';
  dur.textContent = `🎤 ${duration}s`;

  wrap.appendChild(playBtn);
  wrap.appendChild(dur);
  return wrap;
}

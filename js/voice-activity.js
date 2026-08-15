/**
 * voice-activity.js
 * Detecta actividad de voz en un MediaStream via Web Audio API.
 * Llama onSpeaking(true/false) cuando el nivel supera el threshold.
 */

const THRESHOLD   = 0.01;  // RMS mínimo para considerar "hablando"
const SMOOTH_MS   = 150;   // histeresis: cuánto tiempo mantener "hablando" después de silencio

export class VoiceActivityDetector {
  constructor(stream, onSpeaking) {
    this._ctx      = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 512;
    this._source   = this._ctx.createMediaStreamSource(stream);
    this._source.connect(this._analyser);

    this._buf      = new Float32Array(this._analyser.fftSize);
    this._speaking = false;
    this._silentAt  = 0;
    this._cb        = onSpeaking;
    this._raf       = null;
    this._tick      = this._tick.bind(this);
    this._raf       = requestAnimationFrame(this._tick);
  }

  _tick() {
    this._analyser.getFloatTimeDomainData(this._buf);
    let sum = 0;
    for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
    const rms = Math.sqrt(sum / this._buf.length);

    const now = performance.now();
    if (rms > THRESHOLD) {
      this._silentAt = now + SMOOTH_MS;
      if (!this._speaking) { this._speaking = true; this._cb(true); }
    } else if (this._speaking && now > this._silentAt) {
      this._speaking = false;
      this._cb(false);
    }

    this._raf = requestAnimationFrame(this._tick);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._source.disconnect();
    this._ctx.close().catch(() => {});
  }
}

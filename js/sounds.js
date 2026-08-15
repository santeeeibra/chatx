/**
 * sounds.js — Efectos de sonido del flujo de matchmaking.
 *
 * Timbre sintetizado en runtime via Web Audio API (cero assets, cero CDN).
 * Filosofía: envelopes suaves, curvas exponenciales y volúmenes bajos —
 * nada de beeps cuadrados; cada evento tiene su propio "motivo".
 *
 * API:
 *   initAudio()          — crea/reanuda AudioContext (llamar desde un gesto del usuario)
 *   playSearching()      — inicia el pulso radar de búsqueda (loop de 3s)
 *   stopSearching()      — corte inmediato del radar
 *   playConnected()      — chime ascendente cuando llega el stream remoto
 *   playDisconnected()   — eco descendente cuando se corta la llamada
 *   getSoundsEnabled()   — pref (true por defecto)
 *   setSoundsEnabled(v)  — persiste pref en localStorage y corta el radar si se apaga
 */

const STORAGE_KEY = 'sounds-enabled';

let _ctx        = null;   // AudioContext (lazy, tras gesto del usuario)
let _enabled    = null;   // leído una vez desde localStorage (activo por defecto)
let _radarTimer = null;   // intervalo del pulso de búsqueda

// ============================================================
// PREFERENCIAS — activas por defecto
// ============================================================
export function getSoundsEnabled() {
  if (_enabled === null) {
    _enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
  }
  return _enabled;
}

export function setSoundsEnabled(v) {
  _enabled = !!v;
  localStorage.setItem(STORAGE_KEY, _enabled ? 'true' : 'false');
  if (!_enabled) detenerRadar();
}

// ============================================================
// CONTEXTO DE AUDIO
// ============================================================

/** Crea/reanuda el AudioContext. Debe llamarse dentro de un gesto del usuario. */
export function initAudio() {
  try {
    if (!_ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      _ctx = new AC();
    }
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

// ¿Podemos emitir sonido?
function _audioListo() {
  if (!_ctx) return false;                       // aún sin gesto del usuario
  if (!getSoundsEnabled()) return false;         // muted por el usuario
  if (_ctx.state === 'suspended') { _ctx.resume().catch(() => {}); return false; }
  return true;
}

function _prefiereMotionReducida() {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ============================================================
// HELPERS DE SÍNTESIS
// ============================================================

// Cada "grupo" de nodos se limpia por completo (disconnect) cuando su último
// oscilador termina → sin fugas de memoria ni grafos huérfanos.
function _grupo() {
  const nodos = [];
  return {
    add: (n) => nodos.push(n),
    release: (final) => {
      final.onended = () => {
        for (const n of nodos) { try { n.disconnect(); } catch (_) {} }
      };
    },
  };
}

// Ganancia con envelope suave: ataque corto + release largo logarítmico.
function _envoltura(gain, t, vol, duracion) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0001), t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duracion + 0.7);
}
// ============================================================
// RADAR DE BÚSQUEDA — pulso sine con glissando descendente
// ============================================================
function _pulsar() {
  if (!_audioListo() || _prefiereMotionReducida()) return;
  const t = _ctx.currentTime;
  const grp = _grupo();

  // Frecuencia principal con droop 660 → 560 Hz (tipo sonar, suave)
  const osc = _ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(560, t + 0.4);

  // Armónico superior para un "shimmer" apenas perceptible (-24dB relativo)
  const shimmer = _ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(1320, t);
  shimmer.frequency.exponentialRampToValueAtTime(1120, t + 0.4);

  const g = _ctx.createGain();
  _envoltura(g, t, 0.045, 0.5);

  const sg = _ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.0027, t + 0.06);   // 0.045 * 0.06
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);

  osc.connect(g);
  shimmer.connect(sg);
  sg.connect(g);
  g.connect(_ctx.destination);

  grp.add(osc); grp.add(g); grp.add(shimmer); grp.add(sg);
  grp.release(osc);

  osc.start(t);     osc.stop(t + 0.55);
  shimmer.start(t); shimmer.stop(t + 0.45);
}

export function playSearching() {
  if (!_audioListo()) return;
  detenerRadar();
  _pulsar();
  _radarTimer = setInterval(_pulsar, 3000);
}

export function stopSearching() {
  detenerRadar();
}

function detenerRadar() {
  if (_radarTimer) { clearInterval(_radarTimer); _radarTimer = null; }
}
// ============================================================
// NOTA ÚNICA — osc con shimmer y panning estéreo
// ============================================================
function _nota(freq, t, duracion, vol, pan) {
  const grp = _grupo();

  const osc = _ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);

  const shimmer = _ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(freq * 2, t);

  const g = _ctx.createGain();
  _envoltura(g, t, vol, duracion);

  const sg = _ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(Math.max(vol * 0.06, 0.0001), t + 0.02);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + duracion + 0.5);

  osc.connect(g);
  shimmer.connect(sg);
  sg.connect(g);

  // Panning cuando está disponible (espacialidad estéreo)
  let salida = g;
  if (pan && _ctx.createStereoPanner) {
    const panner = _ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, t);
    g.connect(panner);
    salida = panner;
    grp.add(panner);
  }
  salida.connect(_ctx.destination);

  grp.add(osc); grp.add(g); grp.add(shimmer); grp.add(sg);
  grp.release(osc);

  const fin = t + duracion + 0.75;
  osc.start(t);     osc.stop(fin);
  shimmer.start(t); shimmer.stop(fin);
}

// ============================================================
// CHIME DE CONEXIÓN — E5 → A5, stagger 90ms, pan L→R
// ============================================================
export function playConnected() {
  if (!_audioListo()) return;
  const t = _ctx.currentTime;
  _nota(659.2551, t,         0.16, 0.10, -0.55);
  _nota(880.0,    t + 0.09,  0.22, 0.08,  0.55);
}

// ============================================================
// ECO DE DESCONEXIÓN — A4 → E4, glissando descendente + lowpass
// ============================================================
export function playDisconnected() {
  if (!_audioListo()) return;
  const t = _ctx.currentTime;
  const grp = _grupo();

  const osc = _ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(330, t + 0.25);

  const lp = _ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.exponentialRampToValueAtTime(900, t + 0.3);

  const g = _ctx.createGain();
  _envoltura(g, t, 0.07, 0.6);

  osc.connect(lp);
  lp.connect(g);
  g.connect(_ctx.destination);

  grp.add(osc); grp.add(lp); grp.add(g);
  grp.release(osc);

  osc.start(t);
  osc.stop(t + 0.7);
}
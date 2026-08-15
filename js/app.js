/**
 * app.js — Controlador principal de app.html
 *
 * FLUJO:
 * 1. Fingerprint → verificar ban
 * 2. Cámara local via WebRTC
 * 3. Matchmaking (Supabase + Ably)
 * 4. WebRTC handshake: publisher crea offer, subscriber responde
 * 5. "Siguiente" → cerrar peer → volver al paso 3
 */

import { supabase }        from './supabase-client.js';
import { getFingerprint }  from './fingerprint.js';
import { checkBan, formatTiempoRestante } from './bans.js';
import { buscarPareja, limpiarSlot }      from './matchmaking.js';
import { WebRTCManager }   from './webrtc-manager.js';
import { reportarUsuario } from './reportes.js';
import { initAuth }        from './auth.js';
import {
  initably,
  getSignalingChannel,
  publishOffer,
  publishAnswer,
  publishIceCandidate,
  cleanupably,
} from './ably-signaling.js';

// ============================================================
// ESTADO GLOBAL
// ============================================================
const estado = {
  fingerprint:       null,
  slotId:            null,
  remoteFingerprint: null,
  webrtc:            null,
  conectado:         false,
  procesando:        false,
  isPremium:         false,
  prefs:             null,   // { genero, prefGenero, pais }
};

// ============================================================
// DOM
// ============================================================
const ui = {
  banOverlay:     document.getElementById('ban-overlay'),
  banTitle:       document.getElementById('ban-title'),
  banMessage:     document.getElementById('ban-message'),
  banTimer:       document.getElementById('ban-timer'),
  statusDot:      document.getElementById('status-dot'),
  statusText:     document.getElementById('status-text'),
  placeholderTxt: document.getElementById('placeholder-text'),
  btnSiguiente:   document.getElementById('btn-siguiente'),
  btnReportar:    document.getElementById('btn-reportar'),
  btnMute:        document.getElementById('btn-mute'),
  btnCam:         document.getElementById('btn-cam'),
};

// ============================================================
// INICIALIZACIÓN
// ============================================================
async function iniciarApp() {
  console.log('[App] Iniciando CamReal...');

  estado.fingerprint = await getFingerprint();
  console.log('[App] Fingerprint:', estado.fingerprint);

  await initAuth(estado.fingerprint);
  estado.isPremium = await checkPremium();

  const ban = await checkBan(estado.fingerprint);
  if (ban) { mostrarBan(ban); return; }

  // Video local (persiste entre sesiones)
  estado.webrtc = new WebRTCManager();
  await estado.webrtc.initLocalStream();

  ui.btnSiguiente.addEventListener('click', siguiente);
  ui.btnReportar.addEventListener('click', reportar);
  ui.btnMute.addEventListener('click', toggleMute);
  ui.btnCam.addEventListener('click', toggleCam);

  document.getElementById('btn-start-search').addEventListener('click', onStartSearch);
  document.getElementById('btn-change-prefs').addEventListener('click', mostrarPanelPrefs);

  window.addEventListener('beforeunload', () => {
    if (estado.slotId) limpiarSlot(estado.slotId);
  });

  // Cargar prefs guardadas en los radio buttons
  const prefsGuardadas = leerPrefs();
  if (prefsGuardadas) {
    _setRadio('genero-propio', prefsGuardadas.genero || 'M');
    _setRadio('genero-buscar', prefsGuardadas.prefGenero || 'any');
    _setRadio('pais', prefsGuardadas.pais || '');
  }

  // Pro-gate: bloquear chip de Mujeres si no es premium
  _aplicarProGate();

  // Si ya hay prefs guardadas, ir directo al matchmaking; si no, mostrar el panel
  if (prefsGuardadas) {
    estado.prefs = prefsGuardadas;
    ocultarPanelPrefs();
    await iniciarMatchmaking();
  } else {
    mostrarPanelPrefs();
  }
}

// ============================================================
// PREFERENCIAS
// ============================================================
function _setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function _getRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

function _aplicarProGate() {
  const chip = document.getElementById('chip-mujeres');
  if (!chip) return;
  const input = chip.querySelector('input');
  if (estado.isPremium) {
    chip.classList.remove('pref-chip--locked');
    input.disabled = false;
  } else {
    chip.classList.add('pref-chip--locked');
    input.disabled = true;
    chip.title = 'Solo disponible para usuarios Pro';
    chip.addEventListener('click', (e) => {
      if (!estado.isPremium) {
        e.preventDefault();
        mostrarToast('Solo usuarios Pro pueden filtrar por Mujeres');
      }
    });
  }
}

function leerPrefs() {
  const genero    = localStorage.getItem('user_gender');
  const prefGenero = localStorage.getItem('pref_gender');
  const pais      = localStorage.getItem('user_country');
  if (!genero) return null;
  return { genero, prefGenero: prefGenero || 'any', pais: pais || '' };
}

function guardarPrefs(prefs) {
  localStorage.setItem('user_gender',   prefs.genero);
  localStorage.setItem('pref_gender',   prefs.prefGenero);
  localStorage.setItem('user_country',  prefs.pais);
}

function mostrarPanelPrefs() {
  document.getElementById('prefs-panel').classList.remove('hidden');
  document.getElementById('prefs-searching').classList.add('hidden');
}

function ocultarPanelPrefs() {
  document.getElementById('prefs-panel').classList.add('hidden');
  document.getElementById('prefs-searching').classList.remove('hidden');
}

function onStartSearch() {
  const genero    = _getRadio('genero-propio') || 'M';
  let prefGenero  = _getRadio('genero-buscar') || 'any';
  const pais      = _getRadio('pais') || '';

  // Pro-gate: si intentan filtrar Mujeres sin ser premium, caer a "any"
  if (prefGenero === 'F' && !estado.isPremium) {
    prefGenero = 'any';
    _setRadio('genero-buscar', 'any');
    mostrarToast('Solo usuarios Pro pueden filtrar por Mujeres');
  }

  estado.prefs = { genero, prefGenero, pais };
  guardarPrefs(estado.prefs);
  ocultarPanelPrefs();
  iniciarMatchmaking();
}

function onRelaxFiltros(level) {
  const el = document.getElementById('search-relax');
  if (!el) return;
  const msgs = {
    1: 'Ampliando búsqueda a todos los países...',
    2: 'Buscando sin filtros de género ni país...',
  };
  if (msgs[level]) {
    el.textContent = msgs[level];
    el.classList.remove('hidden');
  }
}

// ============================================================
// PREMIUM CHECK
// ============================================================
async function checkPremium() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data } = await supabase
    .from('user_profiles')
    .select('is_premium')
    .eq('user_id', session.user.id)
    .single();
  return data?.is_premium === true;
}

// ============================================================
// MATCHMAKING
// ============================================================
// Aviso UI: si no hay pareja en 30s, mostramos mensaje (Fase 3 UX)
let _searchTimeout = null;

async function iniciarMatchmaking() {
  // Asegurar que se muestra la pantalla de búsqueda, no el panel de prefs
  document.getElementById('prefs-panel')?.classList.add('hidden');
  document.getElementById('prefs-searching')?.classList.remove('hidden');
  ocultarInfoPareja();
  iniciarTips();
  setStatus('searching');
  ui.btnReportar.disabled = true;

  // Reiniciar aviso de timeout: nada en 30s → mensaje visible
  const searchError = document.getElementById('search-error');
  if (searchError) searchError.classList.add('hidden');
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(() => {
    if (searchError) searchError.classList.remove('hidden');
  }, 30_000);

  // Reiniciar stream local si fue cerrado
  if (!estado.webrtc.localStream) {
    await estado.webrtc.initLocalStream();
  }

  // Limpiar mensaje de relax de búsqueda anterior
  const relaxEl = document.getElementById('search-relax');
  if (relaxEl) { relaxEl.textContent = ''; relaxEl.classList.add('hidden'); }

  try {
    const match = await buscarPareja(estado.fingerprint, estado.prefs || {}, 0, onRelaxFiltros);

    estado.slotId            = match.slotId;
    estado.remoteFingerprint = match.remoteFingerprint;

    detenerTips();
    mostrarInfoPareja(match.remotePais, match.remoteGenero);
    setStatus('connecting');
    await iniciarWebRTC(match);

  } catch (err) {
    // Usuario baneado -> mostrar overlay y frenar reintentos
    if (err?.ban) {
      console.warn('[App] Usuario baneado, bloqueando matchmaking.');
      mostrarBan(err.ban);
      return;
    }
    console.error('[App] Error en matchmaking:', err);
    setStatus('disconnected');
    setTimeout(iniciarMatchmaking, 3000);
  }
}

// ============================================================
// WEBRTC HANDSHAKE
// ============================================================
async function iniciarWebRTC(match) {
  const { slotId, role } = match;

  // Crear peer connection
  estado.webrtc.createPeer();

  // Cuando el ICE candidate esté listo → publicarlo via Ably
  estado.webrtc.onIceCandidate = (candidate) => {
    publishIceCandidate(slotId, candidate, estado.fingerprint);
  };

  // Cuando llegue el stream remoto → marcar como conectado
  estado.webrtc.onRemoteStream = () => {
    estado.conectado = true;
    setStatus('connected');
    ui.btnReportar.disabled = false;
    console.log('[App] Stream remoto recibido. Canal:', slotId, '| Rol:', role);
  };

  // Si el peer se cae → mostrar overlay y buscar nuevo
  estado.webrtc.onDisconnected = () => {
    console.log('[App] Peer desconectado. Mostrando overlay...');
    mostrarDesconexionRemota();
  };

  // Suscribirse al canal Ably para recibir señales WebRTC
  const channel = getSignalingChannel(slotId);
  await channel.attach();

  channel.subscribe('message', async (msg) => {
    const data = msg.data;
    if (!data || !data.type) return;

    // Ignorar mensajes propios
    if (data.fingerprint === estado.fingerprint) return;

    switch (data.type) {
      case 'offer':
        // Soy subscriber (User A) — recibo offer, envío answer
        await estado.webrtc.handleOffer(data.sdp);
        const answer = estado.webrtc.pc.localDescription;
        await publishAnswer(slotId, answer, estado.fingerprint);
        break;

      case 'answer':
        await estado.webrtc.handleAnswer(data.sdp);
        break;

      case 'ice-candidate':
        await estado.webrtc.addIceCandidate(data.candidate);
        break;

      case 'hangup':
        console.log('[App] Remote hung up. Mostrando overlay...');
        mostrarDesconexionRemota();
        break;
    }
  });

  if (role === 'publisher') {
    // Soy publisher (User B) — creo y envío offer
    const offer = await estado.webrtc.createOffer();
    await publishOffer(slotId, offer, estado.fingerprint);
  }
  // Si soy subscriber (User A), espero el offer que llega por el canal suscrito arriba
}

// ============================================================
// DESCONEXIÓN REMOTA — overlay + countdown
// ============================================================
let _disconnectTimer = null;

function mostrarDesconexionRemota() {
  if (estado.procesando) return;

  const overlay    = document.getElementById('disconnect-overlay');
  const countdown  = document.getElementById('disconnect-countdown');
  if (!overlay) { siguiente(); return; }

  setStatus('disconnected');
  overlay.classList.remove('hidden');

  let t = 5;
  countdown.textContent = `Buscando nueva pareja en ${t}...`;

  _disconnectTimer = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(_disconnectTimer);
      _disconnectTimer = null;
      overlay.classList.add('hidden');
      siguiente();
    } else {
      countdown.textContent = `Buscando nueva pareja en ${t}...`;
    }
  }, 1000);
}

function cancelarOverlayDesconexion() {
  if (_disconnectTimer) {
    clearInterval(_disconnectTimer);
    _disconnectTimer = null;
  }
  const overlay = document.getElementById('disconnect-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ============================================================
// ACCIONES
// ============================================================
async function siguiente() {
  if (estado.procesando) return;
  cancelarOverlayDesconexion();
  detenerTips();
  ocultarInfoPareja();
  estado.procesando = true;

  ui.btnReportar.disabled = true;
  ui.btnSiguiente.disabled = true;
  estado.conectado = false;

  const slotAnterior = estado.slotId;
  estado.slotId            = null;
  estado.remoteFingerprint = null;

  // Publicar hangup antes de cerrar el canal
  if (slotAnterior) {
    try {
      const ch = getSignalingChannel(slotAnterior);
      if (ch) await ch.publish('message', { type: 'hangup', fingerprint: estado.fingerprint });
    } catch (_) {}
  }

  // Cerrar peer y limpiar canal Ably
  estado.webrtc.pc?.close();
  estado.webrtc.pc = null;
  cleanupably();

  if (slotAnterior) await limpiarSlot(slotAnterior);

  // Volver a mostrar placeholders (sin cerrar stream local)
  document.getElementById('placeholder-remote')?.classList.remove('hidden');
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) remoteVideo.srcObject = null;

  // Cooldown: 30s para free, 2s para premium
  const cooldownSecs = estado.isPremium ? 2 : 30;
  if (!estado.isPremium) mostrarUpgradeBanner(true);

  await new Promise((resolve) => {
    let t = cooldownSecs;
    ui.btnSiguiente.textContent = `Siguiente (${t}s)`;
    const iv = setInterval(() => {
      t--;
      if (t <= 0) {
        clearInterval(iv);
        ui.btnSiguiente.textContent = 'Siguiente';
        resolve();
      } else {
        ui.btnSiguiente.textContent = `Siguiente (${t}s)`;
      }
    }, 1000);
  });

  mostrarUpgradeBanner(false);
  estado.procesando = false;
  await iniciarMatchmaking();
}

function reportar() {
  if (!estado.remoteFingerprint || !estado.conectado) return;
  abrirModalReporte();
}

// ============================================================
// MODAL DE REPORTE
// ============================================================
function abrirModalReporte() {
  const modal = document.getElementById('report-modal');
  // Reset
  document.querySelectorAll('input[name="report-reason"]').forEach(r => r.checked = false);
  document.getElementById('report-comment').value = '';
  modal.classList.remove('hidden');
}

function cerrarModalReporte() {
  document.getElementById('report-modal').classList.add('hidden');
}

function mostrarToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

async function enviarReporte() {
  const razon = document.querySelector('input[name="report-reason"]:checked')?.value;
  if (!razon) return;

  const comentario = document.getElementById('report-comment').value.trim();
  const reportedFp = estado.remoteFingerprint;
  const reporterFp = estado.fingerprint;

  cerrarModalReporte();

  // Persistir en Supabase
  await reportarUsuario(reportedFp, reporterFp, estado.slotId, razon, comentario);

  mostrarToast('Reporte enviado');

  setTimeout(() => siguiente(), 1500);
}

// Listeners del modal (se registran una sola vez)
document.getElementById('btn-modal-cancel').addEventListener('click', cerrarModalReporte);
document.getElementById('btn-modal-submit').addEventListener('click', enviarReporte);
document.getElementById('report-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) cerrarModalReporte();
});

async function toggleMute() {
  const localStream = estado.webrtc?.localStream;
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  const muteado = !audioTrack.enabled;
  ui.btnMute.classList.toggle('muted', muteado);
  ui.btnMute.title = muteado ? 'Activar micrófono' : 'Silenciar micrófono';
}

async function toggleCam() {
  const localStream = estado.webrtc?.localStream;
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  const apagada = !videoTrack.enabled;
  ui.btnCam.classList.toggle('muted', apagada);
  ui.btnCam.title = apagada ? 'Activar cámara' : 'Apagar cámara';
}

// ============================================================
// PARTNER INFO BADGE
// ============================================================
const PAIS_FLAGS = {
  AR: '🇦🇷', MX: '🇲🇽', ES: '🇪🇸', CO: '🇨🇴', CL: '🇨🇱',
  PE: '🇵🇪', VE: '🇻🇪', US: '🇺🇸', BR: '🇧🇷',
};
const GENERO_LABELS = { M: 'Hombre', F: 'Mujer', NB: 'Otro' };

function mostrarInfoPareja(pais, genero) {
  const badge = document.getElementById('partner-info');
  const flagEl = document.getElementById('partner-flag');
  const labelEl = document.getElementById('partner-label');
  if (!badge) return;

  const parts = [];
  if (pais && PAIS_FLAGS[pais]) parts.push(PAIS_FLAGS[pais]);
  if (genero && GENERO_LABELS[genero]) parts.push(GENERO_LABELS[genero]);

  if (parts.length === 0) { badge.classList.add('hidden'); return; }

  flagEl.textContent = PAIS_FLAGS[pais] || '';
  labelEl.textContent = parts.filter(p => !PAIS_FLAGS[p]).join(' ') || GENERO_LABELS[genero] || '';
  // Simplify: just show flag + gender label
  flagEl.textContent = pais && PAIS_FLAGS[pais] ? PAIS_FLAGS[pais] : '';
  labelEl.textContent = genero && GENERO_LABELS[genero] ? GENERO_LABELS[genero] : (pais || '');
  badge.classList.remove('hidden');
}

function ocultarInfoPareja() {
  document.getElementById('partner-info')?.classList.add('hidden');
}

// ============================================================
// TIPS DINÁMICOS DURANTE BÚSQUEDA
// ============================================================
const SEARCH_TIPS = [
  '💡 Si ves algo inapropiado, usá el botón Reportar.',
  '🤝 Tratá a los demás como querés ser tratado.',
  '🚫 Insultos o acoso = ban inmediato.',
  '👁️ Estás en un espacio público. Sé respetuoso.',
  '⚡ Los reportes se revisan rápido. Gracias por ayudar.',
  '🔒 Tu identidad está protegida por un ID anónimo.',
  '🌎 Podés conectar con gente de toda América Latina.',
  '📵 Si alguien te incomoda, presioná Siguiente.',
];

let _tipInterval = null;

function iniciarTips() {
  const el = document.getElementById('search-tip');
  if (!el) return;
  let i = Math.floor(Math.random() * SEARCH_TIPS.length);
  el.textContent = SEARCH_TIPS[i];
  _tipInterval = setInterval(() => {
    el.style.opacity = '0';
    setTimeout(() => {
      i = (i + 1) % SEARCH_TIPS.length;
      el.textContent = SEARCH_TIPS[i];
      el.style.opacity = '1';
    }, 400);
  }, 4000);
}

function detenerTips() {
  clearInterval(_tipInterval);
  _tipInterval = null;
  const el = document.getElementById('search-tip');
  if (el) el.textContent = '';
}

// ============================================================
// UPGRADE BANNER
// ============================================================
function mostrarUpgradeBanner(visible) {
  const banner = document.getElementById('upgrade-banner');
  if (banner) banner.classList.toggle('hidden', !visible);
}

// ============================================================
// UI HELPERS
// ============================================================
function setStatus(nuevoEstado) {
  // Cualquier cambio de estado limpia el aviso de "no hay pareja"
  clearTimeout(_searchTimeout);
  document.getElementById('search-error')?.classList.add('hidden');

  const placeholder = document.getElementById('placeholder-remote');
  ui.statusDot.className = 'status-dot';

  const cfg = {
    searching:    { clase: 'status-dot--searching',    texto: 'Buscando pareja...',  showOverlay: true,  disableSig: false },
    connecting:   { clase: 'status-dot--waiting',      texto: 'Conectando...',        showOverlay: false, disableSig: true  },
    connected:    { clase: 'status-dot--connected',    texto: 'Conectado',            showOverlay: false, disableSig: false },
    disconnected: { clase: 'status-dot--disconnected', texto: 'Desconectado',         showOverlay: true,  disableSig: false },
  }[nuevoEstado] ?? { clase: 'status-dot--searching', texto: nuevoEstado, showOverlay: true, disableSig: false };

  ui.statusDot.classList.add(cfg.clase);
  ui.statusText.textContent = cfg.texto;
  if (ui.placeholderTxt) ui.placeholderTxt.textContent = nuevoEstado === 'searching' ? 'Buscando pareja' : '';
  if (placeholder) {
    placeholder.classList.toggle('hidden', !cfg.showOverlay);
    // Si el placeholder es visible pero el panel de prefs está activo, no mostrar el spinner
    if (cfg.showOverlay && !document.getElementById('prefs-panel')?.classList.contains('hidden')) {
      document.getElementById('prefs-searching')?.classList.add('hidden');
    }
  }
  ui.btnSiguiente.disabled = cfg.disableSig;
}

function mostrarBan(ban) {
  ui.banOverlay.classList.add('active');
  if (ban.tipo === 'permanente') {
    ui.banTitle.textContent   = 'Acceso bloqueado permanentemente';
    ui.banMessage.textContent = 'Tu dispositivo fue bloqueado por múltiples infracciones.';
    ui.banTimer.textContent   = '';
  } else {
    ui.banTitle.textContent   = 'Acceso suspendido';
    ui.banMessage.textContent = `Fuiste reportado por otro usuario. Motivo: ${ban.razon || 'Reporte de usuario'}.`;
    actualizarCuentaRegresiva(ban.expira_en);
  }
}

function actualizarCuentaRegresiva(expiraEn) {
  const tick = () => {
    const texto = formatTiempoRestante(expiraEn);
    ui.banTimer.textContent = texto;
    if (texto === 'Ya podés volver a ingresar') {
      ui.banOverlay.classList.remove('active');
      iniciarMatchmaking();
    } else {
      setTimeout(tick, 1000);
    }
  };
  tick();
}

// ============================================================
// ARRANCAR
// ============================================================
iniciarApp();

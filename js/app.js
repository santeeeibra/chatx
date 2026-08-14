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

import { CONFIG }          from './config.js';
import { getFingerprint }  from './fingerprint.js';
import { checkBan, formatTiempoRestante } from './bans.js';
import { buscarPareja, limpiarSlot }      from './matchmaking.js';
import { WebRTCManager }   from './webrtc-manager.js';
import { reportarUsuario } from './reportes.js';
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
  console.log('[App] Iniciando ChatX...');

  estado.fingerprint = await getFingerprint();
  console.log('[App] Fingerprint:', estado.fingerprint);

  const ban = await checkBan(estado.fingerprint);
  if (ban) { mostrarBan(ban); return; }

  // Video local (persiste entre sesiones)
  estado.webrtc = new WebRTCManager();
  await estado.webrtc.initLocalStream();

  ui.btnSiguiente.addEventListener('click', siguiente);
  ui.btnReportar.addEventListener('click', reportar);
  ui.btnMute.addEventListener('click', toggleMute);
  ui.btnCam.addEventListener('click', toggleCam);

  window.addEventListener('beforeunload', () => {
    if (estado.slotId) limpiarSlot(estado.slotId);
  });

  await iniciarMatchmaking();
}

// ============================================================
// MATCHMAKING
// ============================================================
async function iniciarMatchmaking() {
  setStatus('buscando');
  ui.btnReportar.disabled = true;

  // Reiniciar stream local si fue cerrado
  if (!estado.webrtc.localStream) {
    await estado.webrtc.initLocalStream();
  }

  try {
    const match = await buscarPareja(estado.fingerprint);

    estado.slotId            = match.slotId;
    estado.remoteFingerprint = match.remoteFingerprint;

    await iniciarWebRTC(match);

  } catch (err) {
    console.error('[App] Error en matchmaking:', err);
    setStatus('error');
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
    setStatus('conectado');
    ui.btnReportar.disabled = false;
    console.log('[App] Stream remoto recibido. Canal:', slotId, '| Rol:', role);
  };

  // Si el peer se cae → buscar nuevo
  estado.webrtc.onDisconnected = () => {
    console.log('[App] Peer desconectado. Buscando nuevo...');
    siguiente();
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
// ACCIONES
// ============================================================
async function siguiente() {
  if (estado.procesando) return;
  estado.procesando = true;

  ui.btnReportar.disabled = true;
  estado.conectado = false;

  const slotAnterior = estado.slotId;
  estado.slotId            = null;
  estado.remoteFingerprint = null;

  // Cerrar peer y limpiar canal Ably
  estado.webrtc.pc?.close();
  estado.webrtc.pc = null;
  cleanupably();

  if (slotAnterior) await limpiarSlot(slotAnterior);

  // Volver a mostrar placeholders (sin cerrar stream local)
  document.getElementById('placeholder-remote')?.classList.remove('hidden');
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) remoteVideo.srcObject = null;

  estado.procesando = false;
  await iniciarMatchmaking();
}

async function reportar() {
  if (!estado.remoteFingerprint || !estado.conectado) return;
  const fp     = estado.remoteFingerprint;
  const slotId = estado.slotId;
  console.log('[App] Reportando a:', fp);
  await reportarUsuario(fp, estado.fingerprint, slotId);
  await siguiente();
}

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
// UI HELPERS
// ============================================================
function setStatus(nuevoEstado) {
  ui.statusDot.className = 'status-dot';
  const estados = {
    buscando:  { clase: 'status-dot--waiting',   texto: 'Buscando...',                    placeholder: 'Buscando pareja...' },
    conectado: { clase: 'status-dot--connected', texto: 'Conectado',                       placeholder: '' },
    error:     { clase: '',                       texto: 'Error de conexión — reintentando', placeholder: 'Reconectando...' },
  };
  const cfg = estados[nuevoEstado] || estados.buscando;
  if (cfg.clase) ui.statusDot.classList.add(cfg.clase);
  ui.statusText.textContent = cfg.texto;
  if (ui.placeholderTxt) ui.placeholderTxt.textContent = cfg.placeholder;
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

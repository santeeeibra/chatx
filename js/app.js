/**
 * app.js — Controlador principal de app.html
 *
 * FLUJO COMPLETO:
 * 1. Obtener fingerprint del dispositivo
 * 2. Verificar si hay ban activo → mostrar overlay si sí
 * 3. Inicializar video local (cámara)
 * 4. Iniciar matchmaking → esperar pareja
 * 5. Cuando hay pareja → unirse al canal de Agora
 * 6. "Siguiente" → salir del canal → volver al paso 4
 * 7. "Reportar" → reportar al remoto → ir al paso 6
 */

import { CONFIG }          from './config.js';
import { getFingerprint }  from './fingerprint.js';
import { checkBan, formatTiempoRestante } from './bans.js';
import { buscarPareja, limpiarSlot }      from './matchmaking.js';
import { AgoraManager }    from './agora-manager.js';
import { reportarUsuario } from './reportes.js';

// ============================================================
// ESTADO GLOBAL DE LA SESIÓN
// ============================================================
const estado = {
  fingerprint:       null,  // ID del dispositivo local
  slotId:            null,  // ID del slot en sala_espera
  remoteFingerprint: null,  // ID del dispositivo del usuario remoto
  agora:             null,  // Instancia de AgoraManager
  conectado:         false, // Hay alguien del otro lado
  procesando:        false, // Evitar doble clic en "Siguiente"
};

// ============================================================
// REFERENCIAS AL DOM
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

  // 1. Fingerprint
  estado.fingerprint = await getFingerprint();
  console.log('[App] Fingerprint:', estado.fingerprint);

  // 2. Verificar ban
  const ban = await checkBan(estado.fingerprint);
  if (ban) {
    mostrarBan(ban);
    return;
  }

  // 3. Inicializar Agora y video local
  estado.agora = new AgoraManager(CONFIG.AGORA_APP_ID);

  // Callback: el usuario remoto se fue → ir al siguiente automáticamente
  estado.agora.onRemoteLeft = () => {
    console.log('[App] El remoto se desconectó. Buscando nuevo...');
    siguiente();
  };

  await estado.agora.initLocalVideo();

  // 4. Eventos de botones
  ui.btnSiguiente.addEventListener('click', siguiente);
  ui.btnReportar.addEventListener('click', reportar);
  ui.btnMute.addEventListener('click', toggleMute);
  ui.btnCam.addEventListener('click', toggleCam);

  // 5. Limpiar al cerrar la pestaña
  window.addEventListener('beforeunload', () => {
    if (estado.slotId) limpiarSlot(estado.slotId);
  });

  // 6. Matchmaking
  await iniciarMatchmaking();
}

// ============================================================
// MATCHMAKING
// ============================================================
async function iniciarMatchmaking() {
  setStatus('buscando');
  ui.btnReportar.disabled = true;

  try {
    const match = await buscarPareja(estado.fingerprint);

    estado.slotId            = match.slotId;
    estado.remoteFingerprint = match.remoteFingerprint;

    await estado.agora.joinChannel(match.channelName, null, null);

    estado.conectado = true;
    setStatus('conectado');
    ui.btnReportar.disabled = false;

    console.log('[App] Conectado. Canal:', match.channelName, '| Rol:', match.role);

  } catch (err) {
    console.error('[App] Error en matchmaking:', err);
    setStatus('error');
    // Reintentar en 3 segundos
    setTimeout(iniciarMatchmaking, 3000);
  }
}

// ============================================================
// ACCIONES
// ============================================================

/** Saltar al siguiente usuario. */
async function siguiente() {
  if (estado.procesando) return;
  estado.procesando = true;

  ui.btnReportar.disabled = true;
  estado.conectado = false;

  // Limpiar slot anterior
  const slotAnterior = estado.slotId;
  estado.slotId            = null;
  estado.remoteFingerprint = null;

  if (slotAnterior) await limpiarSlot(slotAnterior);

  // Salir del canal de Agora
  await estado.agora.leaveChannel();

  estado.procesando = false;

  // Buscar nueva pareja
  await iniciarMatchmaking();
}

/** Reportar al usuario actual y pasar al siguiente. */
async function reportar() {
  if (!estado.remoteFingerprint || !estado.conectado) return;

  const fp = estado.remoteFingerprint;
  const slotId = estado.slotId;

  console.log('[App] Reportando a:', fp);
  await reportarUsuario(fp, estado.fingerprint, slotId);

  // Pasar al siguiente
  await siguiente();
}

/** Toggle mute del micrófono. */
async function toggleMute() {
  const muteado = await estado.agora.toggleMute();
  ui.btnMute.classList.toggle('muted', muteado);
  ui.btnMute.title = muteado ? 'Activar micrófono' : 'Silenciar micrófono';
}

/** Toggle cámara. */
async function toggleCam() {
  const apagada = await estado.agora.toggleCamera();
  ui.btnCam.classList.toggle('muted', apagada);
  ui.btnCam.title = apagada ? 'Activar cámara' : 'Apagar cámara';
}

// ============================================================
// UI HELPERS
// ============================================================

/** Actualiza el badge de estado del header. */
function setStatus(nuevoEstado) {
  ui.statusDot.className = 'status-dot';

  const estados = {
    buscando: {
      clase: 'status-dot--waiting',
      texto: 'Buscando...',
      placeholder: 'Buscando pareja...',
    },
    conectado: {
      clase: 'status-dot--connected',
      texto: 'Conectado',
      placeholder: '',
    },
    error: {
      clase: '',
      texto: 'Error de conexión — reintentando',
      placeholder: 'Reconectando...',
    },
  };

  const cfg = estados[nuevoEstado] || estados.buscando;
  if (cfg.clase) ui.statusDot.classList.add(cfg.clase);
  ui.statusText.textContent    = cfg.texto;
  if (ui.placeholderTxt) ui.placeholderTxt.textContent = cfg.placeholder;
}

/** Muestra el overlay de ban con información y cuenta regresiva. */
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

/** Actualiza la cuenta regresiva del ban cada segundo. */
function actualizarCuentaRegresiva(expiraEn) {
  const tick = () => {
    const texto = formatTiempoRestante(expiraEn);
    ui.banTimer.textContent = texto;

    if (texto === 'Ya podés volver a ingresar') {
      // Ocultar overlay y dejar que el usuario entre
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

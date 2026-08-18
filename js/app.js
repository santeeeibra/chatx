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
import { VoiceActivityDetector } from './voice-activity.js';
import {
  initAudio,
  playSearching,
  stopSearching,
  playConnected,
  playDisconnected,
  getSoundsEnabled,
  setSoundsEnabled,
} from './sounds.js';
import { ReactionsManager } from './reactions.js';
import { StickersManager } from './stickers.js';
import { VoiceMessagesManager, renderVoiceMsg } from './voice-messages.js';
import { GiftsManager } from './gifts.js';
import { VerificationManager } from './verification.js';

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
  pausado:           false,
  chatChannel:       null,
  vadLocal:          null,
  vadRemote:         null,
  anonymousMode:     false,
  reactions:         null,
  stickers:          null,
  voiceMsgs:         null,
  gifts:             null,
  verification:      null,
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
  btnSounds:      document.getElementById('btn-sounds'),
  btnRotateCam:   document.getElementById('btn-rotate-cam'),
  btnPause:       document.getElementById('btn-pause-search'),
  chatInput:      document.getElementById('chat-input'),
  btnChatSend:    document.getElementById('btn-chat-send'),
  chatMessages:   document.getElementById('chat-messages'),
  chatPlaceholder:document.getElementById('chat-placeholder'),
  btnSticker:     document.getElementById('btn-sticker'),
  btnGift:        document.getElementById('btn-gift'),
  btnVoiceMsg:    document.getElementById('btn-voice-msg'),
  giftPanel:      document.getElementById('gift-panel'),
  giftsOverlay:   document.getElementById('gifts-overlay'),
  stickerPanel:   document.getElementById('sticker-panel'),
  reactionsBar:   document.getElementById('reactions-bar'),
  reactionsOvl:   document.getElementById('reactions-overlay'),
  anonCheckbox:   document.getElementById('pref-anonymous'),
  soundsMuted:    !getSoundsEnabled(),
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
  _iniciarVADLocal();

  // Reactions
  estado.reactions = new ReactionsManager();
  estado.reactions.init(ui.reactionsOvl, ui.reactionsBar);

  // Stickers — onSend envía sticker como chat
  estado.stickers = new StickersManager(estado.isPremium, (emoji) => {
    if (!estado.chatChannel || !estado.conectado) return;
    agregarMensajeChat(emoji, true);
    estado.chatChannel.publish('message', { type: 'sticker', emoji, fingerprint: estado.fingerprint });
  });
  if (ui.btnSticker && ui.stickerPanel) {
    estado.stickers.init(ui.stickerPanel, ui.btnSticker);
  }

  // Voice messages
  estado.voiceMsgs = new VoiceMessagesManager(estado.fingerprint, ({ url, duration, mine }) => {
    if (ui.chatMessages) {
      ui.chatMessages.appendChild(renderVoiceMsg(url, duration, mine));
      ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
    }
  });
  if (ui.btnVoiceMsg) estado.voiceMsgs.init(ui.btnVoiceMsg);

  // Gifts
  estado.gifts = new GiftsManager(estado.isPremium, estado.fingerprint);
  if (ui.btnGift && ui.giftPanel && ui.giftsOverlay) {
    await estado.gifts.init(ui.btnGift, ui.giftPanel, ui.giftsOverlay);
  }

  // Verification
  estado.verification = new VerificationManager();
  await estado.verification.checkMyStatus();

  // Anonymous mode
  _iniciarModoAnonimo();

  ui.btnSiguiente.addEventListener('click', siguiente);
  ui.btnReportar.addEventListener('click', reportar);
  ui.btnMute.addEventListener('click', toggleMute);
  ui.btnCam.addEventListener('click', toggleCam);
  ui.btnSounds?.addEventListener('click', toggleSounds);
  ui.btnRotateCam?.addEventListener('click', () => estado.webrtc?.rotarCamara().catch(console.error));
  ui.btnPause?.addEventListener('click', togglePausaBusqueda);

  // Mobile mirror buttons — delegate to their desktop counterparts
  document.getElementById('btn-mute-mobile')?.addEventListener('click', toggleMute);
  document.getElementById('btn-cam-mobile')?.addEventListener('click', toggleCam);
  document.getElementById('btn-sounds-mobile')?.addEventListener('click', toggleSounds);
  document.getElementById('btn-rotate-cam-mobile')?.addEventListener('click', () => estado.webrtc?.rotarCamara().catch(console.error));
  document.getElementById('btn-login-mobile')?.addEventListener('click', () => ui.btnLogin?.click());
  document.getElementById('btn-logout-mobile')?.addEventListener('click', () => document.getElementById('btn-logout')?.click());
  _refrescarBtnSonidos();

  // Chat
  ui.btnChatSend?.addEventListener('click', enviarMensajeChat);
  ui.chatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) enviarMensajeChat(); });

  document.getElementById('btn-start-search').addEventListener('click', onStartSearch);
  document.getElementById('btn-change-prefs').addEventListener('click', mostrarPanelPrefs);

  window.addEventListener('beforeunload', () => {
    if (estado.slotId) limpiarSlot(estado.slotId);
  });

  // Dropdown de país (banderas reales)
  initCountryDropdown();

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
  const sel = document.querySelector(`select[name="${name}"]`);
  if (sel) {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function _getRadio(name) {
  const sel = document.querySelector(`select[name="${name}"]`);
  if (sel) return sel.value;
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

// ============================================================
// DROPDOWN DE PAÍS (banderas reales en lugar de emojis)
// ============================================================
const FLAG_BASE_URL = 'https://flagpedia.net/data/flags/h80/';
const EMOJI_FLAG_RX = /^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u;

// Fallback: cualquier código ISO alfa-2 se convierte en emoji de bandera
function banderaEmoji(code) {
  return String.fromCodePoint(
    0x1F1E6 + code.charCodeAt(0) - 65,
    0x1F1E6 + code.charCodeAt(1) - 65
  );
}

function initCountryDropdown() {
  const wrap = document.getElementById('country-dropdown');
  const select = document.getElementById('pref-pais');
  const trigger = document.getElementById('country-dropdown-trigger');
  const menu = document.getElementById('country-dropdown-menu');
  const flagImg = document.getElementById('country-dropdown-flag');
  const globeSpan = document.getElementById('country-dropdown-globe');
  const labelEl = document.getElementById('country-dropdown-label');
  if (!wrap || !select || !trigger || !menu) return;

  // Construir el menú desde el <select> nativo (fuente única de verdad)
  for (const node of select.children) {
    if (node.tagName === 'OPTGROUP') {
      const header = document.createElement('li');
      header.className = 'country-dropdown__group';
      header.textContent = node.label;
      menu.appendChild(header);
      for (const opt of node.children) menu.appendChild(crearItem(opt));
    } else if (node.tagName === 'OPTION') {
      menu.appendChild(crearItem(node));
    }
  }

  function crearItem(opt) {
    const li = document.createElement('li');
    li.className = 'country-dropdown__item';
    li.dataset.value = opt.value;
    li.setAttribute('role', 'option');

    if (opt.value) {
      const img = document.createElement('img');
      img.className = 'country-dropdown__flag';
      img.src = `${FLAG_BASE_URL}${opt.value.toLowerCase()}.png`;
      img.alt = '';
      img.width = 24;
      img.height = 16;
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        const emoji = document.createElement('span');
        emoji.className = 'country-dropdown__flag-emoji';
        emoji.textContent = banderaEmoji(opt.value);
        img.replaceWith(emoji);
      });
      li.appendChild(img);
    } else {
      const globe = document.createElement('span');
      globe.className = 'country-dropdown__globe';
      globe.textContent = '🌐';
      li.appendChild(globe);
    }
    li.appendChild(document.createTextNode(!opt.value ? 'Otro / No especificar' : opt.textContent.replace(EMOJI_FLAG_RX, '')));
    return li;
  }

  function sincronizar() {
    const code = select.value || '';
    const selected = menu.querySelector(`.country-dropdown__item[data-value="${CSS.escape(code)}"]`);

    // Label + bandera del trigger
    if (code) {
      flagImg.src = `${FLAG_BASE_URL}${code.toLowerCase()}.png`;
      flagImg.removeAttribute('hidden');
      globeSpan.hidden = true;
      labelEl.textContent = selected ? selected.textContent.trim() : code;
      flagImg.onerror = () => {
        flagImg.hidden = true;
        globeSpan.textContent = banderaEmoji(code);
        globeSpan.hidden = false;
      };
    } else {
      flagImg.hidden = true;
      globeSpan.textContent = '🌐';
      globeSpan.hidden = false;
      labelEl.textContent = 'Otro / No especificar';
    }

    // Marcar item activo
    for (const item of menu.querySelectorAll('.country-dropdown__item')) {
      item.classList.toggle('is-selected', item.dataset.value === code);
    }
  }

  function abrir() { menu.classList.remove('hidden'); trigger.setAttribute('aria-expanded', 'true'); }
  function cerrar() { menu.classList.add('hidden'); trigger.setAttribute('aria-expanded', 'false'); }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.contains('hidden') ? abrir() : cerrar();
  });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.country-dropdown__item');
    if (!item) return;
    select.value = item.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sincronizar();
    cerrar();
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) cerrar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrar();
  });
  select.addEventListener('change', sincronizar);
  sincronizar();
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
  initAudio(); // primer gesto del usuario → habilita audio (autoplay policy)
  const genero    = _getRadio('genero-propio') || 'M';
  let prefGenero  = _getRadio('genero-buscar') || 'any';
  const pais      = _getRadio('pais') || '';

  // Pro-gate: si intentan filtrar Mujeres sin ser premium, caer a "any"
  if (prefGenero === 'F' && !estado.isPremium) {
    prefGenero = 'any';
    _setRadio('genero-buscar', 'any');
    mostrarToast('Solo usuarios Pro pueden filtrar por Mujeres');
  }

  estado.prefs = {
    genero:     estado.anonymousMode ? null : genero,
    prefGenero,
    pais:       estado.anonymousMode ? null : pais,
  };
  guardarPrefs({ genero, prefGenero, pais });
  ocultarPanelPrefs();
  // Búsqueda deliberada del usuario → salir del estado de pausa si estaba activo
  estado.pausado = false;
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
    .from('usuarios_perfil')
    .select('es_premium')
    .eq('id', session.user.id)
    .single();
  return data?.es_premium === true;
}

// ============================================================
// VAD (Voice Activity Detection)
// ============================================================
function _iniciarVADLocal() {
  const stream = estado.webrtc?.localStream;
  if (!stream) return;
  estado.vadLocal?.destroy();
  estado.vadLocal = new VoiceActivityDetector(stream, (speaking) => {
    document.getElementById('speaking-ring-local')?.classList.toggle('active', speaking);
  });
}

function _iniciarVADRemoto(stream) {
  estado.vadRemote?.destroy();
  estado.vadRemote = new VoiceActivityDetector(stream, (speaking) => {
    document.getElementById('speaking-ring-remote')?.classList.toggle('active', speaking);
  });
}

// ============================================================
// MODO ANÓNIMO
// ============================================================
function _iniciarModoAnonimo() {
  if (!ui.anonCheckbox) return;
  const saved = localStorage.getItem('anonymous_mode') === 'true';
  ui.anonCheckbox.checked = saved;
  estado.anonymousMode = saved;

  if (!estado.isPremium) {
    ui.anonCheckbox.disabled = true;
    document.getElementById('anon-toggle-label')?.setAttribute('title', 'Solo usuarios Premium');
  }

  ui.anonCheckbox.addEventListener('change', () => {
    if (!estado.isPremium) {
      ui.anonCheckbox.checked = false;
      mostrarToast('El modo anónimo es solo para usuarios Premium');
      return;
    }
    estado.anonymousMode = ui.anonCheckbox.checked;
    localStorage.setItem('anonymous_mode', String(estado.anonymousMode));
  });
}

// ============================================================
// MATCHMAKING
// ============================================================
// Aviso UI: si no hay pareja en 30s, mostramos mensaje (Fase 3 UX)
let _searchTimeout = null;

async function iniciarMatchmaking() {
  // Reset pause UI (la búsqueda deliberada la re-reactiva)
  document.getElementById('prefs-searching')?.classList.remove('is-paused');
  if (ui.btnPause) ui.btnPause.textContent = '⏸ Pausar';
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

    // Si se pausó mientras esperábamos, limpiar y salir
    if (estado.pausado) {
      await limpiarSlot(match.slotId);
      return;
    }

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
    if (!estado.pausado) setTimeout(iniciarMatchmaking, 3000);
    else setStatus('disconnected');
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

  // Cuando llegue el stream remoto → mostrar preview 5s para saltar
  estado.webrtc.onRemoteStream = (remoteStream) => {
    console.log('[App] Stream remoto recibido. Canal:', slotId, '| Rol:', role);
    _iniciarVADRemoto(remoteStream);
    _mostrarPreviewPareja(remoteStream);
  };

  // Si el peer se cae → mostrar overlay y buscar nuevo
  estado.webrtc.onDisconnected = () => {
    console.log('[App] Peer desconectado. Mostrando overlay...');
    mostrarDesconexionRemota();
  };

  // Suscribirse al canal Ably para recibir señales WebRTC
  const channel = getSignalingChannel(slotId);
  estado.chatChannel = channel;
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

      case 'chat':
        if (data.text) agregarMensajeChat(data.text, false);
        break;

      case 'reaction':
        if (data.emoji) estado.reactions?.receive(data.emoji);
        break;

      case 'sticker':
        if (data.emoji) agregarMensajeChat(data.emoji, false);
        break;

      case 'voice-msg':
        if (data.url && ui.chatMessages) {
          ui.chatMessages.appendChild(renderVoiceMsg(data.url, data.duration || 0, false));
          ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
        }
        break;

      case 'gift':
        if (data.emoji) estado.gifts?.receive(data.emoji);
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
let _previewTimer = null;

function _mostrarPreviewPareja(remoteStream) {
  const overlay   = document.getElementById('preview-overlay');
  const countdown = document.getElementById('preview-countdown');
  const btnSkip   = document.getElementById('btn-skip-preview');
  if (!overlay) {
    _confirmarConexion(remoteStream);
    return;
  }

  setStatus('connecting');
  overlay.classList.remove('hidden');

  let t = 5;
  countdown.textContent = `Conectando en ${t}...`;

  const onSkip = () => {
    clearInterval(_previewTimer);
    _previewTimer = null;
    overlay.classList.add('hidden');
    btnSkip.removeEventListener('click', onSkip);
    siguiente();
  };
  btnSkip.addEventListener('click', onSkip);

  _previewTimer = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(_previewTimer);
      _previewTimer = null;
      overlay.classList.add('hidden');
      btnSkip.removeEventListener('click', onSkip);
      _confirmarConexion(remoteStream);
    } else {
      countdown.textContent = `Conectando en ${t}...`;
    }
  }, 1000);
}

function _confirmarConexion(remoteStream) {
  estado.conectado = true;
  setStatus('connected');
  ui.btnReportar.disabled = false;
  habilitarChat();
}

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
  document.getElementById('disconnect-overlay')?.classList.add('hidden');
  if (_previewTimer) {
    clearInterval(_previewTimer);
    _previewTimer = null;
  }
  document.getElementById('preview-overlay')?.classList.add('hidden');
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
  // Reset pause state when moving to next
  estado.pausado = false;
  document.getElementById('prefs-searching')?.classList.remove('is-paused');
  if (ui.btnPause) ui.btnPause.textContent = '⏸ Pausar';

  ui.btnReportar.disabled = true;
  ui.btnSiguiente.disabled = true;
  estado.conectado = false;

  const slotAnterior = estado.slotId;
  estado.slotId            = null;
  estado.remoteFingerprint = null;
  estado.chatChannel       = null;
  deshabilitarChat();

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
  const mob = document.getElementById('btn-mute-mobile');
  if (mob) { mob.classList.toggle('muted', muteado); mob.title = ui.btnMute.title; }
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
  const mob = document.getElementById('btn-cam-mobile');
  if (mob) { mob.classList.toggle('muted', apagada); mob.title = ui.btnCam.title; }
}

// ============================================================
// EFECTOS DE SONIDO (mute del botón del header)
// ============================================================
function toggleSounds() {
  initAudio(); // el click es un gesto del usuario → habilita audio
  const estadoSonido = getSoundsEnabled();
  setSoundsEnabled(!estadoSonido);
  if (estadoSonido) stopSearching();
  ui.soundsMuted = estadoSonido;
  _refrescarBtnSonidos();
}

function _refrescarBtnSonidos() {
  if (!ui.btnSounds) return;
  const muted = !getSoundsEnabled();
  ui.soundsMuted = muted;
  ui.btnSounds.classList.toggle('muted', muted);
  ui.btnSounds.setAttribute('aria-pressed', String(muted));
  ui.btnSounds.title = muted ? 'Activar efectos de sonido' : 'Silenciar efectos de sonido';
  const mob = document.getElementById('btn-sounds-mobile');
  if (mob) { mob.classList.toggle('muted', muted); mob.setAttribute('aria-pressed', String(muted)); mob.title = ui.btnSounds.title; }
}

// ============================================================
// PAUSE / RESUME BÚSQUEDA
// ============================================================
function togglePausaBusqueda() {
  const searcher = document.getElementById('prefs-searching');
  if (!estado.pausado) {
    estado.pausado = true;
    ui.btnPause.textContent = '▶ Reanudar';
    setStatus('disconnected');
    searcher?.classList.add('is-paused');
    if (ui.placeholderTxt) ui.placeholderTxt.textContent = 'Búsqueda pausada';
    // Limpiar slot si estamos en cola
    if (estado.slotId) {
      limpiarSlot(estado.slotId);
      estado.slotId = null;
    }
    cleanupably();
    clearTimeout(_searchTimeout);
    document.getElementById('search-error')?.classList.add('hidden');
    const relaxEl = document.getElementById('search-relax');
    if (relaxEl) { relaxEl.textContent = ''; relaxEl.classList.add('hidden'); }
  } else {
    estado.pausado = false;
    if (ui.btnPause) ui.btnPause.textContent = '⏸ Pausar';
    searcher?.classList.remove('is-paused');
    if (ui.placeholderTxt) ui.placeholderTxt.textContent = 'Buscando pareja';
    const relaxEl = document.getElementById('search-relax');
    if (relaxEl) { relaxEl.textContent = ''; relaxEl.classList.add('hidden'); }
    // Limpia slots/latencia ably de la pausa y re-inicia búsqueda
    iniciarMatchmaking();
  }
}

// ============================================================
// CHAT DE TEXTO
// ============================================================
function habilitarChat() {
  if (ui.chatInput) ui.chatInput.disabled = false;
  if (ui.btnChatSend) ui.btnChatSend.disabled = false;
  if (ui.chatPlaceholder) ui.chatPlaceholder.remove();
  if (ui.btnSticker) ui.btnSticker.disabled = false;
  if (ui.btnGift) ui.btnGift.disabled = false;
  estado.reactions?.setChannel(estado.chatChannel, estado.fingerprint);
  estado.voiceMsgs?.setChannel(estado.chatChannel);
  estado.gifts?.setChannel(estado.chatChannel, estado.remoteFingerprint);
}

function deshabilitarChat() {
  if (ui.chatInput) { ui.chatInput.disabled = true; ui.chatInput.value = ''; }
  if (ui.btnChatSend) ui.btnChatSend.disabled = true;
  if (ui.btnSticker) ui.btnSticker.disabled = true;
  if (ui.btnGift) ui.btnGift.disabled = true;
  estado.reactions?.disable();
  estado.voiceMsgs?.disable();
  estado.stickers?.close();
  estado.gifts?.disable();
  estado.vadRemote?.destroy();
  estado.vadRemote = null;
  // Reset messages
  if (ui.chatMessages) {
    ui.chatMessages.innerHTML = '<p class="chat-placeholder" id="chat-placeholder">El chat estará disponible cuando te conectes con alguien.</p>';
    ui.chatPlaceholder = document.getElementById('chat-placeholder');
  }
}

function agregarMensajeChat(texto, esMio) {
  if (!ui.chatMessages) return;
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (esMio ? 'chat-msg--mine' : 'chat-msg--theirs');
  div.textContent = texto;
  ui.chatMessages.appendChild(div);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

function enviarMensajeChat() {
  const texto = ui.chatInput?.value?.trim();
  if (!texto || !estado.chatChannel || !estado.conectado) return;
  ui.chatInput.value = '';
  agregarMensajeChat(texto, true);
  estado.chatChannel.publish('message', { type: 'chat', text: texto, fingerprint: estado.fingerprint });
}

// ============================================================
// PARTNER INFO BADGE
// ============================================================
const PAIS_FLAGS = {
  AR:'🇦🇷',BO:'🇧🇴',BR:'🇧🇷',CL:'🇨🇱',CO:'🇨🇴',CR:'🇨🇷',CU:'🇨🇺',
  DO:'🇩🇴',EC:'🇪🇨',SV:'🇸🇻',GT:'🇬🇹',HN:'🇭🇳',MX:'🇲🇽',NI:'🇳🇮',
  PA:'🇵🇦',PY:'🇵🇾',PE:'🇵🇪',PR:'🇵🇷',UY:'🇺🇾',VE:'🇻🇪',
  ES:'🇪🇸',PT:'🇵🇹',CA:'🇨🇦',US:'🇺🇸',
  DE:'🇩🇪',AT:'🇦🇹',BE:'🇧🇪',HR:'🇭🇷',DK:'🇩🇰',SK:'🇸🇰',SI:'🇸🇮',
  EE:'🇪🇪',FI:'🇫🇮',FR:'🇫🇷',GR:'🇬🇷',HU:'🇭🇺',IE:'🇮🇪',IT:'🇮🇹',
  LV:'🇱🇻',LT:'🇱🇹',LU:'🇱🇺',MT:'🇲🇹',NO:'🇳🇴',NL:'🇳🇱',PL:'🇵🇱',
  CZ:'🇨🇿',RO:'🇷🇴',RU:'🇷🇺',SE:'🇸🇪',CH:'🇨🇭',TR:'🇹🇷',UA:'🇺🇦',GB:'🇬🇧',
  AU:'🇦🇺',CN:'🇨🇳',PH:'🇵🇭',IN:'🇮🇳',ID:'🇮🇩',JP:'🇯🇵',MY:'🇲🇾',
  NZ:'🇳🇿',KR:'🇰🇷',TH:'🇹🇭',VN:'🇻🇳',
  ZA:'🇿🇦',EG:'🇪🇬',IL:'🇮🇱',MA:'🇲🇦',SA:'🇸🇦',AE:'🇦🇪',
};
const GENERO_LABELS = { M: '♂ Hombre', F: '♀ Mujer', NB: '⚧ Otro' };
const GENERO_CLASS  = { M: 'gender--male', F: 'gender--female', NB: 'gender--nb' };

function mostrarInfoPareja(pais, genero) {
  const badge = document.getElementById('partner-info');
  const flagEl = document.getElementById('partner-flag');
  const labelEl = document.getElementById('partner-label');
  if (!badge) return;

  if (!pais && !genero) { badge.classList.add('hidden'); return; }

  const codePais = pais && PAIS_FLAGS[pais] ? pais : '';
  flagEl.innerHTML = codePais
    ? `<img class="partner-flag-img" src="${FLAG_BASE_URL}${codePais.toLowerCase()}.png" alt="" width="24" height="16">`
    : '';
  if (codePais) {
    const imgFlag = flagEl.querySelector('img');
    imgFlag.addEventListener('error', () => {
      const emoji = document.createElement('span');
      emoji.className = 'partner-flag-emoji';
      emoji.textContent = banderaEmoji(codePais);
      imgFlag.replaceWith(emoji);
    });
  }
  labelEl.textContent = genero && GENERO_LABELS[genero] ? GENERO_LABELS[genero] : '';
  badge.classList.remove('hidden');

  // Gender color on label
  labelEl.className = '';
  if (genero && GENERO_CLASS[genero]) labelEl.classList.add(GENERO_CLASS[genero]);

  // Verificar badge del partner
  estado.verification?.showPartnerBadge(badge, estado.remoteFingerprint);
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
  if (_tipInterval) { clearInterval(_tipInterval); _tipInterval = null; }
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

  // Efectos de sonido por estado (cualquier transición corta el radar, sin loops huérfanos)
  switch (nuevoEstado) {
    case 'searching':    playSearching();                       break;
    case 'connecting':   stopSearching();                       break;
    case 'connected':    stopSearching(); playConnected();      break;
    case 'disconnected': stopSearching(); playDisconnected();   break;
    default:             stopSearching();                       break;
  }

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

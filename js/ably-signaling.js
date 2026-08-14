/**
 * ably-signaling.js
 * Manejo del signaling de WebRTC usando canales Ably en lugar de WebSocket.
 * 
 * Flujo:
 * - Cada room (slot) tiene un canal Ably propio: "room_${slotId}"
 * - Usuario A: crea offer → ably.channel.publish("message", {type: "offer", sdp, ...})
 * - Usuario B: recibe message → crea answer → ably.channel.publish("message", {type: "answer", sdp, ...})
 * - ICE candidates: tipo "ice-candidate", publicados y suscritos en el mismo canal
 * 
 * NOTA: Este módulo usa ABLY_API_KEY hardcodeada (pública, sin riesgo).
 */

import { CONFIG } from './config.js';

let ablyRealtime = null;
let signalingChannel = null;
let myFingerprint = null;

/**
 * Inicializa Ably Realtime con la API key pública.
 * Llama una sola vez al inicio de la app.
 */
export function initably() {
  if (ablyRealtime) return ablyRealtime;

  try {
    ablyRealtime = new ably.Realtime({ key: CONFIG.ABLY_API_KEY });
    console.log('[Ably] Conectado a Realtime');
    return ablyRealtime;
  } catch (err) {
    console.error('[Ably] Error al inicializar Realtime:', err);
    throw err;
  }
}

/**
 * Obtiene (o crea) el canal de signaling para un slot ID determinado.
 * Cada slot → canal independiente → "room_${slotId}"
 * @param {string} slotId - ID del slot en sala_espera
 * @returns {ably.Channel}
 */
export function getSignalingChannel(slotId) {
  if (!signalingChannel || signalingChannel.name !== `room_${slotId}`) {
    // Si ya tenemos un canal abierto, subscribimos al nuevo; si no, lo creamos
    if (ablyRealtime) {
      signalingChannel = ablyRealtime.channels.get(`room_${slotId}`);
      // No suscribimos automáticamente; el usuario que se une subscribirá
      // y el que ya está envía mensajes
      return signalingChannel;
    }
  }
  return signalingChannel;
}

/**
 * Suscribe el cliente actual al canal de signaling de un slot.
 * Llena los listeners para recibir: offer, answer, ice-candidate.
 * @param {string} slotId - ID del slot
 * @param {function} onOffer - (messageData) => void
 * @param {function} onAnswer - (messageData) => void
 * @param {function} onIceCandidate - (messageData) => void
 */
export function subscribeSignaling(slotId, onOffer, onAnswer, onIceCandidate) {
  const channel = getSignalingChannel(slotId);
  if (!channel) {
    console.error('[Ably] No hay canal de signaling disponible');
    return;
  }

  channel.subscribe('message', (msg) => {
    const data = msg.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case 'offer':
        if (onOffer) onOffer(data);
        break;
      case 'answer':
        if (onAnswer) onAnswer(data);
        break;
      case 'ice-candidate':
        if (onIceCandidate) onIceCandidate(data);
        break;
      default:
        console.log('[Ably] Tipo de mensaje desconocido:', data.type);
    }
  });

  // Suscribirse al canal para recibir mensajes
  channel.attach();
  console.log('[Ably] Suscripto al canal:', channel.name);
}

/**
 * Publica un mensaje de "offer" en el canal de signaling.
 * El otro usuario deberá haber llamado a createAnswer y setLocalDescription.
 * @param {string} slotId - ID del slot
 * @param {RTCSessionDescriptionInit} offer - La oferta SDP
 * @param {string} fingerprint - Fingerprint local para identificación
 */
export async function publishOffer(slotId, offer, fingerprint) {
  const channel = getSignalingChannel(slotId);
  if (!channel) {
    console.error('[Ably] No hay canal para publicar offer');
    return;
  }

  await channel.publish('message', {
    type: 'offer',
    sdp: offer.sdp,
    fingerprint,
    sessionId: slotId,
  });
  console.log('[Ably] Publicado offer en canal:', slotId);
}

/**
 * Publica un mensaje de "answer" en el canal de signaling.
 * @param {string} slotId - ID del slot
 * @param {RTCSessionDescriptionInit} answer - La respuesta SDP
 * @param {string} fingerprint - Fingerprint del que responde
 */
export async function publishAnswer(slotId, answer, fingerprint) {
  const channel = getSignalingChannel(slotId);
  if (!channel) {
    console.error('[Ably] No hay canal para publicar answer');
    return;
  }

  await channel.publish('message', {
    type: 'answer',
    sdp: answer.sdp,
    fingerprint,
    sessionId: slotId,
  });
  console.log('[Ably] Publicado answer en canal:', slotId);
}

/**
 * Publica un candidato ICE en el canal de signaling.
 * @param {string} slotId - ID del slot
 * @param {RTCIceCandidateInit} candidate - El candidato ICE
 * @param {string} fingerprint - Fingerprint local
 */
export async function publishIceCandidate(slotId, candidate, fingerprint) {
  const channel = getSignalingChannel(slotId);
  if (!channel) {
    console.error('[Ably] No hay canal para publicar ICE candidate');
    return;
  }

  await channel.publish('message', {
    type: 'ice-candidate',
    candidate: candidate.toJSON(),
    fingerprint,
    sessionId: slotId,
  });
  console.log('[Ably] Publicado ICE candidate en canal:', slotId);
}

/**
 * Desconecta y limpia los recursos de Ably.
 * Llamar al cambiar de sala ("Siguiente").
 */
export function cleanupably() {
  if (signalingChannel) {
    signalingChannel.detach();
    signalingChannel = null;
  }
  console.log('[Ably] Limpieza de signaling completada');
}
/**
 * matchmaking.js
 * Empareja a dos usuarios usando la tabla `sala_espera` en Supabase.
 * El signaling de `pareja encontrada` usa Ably Realtime canales en lugar de
 * WebSocket/Supabase Realtime persistencias.
 *
 * FLUJO:
 * 1. Buscar si hay alguien esperando (que no seamos nosotros) en Supabase.
 * 2. Si sí → actualizar su slot con nuestro fingerprint (atomic update) → publicar mensaje en Ably.
 * 3. Si no → crear nuestro propio slot y suscribirnos con Ably.
 * 4. Cuando se activa el slot → recibir mensaje en canal Ably → unirse al canal de Agora.
 *
 * La race condition (dos usuarios tomando el mismo slot) se maneja con
 * el filtro `.eq('estado', 'esperando')` en el UPDATE — si ya fue tomado,
 * el update no afecta filas y reintentamos.
 *
 * El slot persiste en Supabase (para compartir el channelName de Agora),
 * pero la notificación de `partner found` usa Ably channels.
 */

import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';
import { initably, getSignalingChannel, subscribeSignaling, cleanupably } from './ably-signaling.js';

let _ablySubscriptionSlotId = null;

/**
 * Busca y empareja con otro usuario disponible.
 * @param {string} miFingerprint - ID del dispositivo local
 * @returns {Promise<{channelName: string, slotId: string, remoteFingerprint: string, role: string, ofertaSDP?: string}>}
 */
export async function buscarPareja(miFingerprint) {
  // 1. Limpiar slots viejos (inactivos > 30s) para no quedarse enganchado
  await _limpiarSlotsViejos();

  // 2. ¿Hay alguien esperando?
  const { data: esperando } = await supabase
    .from('sala_espera')
    .select('*')
    .eq('estado', 'esperando')
    .neq('fingerprint_a', miFingerprint)
    .order('creado_en', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (esperando) {
    // 3a. Intentar tomar el slot (atomic update)
    const { data: tomado, error } = await supabase
      .from('sala_espera')
      .update({ fingerprint_b: miFingerprint, estado: 'conectado' })
      .eq('id', esperando.id)
      .eq('estado', 'esperando') // solo si sigue esperando
      .select()
      .maybeSingle();

    if (!error && tomado) {
      const slotId = tomado.id;
      const channelName = tomado.channel_name;
      const remoteFingerprint = tomado.fingerprint_a;
      console.log('[Match] Match found:', remoteFingerprint, '| slot:', slotId);

      // Notificar a User A que encontramos pareja via Ably
      initably();
      const ch = getSignalingChannel(slotId);
      if (ch) {
        await ch.attach();
        await ch.publish('message', { type: 'match-found', fingerprint: miFingerprint });
        console.log('[Match] Confirmed');
      }

      return {
        channelName,
        slotId,
        remoteFingerprint,
        role: 'publisher',
      };
    }

    // Slot ya tomado por otro → reintentar
    console.log('[Matchmaking] Race condition detectado. Reintentando...');
    return buscarPareja(miFingerprint);
  }

  // 3b. No hay nadie → crear nuestro slot
  const channelName = 'ch_' + crypto.randomUUID().split('-')[0];

  const { data: miSlot, error: insertError } = await supabase
    .from('sala_espera')
    .insert({ fingerprint_a: miFingerprint, channel_name: channelName, estado: 'esperando' })
    .select()
    .single();

  if (insertError) throw insertError;

  const slotId = miSlot.id;
  console.log('[Match] Entered queue:', miFingerprint, '| slot:', slotId);

  return new Promise((resolve, reject) => {
    initably();

    let resolved = false;

    const onMatchMessage = (msgData) => {
      if (resolved) return;
      if (msgData.type === 'match-found' || msgData.type === 'offer') {
        resolved = true;
        clearTimeout(timeoutId);
        console.log('[Match] Match found (incoming):', msgData.fingerprint);
        console.log('[Match] Confirmed');
        resolve({
          channelName,
          slotId,
          remoteFingerprint: msgData.fingerprint,
          role: 'subscriber',
        });
      }
    };

    subscribeSignaling(slotId, onMatchMessage, () => {}, () => {});

    const timeoutId = setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      console.log('[Matchmaking] Timeout. Reintentando...');
      cleanupably();
      await limpiarSlot(slotId);
      resolve(buscarPareja(miFingerprint));
    }, CONFIG.MATCHMAKING_TIMEOUT);
  });
}

/**
 * Elimina un slot de la sala de espera (al presionar "Siguiente" o desconectarse).
 * @param {string} slotId - UUID del slot en sala_espera
 */
export async function limpiarSlot(slotId) {
  if (!slotId) return;

  cleanupably();

  const { error } = await supabase
    .from('sala_espera')
    .delete()
    .eq('id', slotId);

  if (error) console.error('[Matchmaking] Error al limpiar slot:', error);
}

/**
 * Limpia slots de más de 30 segundos en estado "esperando" (usuarios que se fueron sin limpiar).
 */
async function _limpiarSlotsViejos() {
  const limite = new Date(Date.now() - CONFIG.SLOT_CLEANUP_AGE).toISOString();
  await supabase
    .from('sala_espera')
    .delete()
    .eq('estado', 'esperando')
    .lt('creado_en', limite);
}

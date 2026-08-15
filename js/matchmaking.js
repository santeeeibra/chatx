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
import { checkBan } from './bans.js';
import { CONFIG } from './config.js';
import { initably, getSignalingChannel, subscribeSignaling, cleanupably } from './ably-signaling.js';

let _ablySubscriptionSlotId = null;

/**
 * Busca y empareja con otro usuario disponible.
 * @param {string} miFingerprint - ID del dispositivo local
 * @param {object} prefs - { genero, prefGenero, pais } opcionales
 * @param {number} relaxLevel - 0: filtro completo, 1: sin país, 2: sin filtros
 * @param {function} onRelax - callback(level) cuando se relajan los filtros
 * @returns {Promise<{channelName, slotId, remoteFingerprint, role}>}
 */
export async function buscarPareja(miFingerprint, prefs = {}, relaxLevel = 0, onRelax = null) {
  // 0. Verificar ban activo antes de entrar a la cola (defensa en profundidad)
  await _verificarBanActivo(miFingerprint);

  // 1. Limpiar slots viejos (inactivos > 30s) para no quedarse enganchado
  await _limpiarSlotsViejos();

  // 2. ¿Hay alguien esperando?
  let query = supabase
    .from('sala_espera')
    .select('*')
    .eq('estado', 'esperando')
    .neq('fingerprint_a', miFingerprint)
    .order('creado_en', { ascending: true })
    .limit(1);

  if (relaxLevel < 2) {
    if (prefs.prefGenero && prefs.prefGenero !== 'any') {
      query = query.eq('genero_a', prefs.prefGenero);
    }
    if (prefs.pais && relaxLevel < 1) {
      query = query.eq('pais_a', prefs.pais);
    }
  }

  const { data: esperando } = await query.maybeSingle();

  if (esperando) {
    // 3a. Intentar tomar el slot (atomic update)
    const { data: tomado, error } = await supabase
      .from('sala_espera')
      .update({ fingerprint_b: miFingerprint, estado: 'conectado' })
      .eq('id', esperando.id)
      .eq('estado', 'esperando')
      .select()
      .maybeSingle();

    if (!error && tomado) {
      const slotId = tomado.id;
      const channelName = tomado.channel_name;
      const remoteFingerprint = tomado.fingerprint_a;
      console.log('[Match] Match found:', remoteFingerprint, '| slot:', slotId);

      initably();
      const ch = getSignalingChannel(slotId);
      if (ch) {
        await ch.attach();
        await ch.publish('message', { type: 'match-found', fingerprint: miFingerprint });
        console.log('[Match] Confirmed');
      }

      return { channelName, slotId, remoteFingerprint, role: 'publisher' };
    }

    // Slot ya tomado por otro → reintentar
    console.log('[Matchmaking] Race condition detectado. Reintentando...');
    return buscarPareja(miFingerprint, prefs, relaxLevel, onRelax);
  }

  // 3b. No hay nadie → crear nuestro slot
  const channelName = 'ch_' + crypto.randomUUID().split('-')[0];

  const slotData = {
    fingerprint_a: miFingerprint,
    channel_name: channelName,
    estado: 'esperando',
    genero_a: prefs.genero || null,
    pref_genero_a: prefs.prefGenero || null,
    pais_a: prefs.pais || null,
  };

  const { data: miSlot, error: insertError } = await supabase
    .from('sala_espera')
    .insert(slotData)
    .select()
    .single();

  if (insertError) throw insertError;

  const slotId = miSlot.id;
  console.log('[Match] Entered queue:', miFingerprint, '| slot:', slotId, '| relax:', relaxLevel);

  return new Promise((resolve, reject) => {
    initably();

    let resolved = false;

    const onMatchMessage = (msgData) => {
      if (resolved) return;
      if (msgData.type === 'match-found' || msgData.type === 'offer') {
        resolved = true;
        clearTimeout(timeoutId);
        console.log('[Match] Match found (incoming):', msgData.fingerprint);
        resolve({
          channelName,
          slotId,
          remoteFingerprint: msgData.fingerprint,
          role: 'subscriber',
        });
      }
    };

    subscribeSignaling(slotId, onMatchMessage, () => {}, () => {});

    const nextRelaxLevel = relaxLevel + 1;
    const timeoutId = setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      cleanupably();
      await limpiarSlot(slotId);

      if (nextRelaxLevel <= 2) {
        console.log('[Matchmaking] Timeout. Relajando filtros a nivel', nextRelaxLevel);
        if (onRelax) onRelax(nextRelaxLevel);
      } else {
        console.log('[Matchmaking] Timeout. Reintentando sin filtros...');
      }

      resolve(buscarPareja(miFingerprint, prefs, Math.min(nextRelaxLevel, 2), onRelax));
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

/**
 * Verifica si el fingerprint tiene un ban activo; si lo tiene, lanza un error
 * con la propiedad `.ban` para que el controlador muestre la UI de bloqueo.
 * @param {string} fingerprint
 */
async function _verificarBanActivo(fingerprint) {
  const ban = await checkBan(fingerprint);
  if (ban) {
    console.warn('[Matchmaking] Bloqueado: ban ' + ban.tipo + ' activo para ' + fingerprint);
    const err = new Error('DEVICE_BANNED');
    err.ban = ban;
    throw err;
  }
}

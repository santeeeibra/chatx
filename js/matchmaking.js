/**
 * matchmaking.js
 * Empareja a dos usuarios usando la tabla `sala_espera` en Supabase.
 *
 * FLUJO:
 * 1. Buscar si hay alguien esperando (que no seamos nosotros).
 * 2. Si sí → actualizar su slot con nuestro fingerprint (atomic update).
 * 3. Si no → crear nuestro propio slot y suscribirnos con Realtime.
 * 4. Cuando se activa el slot → unirse al canal de Agora.
 *
 * La race condition (dos usuarios tomando el mismo slot) se maneja con
 * el filtro `.eq('estado', 'esperando')` en el UPDATE — si ya fue tomado,
 * el update no afecta filas y reintentamos.
 */

import { supabase } from './supabase-client.js';
import { CONFIG }   from './config.js';

let _realtimeChannel = null; // Suscripción activa de Realtime

/**
 * Busca y empareja con otro usuario disponible.
 * @param {string} miFingerprint - ID del dispositivo local
 * @returns {Promise<{channelName: string, slotId: string, remoteFingerprint: string, role: string}>}
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
      console.log('[Matchmaking] Pareja encontrada. Canal:', tomado.channel_name);
      return {
        channelName:       tomado.channel_name,
        slotId:            tomado.id,
        remoteFingerprint: tomado.fingerprint_a,
        role:              'subscriber',
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

  console.log('[Matchmaking] Slot creado. Esperando pareja...', miSlot.id);

  // 4. Esperar a que alguien tome el slot via Realtime
  return _esperarParejaConRealtime(miSlot, channelName, miFingerprint);
}

/**
 * Suscribirse al slot via Realtime y resolver cuando alguien se una.
 * Incluye timeout para reintentar si nadie aparece en MATCHMAKING_TIMEOUT ms.
 */
function _esperarParejaConRealtime(miSlot, channelName, miFingerprint) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const channelKey = `slot_${miSlot.id}`;

    _realtimeChannel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sala_espera', filter: `id=eq.${miSlot.id}` },
        (payload) => {
          if (payload.new.estado === 'conectado' && payload.new.fingerprint_b) {
            clearTimeout(timeoutId);
            _realtimeChannel?.unsubscribe();
            _realtimeChannel = null;

            console.log('[Matchmaking] Pareja llegó al slot. Canal:', channelName);
            resolve({
              channelName,
              slotId:            miSlot.id,
              remoteFingerprint: payload.new.fingerprint_b,
              role:              'publisher',
            });
          }
        }
      )
      .subscribe();

    // Timeout → nadie vino, limpiar slot y reintentar
    timeoutId = setTimeout(async () => {
      _realtimeChannel?.unsubscribe();
      _realtimeChannel = null;
      await limpiarSlot(miSlot.id);
      console.log('[Matchmaking] Timeout. Reintentando...');
      resolve(buscarPareja(miFingerprint)); // reintentar
    }, CONFIG.MATCHMAKING_TIMEOUT);
  });
}

/**
 * Elimina un slot de la sala de espera (al presionar "Siguiente" o desconectarse).
 * @param {string} slotId - UUID del slot en sala_espera
 */
export async function limpiarSlot(slotId) {
  if (!slotId) return;

  _realtimeChannel?.unsubscribe();
  _realtimeChannel = null;

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

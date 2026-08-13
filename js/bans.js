/**
 * bans.js
 * Toda la lógica de bans: verificar si alguien está baneado y aplicar bans.
 *
 * Reglas de negocio:
 *   - Usuario anónimo: 1er reporte → 24h ban | 2do reporte → permanente
 *   - Usuario registrado: 1er reporte → 5h suspensión | siguiente → revisión manual
 *   - Usuario premium:   1er reporte → 2h suspensión
 */

import { supabase } from './supabase-client.js';

/**
 * Verifica si un fingerprint tiene un ban activo.
 * @param {string} fingerprint
 * @returns {Promise<object|null>} Registro de ban si existe, null si libre
 */
export async function checkBan(fingerprint) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('bans')
    .select('*')
    .eq('fingerprint_id', fingerprint)
    .or(`expira_en.is.null,expira_en.gt.${now}`)  // permanente O no expirado aún
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[Bans] Error al verificar ban:', error);
    return null; // En caso de error, dejar pasar (fail open)
  }

  return data; // null si no hay ban activo
}

/**
 * Aplica un ban a un fingerprint.
 * @param {string} fingerprint - ID del dispositivo a banear
 * @param {'24h'|'5h'|'2h'|'permanente'} tipo - Tipo de ban
 * @param {string|null} userId - User ID si está registrado (opcional)
 * @param {string} razon - Motivo del ban
 */
export async function applyBan(fingerprint, tipo, userId = null, razon = 'Reportado por otro usuario') {
  let expiraEn = null;

  const duraciones = {
    '2h':  2  * 60 * 60 * 1000,
    '5h':  5  * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };

  if (duraciones[tipo]) {
    expiraEn = new Date(Date.now() + duraciones[tipo]).toISOString();
  }
  // si tipo === 'permanente', expiraEn queda null

  const { error } = await supabase
    .from('bans')
    .insert({
      fingerprint_id: fingerprint,
      user_id:        userId,
      tipo,
      expira_en:      expiraEn,
      razon,
    });

  if (error) {
    console.error('[Bans] Error al aplicar ban:', error);
    throw error;
  }

  console.log(`[Bans] Ban aplicado: ${tipo} a ${fingerprint}`);
}

/**
 * Cuenta cuántos bans previos (incluyendo expirados) tiene un fingerprint.
 * Usado para decidir si escalar a permanente.
 * @param {string} fingerprint
 * @returns {Promise<number>}
 */
export async function countBanHistory(fingerprint) {
  const { count, error } = await supabase
    .from('bans')
    .select('*', { count: 'exact', head: true })
    .eq('fingerprint_id', fingerprint);

  if (error) {
    console.error('[Bans] Error al contar historial de bans:', error);
    return 0;
  }

  return count ?? 0;
}

/**
 * Formatea el tiempo restante de un ban para mostrar al usuario.
 * @param {string} expiraEn - ISO timestamp de expiración
 * @returns {string} Texto formateado "Xh Ym Zs"
 */
export function formatTiempoRestante(expiraEn) {
  const restante = new Date(expiraEn) - new Date();
  if (restante <= 0) return 'Ya podés volver a ingresar';

  const h = Math.floor(restante / 3_600_000);
  const m = Math.floor((restante % 3_600_000) / 60_000);
  const s = Math.floor((restante % 60_000) / 1_000);

  const partes = [];
  if (h > 0) partes.push(`${h}h`);
  if (m > 0) partes.push(`${m}m`);
  partes.push(`${s}s`);

  return partes.join(' ');
}

/**
 * reportes.js
 * Guarda el reporte en Supabase y aplica el ban correspondiente al reportado.
 *
 * LÓGICA DE ESCALADA:
 *   - Sin historial de bans previos → 24h ban
 *   - Con historial (ya fue baneado antes) → ban permanente
 *
 * ⚠️ Para producción: mover esta lógica a un Supabase Edge Function
 *    para que no pueda ser manipulada desde el cliente.
 */

import { supabase }                      from './supabase-client.js';
import { applyBan, countBanHistory }     from './bans.js';
import { getFingerprint }                from './fingerprint.js';

/**
 * Reporta a un usuario remoto y aplica el ban según su historial.
 * @param {string} reportadoFingerprint  - Fingerprint del usuario reportado
 * @param {string} reportanteFingerprint - Fingerprint del usuario que reporta
 * @param {string} slotId               - ID de la sesión actual (trazabilidad)
 */
export async function reportarUsuario(reportadoFingerprint, reportanteFingerprint, slotId = null, razon = null, comentario = null) {
  try {
    // 1. Guardar reporte en la DB
    const { error: reporteError } = await supabase
      .from('reportes')
      .insert({
        reportado_fingerprint:   reportadoFingerprint,
        reportante_fingerprint:  reportanteFingerprint,
        sesion_id:               slotId,
        razon,
        comentario,
      });

    if (reporteError) {
      console.error('[Reportes] Error al guardar reporte:', reporteError);
      return;
    }

    console.log(`[Reportes] Reporte guardado contra ${reportadoFingerprint}`);

    // 2. Contar bans previos para decidir tipo
    const bansPrevios = await countBanHistory(reportadoFingerprint);

    const tipoBan = bansPrevios > 0 ? 'permanente' : '24h';

    // 3. Aplicar ban
    await applyBan(reportadoFingerprint, tipoBan, null, 'Reportado por otro usuario');

    console.log(`[Reportes] Ban aplicado: ${tipoBan}`);

  } catch (err) {
    console.error('[Reportes] Error inesperado:', err);
  }
}

/**
 * reportUser(reportadoFingerprint)
 * Alias de alto nivel de reportarUsuario: el reportante es el dispositivo actual.
 * Logica: 1er reporte -> ban 24h, siguiente reporte -> ban permanente.
 *
 * @param {string} reportadoFingerprint - Fingerprint del usuario reportado
 * @param {string|null} slotId    - ID de la sesion actual (trazabilidad)
 * @param {string|null} razon     - Motivo del reporte
 * @param {string|null} comentario - Detalle adicional del reporte
 * @returns {Promise<boolean>} true si el reporte se proceso correctamente
 */
export async function reportUser(reportadoFingerprint, slotId = null, razon = null, comentario = null) {
  if (!reportadoFingerprint) {
    console.warn('[Reportes] reportUser sin fingerprint de reportado.');
    return false;
  }
  const reportanteFingerprint = await getFingerprint();
  await reportarUsuario(reportadoFingerprint, reportanteFingerprint, slotId, razon, comentario);
  return true;
}

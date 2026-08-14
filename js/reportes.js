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

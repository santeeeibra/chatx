/**
 * fingerprint.js
 * Genera un ID unico por dispositivo/navegador usando FingerprintJS.
 * Este ID es la identidad del usuario anonimo (-> usarlo como user identifier).
 *
 * FingerprintJS es probabilistico, no 100% infalible.
 *    Para mayor robustez combinar con IP (via Edge Function en Supabase).
 */

/**
 * Obtiene el fingerprint del dispositivo.
 * Fingerprints reales -> "fp_<visitorId>". Fallback (FingerprintJS bloqueado/error)
 * -> "anon_<id>" persistido en localStorage para mantener identidad estable entre sesiones.
 * @returns {Promise<string>} ID unico del dispositivo
 */
export async function getFingerprint() {
  try {
    if (typeof FingerprintJS === 'undefined') throw new Error('bloqueado');
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    return 'fp_' + result.visitorId;
  } catch (e) {
    console.warn('[Fingerprint] Usando ID fallback:', e?.message || e);
    // Fallback: ID aleatorio persistido en localStorage
    let id = localStorage.getItem('anon_id');
    if (!id) {
      id = 'anon_' + Math.random().toString(36).slice(2, 11);
      localStorage.setItem('anon_id', id);
    }
    return id;
  }
}
/**
 * fingerprint.js
 * Genera y cachea un ID único por dispositivo/navegador usando FingerprintJS.
 * Este ID es la identidad del usuario anónimo → usarlo como user identifier.
 *
 * ⚠️ FingerprintJS es probabilístico, no 100% infalible.
 *    Para mayor robustez combinar con IP (via Edge Function en Supabase).
 */

let _cachedFingerprint = null;

/**
 * Obtiene el fingerprint del dispositivo.
 * Lo cachea en memoria y en sessionStorage para la sesión actual.
 * @returns {Promise<string>} visitorId único del dispositivo
 */
export async function getFingerprint() {
  // 1. Usar caché en memoria si ya lo tenemos
  if (_cachedFingerprint) return _cachedFingerprint;

  // 2. Intentar desde sessionStorage (persiste durante la sesión del browser)
  const cached = sessionStorage.getItem('chatx_fp');
  if (cached) {
    _cachedFingerprint = cached;
    return cached;
  }

  // 3. Generar nuevo fingerprint
  try {
    const fp = await window.FingerprintJS.load();
    const result = await fp.get();
    const visitorId = result.visitorId;

    _cachedFingerprint = visitorId;
    sessionStorage.setItem('chatx_fp', visitorId);
    return visitorId;
  } catch (err) {
    console.error('[Fingerprint] Error al generar fingerprint:', err);
    // Fallback: ID aleatorio que dura la sesión
    const fallback = 'anon_' + Math.random().toString(36).substr(2, 16);
    sessionStorage.setItem('chatx_fp', fallback);
    _cachedFingerprint = fallback;
    return fallback;
  }
}

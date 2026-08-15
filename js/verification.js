/**
 * verification.js — Badge de perfil verificado
 * Verificación manual por moderadores (integración Face++ futura).
 * Badge ✓ visible en la info del partner cuando está verificado.
 */

import { supabase } from './supabase-client.js';
import { getVerificationStatus, requestVerification as reqVerif } from './supabase-client.js';

export class VerificationManager {
  constructor() {
    this.myVerified = false;
  }

  async checkMyStatus() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      this.myVerified = await getVerificationStatus(session.user.id);
    } catch (_) {}
  }

  // Llama esto cuando mostrás la info del partner
  async showPartnerBadge(containerEl, remoteFingerprint) {
    const existing = containerEl.querySelector('.verified-badge');
    if (existing) existing.remove();

    if (!remoteFingerprint) return;

    try {
      const { data } = await supabase
        .from('usuarios_perfil')
        .select('verified')
        .eq('fingerprint', remoteFingerprint)
        .maybeSingle();

      if (data?.verified) {
        const badge = document.createElement('span');
        badge.className = 'verified-badge';
        badge.title = 'Perfil verificado';
        badge.textContent = '✓';
        containerEl.appendChild(badge);
      }
    } catch (_) {}
  }

  // Solicitar verificación del propio perfil
  async requestVerification(fingerprint) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return { error: 'Necesitás iniciar sesión para verificar tu perfil.' };
    }
    return reqVerif(session.user.id, fingerprint);
  }
}

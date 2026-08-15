/**
 * supabase-client.js
 * Instancia única de Supabase para toda la app.
 * Los SDKs cargados por CDN en el HTML exponen `window.supabase`.
 */

import { CONFIG } from './config.js';

export const supabase = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

// ─── Gifts / balances ─────────────────────────────────────────

export async function getBalance(fingerprint) {
  const { data } = await supabase
    .from('user_balances')
    .select('coins')
    .eq('fingerprint', fingerprint)
    .maybeSingle();

  if (data) return data.coins;

  // Primera vez: crear fila con 100 monedas gratis
  await supabase.from('user_balances').insert({ fingerprint, coins: 100 });
  return 100;
}

export async function recordGift(fromFp, toFp, giftId, coinsSpent) {
  await supabase.from('gift_transactions').insert({
    from_fingerprint: fromFp,
    to_fingerprint:   toFp,
    gift_id:          giftId,
    coins_spent:      coinsSpent,
  });

  // Actualizar saldo del remitente en DB
  const current = await getBalance(fromFp);
  await supabase.from('user_balances').upsert(
    { fingerprint: fromFp, coins: Math.max(0, current - coinsSpent), updated_at: new Date().toISOString() },
    { onConflict: 'fingerprint' }
  );
}

// ─── Verification ─────────────────────────────────────────────

export async function getVerificationStatus(userId) {
  const { data } = await supabase
    .from('usuarios_perfil')
    .select('verified')
    .eq('id', userId)
    .maybeSingle();
  return data?.verified === true;
}

export async function requestVerification(userId, fingerprint) {
  const { error } = await supabase.from('verification_requests').insert({
    user_id:     userId,
    fingerprint,
    status:      'pending',
  });
  return { error: error?.message ?? null };
}

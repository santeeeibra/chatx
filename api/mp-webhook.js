// MercadoPago subscription webhook.
// MP sends POST with { type: 'subscription_preapproval', data: { id } }
// Signature header format: x-signature: ts=<ts>,v1=<hmac-sha256>
// Signed template: id:<data.id>;request-id:<x-request-id>;ts:<ts>

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const PLAN_DURATION_MS = {
  monthly: 31 * 24 * 60 * 60 * 1000,
  weekly:  7  * 24 * 60 * 60 * 1000,
  '2day':  2  * 24 * 60 * 60 * 1000,
};

function verifyMpSignature(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev if not set

  const xSignature  = req.headers['x-signature']  ?? '';
  const xRequestId  = req.headers['x-request-id'] ?? '';

  const tsMatch = xSignature.match(/ts=(\d+)/);
  const v1Match = xSignature.match(/v1=([a-f0-9]+)/);
  if (!tsMatch || !v1Match) return false;

  const ts       = tsMatch[1];
  const received = v1Match[1];
  const template = `id:${dataId};request-id:${xRequestId};ts:${ts}`;
  const expected = crypto.createHmac('sha256', secret).update(template).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, data } = req.body ?? {};

  // Only handle preapproval events
  if (type !== 'subscription_preapproval' || !data?.id) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  // Verify MP signature — reject forged requests
  if (!verifyMpSignature(req, data.id)) {
    console.error('[MP Webhook] Invalid signature — request rejected');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Fetch the preapproval details from MP
  const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });

  if (!mpRes.ok) {
    console.error('[MP Webhook] Failed to fetch preapproval', data.id);
    return res.status(502).end();
  }

  const preapproval = await mpRes.json();
  const { id: mp_subscription_id, status, external_reference, payer_email } = preapproval;

  // external_reference format: "user_id|plan"
  const [user_id, plan] = (external_reference ?? '').split('|');
  if (!user_id) {
    console.error('[MP Webhook] Missing external_reference', external_reference);
    return res.status(200).json({ ok: true });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  if (status === 'authorized') {
    const durationMs = PLAN_DURATION_MS[plan] ?? PLAN_DURATION_MS.monthly;
    const premium_until = new Date(Date.now() + durationMs).toISOString();

    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id,
        is_premium: true,
        premium_until,
        mp_subscription_id,
        mp_plan: plan,
        mp_status: status,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) console.error('[MP Webhook] Supabase upsert error', error);
    else console.log('[MP Webhook] Premium activated', user_id, plan);
  }

  if (['cancelled', 'paused'].includes(status)) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ is_premium: false, mp_status: status, updated_at: new Date().toISOString() })
      .eq('user_id', user_id);

    if (error) console.error('[MP Webhook] Supabase update error', error);
    else console.log('[MP Webhook] Premium revoked', status, user_id);
  }

  return res.status(200).json({ ok: true });
}

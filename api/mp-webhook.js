import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Verificar firma de MP ────────────────────────────────────
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!xSignature) return res.status(400).json({ error: 'missing signature' });

  const parts = Object.fromEntries(
    xSignature.split(',').map(p => p.trim().split('='))
  );
  const { ts, v1 } = parts;
  const notificationId = req.body?.data?.id;
  const manifest = `id:${notificationId};request-id:${xRequestId};ts:${ts};`;

  const expected = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  if (expected !== v1) return res.status(401).json({ error: 'invalid signature' });

  // ── Solo manejar eventos de suscripción ─────────────────────
  const { type, data } = req.body;
  if (type !== 'subscription_preapproval') return res.status(200).json({ ok: true });

  // ── Fetch detalles desde MP API ──────────────────────────────
  const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  if (!mpRes.ok) return res.status(502).json({ error: 'mp api error' });
  const sub = await mpRes.json();

  // external_reference debe ser el user_id de Supabase
  const userId = sub.external_reference;
  if (!userId) return res.status(200).json({ ok: true, skipped: 'no external_reference' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (sub.status === 'authorized') {
    await supabase
      .from('user_profiles')
      .update({ is_premium: true, premium_until: sub.next_payment_date })
      .eq('user_id', userId);
  } else if (['cancelled', 'paused'].includes(sub.status)) {
    await supabase
      .from('user_profiles')
      .update({ is_premium: false, premium_until: null })
      .eq('user_id', userId);
  }

  return res.status(200).json({ ok: true });
}

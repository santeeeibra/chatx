const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

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

  const { type, data } = req.body;
  if (type !== 'subscription_preapproval') return res.status(200).json({ ok: true });

  const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  if (!mpRes.ok) return res.status(502).json({ error: 'mp api error' });
  const sub = await mpRes.json();

  const userId = sub.external_reference;
  if (!userId) return res.status(200).json({ ok: true, skipped: 'no external_reference' });

  const patch = sub.status === 'authorized'
    ? { is_premium: true, premium_until: sub.next_payment_date }
    : { is_premium: false, premium_until: null };

  await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });

  return res.status(200).json({ ok: true });
};

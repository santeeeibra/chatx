const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Parsear body si viene como string
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};

    // Verificar firma de MP (omitir si no viene — e.g. simulaciones de MP)
    const xSignature = req.headers['x-signature'];
    if (xSignature && process.env.MP_WEBHOOK_SECRET) {
      const xRequestId = req.headers['x-request-id'] || '';
      const notificationId = body?.data?.id || '';
      const parts = {};
      xSignature.split(',').forEach(p => {
        const idx = p.indexOf('=');
        if (idx !== -1) parts[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
      });
      const { ts = '', v1 = '' } = parts;
      const manifest = `id:${notificationId};request-id:${xRequestId};ts:${ts};`;
      const expected = crypto
        .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
        .update(manifest)
        .digest('hex');
      if (expected !== v1) return res.status(401).json({ error: 'invalid signature' });
    }

    const { type, data } = body;
    if (type !== 'subscription_preapproval') return res.status(200).json({ ok: true });

    const subId = data?.id;
    if (!subId) return res.status(200).json({ ok: true, skipped: 'no id' });

    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${subId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) {
      const err = await mpRes.text();
      return res.status(200).json({ ok: false, mp_error: err });
    }
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

  } catch (err) {
    console.error('[mp-webhook] error:', err);
    return res.status(500).json({ error: 'internal error', message: err.message });
  }
};

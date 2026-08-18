const PLANS = {
  monthly: {
    reason: 'CamReal Premium — Mensual',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: 35000,
      currency_id: 'ARS',
    },
  },
  weekly: {
    reason: 'CamReal Premium — Semanal',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'weeks',
      transaction_amount: 9900,
      currency_id: 'ARS',
    },
  },
  days3: {
    reason: 'CamReal Premium — 3 días',
    auto_recurring: {
      frequency: 3,
      frequency_type: 'days',
      transaction_amount: 3900,
      currency_id: 'ARS',
      free_trial: {
        frequency: 1,
        frequency_type: 'days',
      },
    },
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const { plan } = req.body || {};
  const selectedPlan = PLANS[plan];
  if (!selectedPlan) return res.status(400).json({ error: 'invalid plan' });

  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'invalid token' });
  const user = await userRes.json();

  const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...selectedPlan,
      external_reference: user.id,
      payer_email: user.email,
      back_url: 'https://chatreal.live/premium.html',
      status: 'pending',
    }),
  });

  const mpData = await mpRes.json();
  if (!mpRes.ok) return res.status(502).json({ error: 'mp error', detail: mpData });

  return res.status(200).json({ url: mpData.init_point });
};

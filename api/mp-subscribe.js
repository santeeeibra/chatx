// Creates a MercadoPago preapproval (subscription) and returns the checkout URL.
// POST { plan: 'monthly' | 'weekly' | '2day', user_id: string, user_email: string }

const PLANS = {
  monthly: {
    reason: 'CamReal Premium — Mensual',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: 35000,
      currency_id: 'ARS',
      free_trial: { frequency: 1, frequency_type: 'days' },
    },
  },
  weekly: {
    reason: 'CamReal Premium — Semanal',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'weeks',
      transaction_amount: 9900,
      currency_id: 'ARS',
      free_trial: { frequency: 1, frequency_type: 'days' },
    },
  },
  '2day': {
    reason: 'CamReal Premium — 2 días',
    auto_recurring: {
      frequency: 2,
      frequency_type: 'days',
      transaction_amount: 3900,
      currency_id: 'ARS',
      free_trial: { frequency: 1, frequency_type: 'days' },
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan, user_id, user_email } = req.body ?? {};

  if (!PLANS[plan]) return res.status(400).json({ error: 'Plan inválido' });
  if (!user_id || !user_email) return res.status(400).json({ error: 'Faltan datos de usuario' });

  const origin = req.headers.origin || `https://${req.headers.host}`;

  const body = {
    ...PLANS[plan],
    payer_email: user_email,
    external_reference: `${user_id}|${plan}`,
    back_url: `${origin}/premium-success.html`,
  };

  const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const mpData = await mpRes.json();

  if (!mpRes.ok) {
    console.error('[MP] preapproval error', mpData);
    return res.status(502).json({ error: 'Error al crear la suscripción en MercadoPago', detail: mpData });
  }

  return res.status(200).json({ init_point: mpData.init_point });
}

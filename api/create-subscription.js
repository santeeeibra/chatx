export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  // Verificar token con Supabase REST
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'invalid token' });
  const user = await userRes.json();

  // Crear preapproval en MP
  const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'CamReal Premium',
      external_reference: user.id,
      payer_email: user.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 4.99,
        currency_id: 'USD',
      },
      back_url: 'https://chatreal.live/premium.html',
      status: 'pending',
    }),
  });

  const mpData = await mpRes.json();
  if (!mpRes.ok) return res.status(502).json({ error: 'mp error', detail: mpData });

  return res.status(200).json({ url: mpData.init_point });
}

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verificar sesión Supabase desde el Authorization header
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'invalid token' });

  // Crear preapproval en MP con external_reference = user.id
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

  if (!mpRes.ok) {
    const err = await mpRes.json();
    return res.status(502).json({ error: 'mp error', detail: err });
  }

  const { init_point } = await mpRes.json();
  return res.status(200).json({ url: init_point });
}

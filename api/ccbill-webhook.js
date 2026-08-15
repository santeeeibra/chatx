import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// CCBill sends POST with application/x-www-form-urlencoded
export const config = { api: { bodyParser: { type: 'application/x-www-form-urlencoded' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { eventType, email, clientAccnum, clientSubacc, subscriptionId, digest } = req.body;

  // Verify CCBill digest to reject forged requests
  // CCBill digest: MD5(clientAccnum + clientSubacc + eventType + SALT)
  if (process.env.CCBILL_SALT) {
    const expected = crypto
      .createHash('md5')
      .update(`${clientAccnum}${clientSubacc}${eventType}${process.env.CCBILL_SALT}`)
      .digest('hex');
    if (digest !== expected) {
      console.error('[CCBill] Invalid digest — request rejected');
      return res.status(401).json({ error: 'Invalid digest' });
    }
  }

  if (!email) return res.status(400).json({ error: 'Missing email' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  if (eventType === 'NewSaleSuccess') {
    const premiumUntil = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from('user_profiles')
      .update({ is_premium: true, premium_until: premiumUntil, ccbill_subscription_id: subscriptionId })
      .eq('email', email);
    if (error) console.error('[CCBill] Supabase update error:', error);
    else console.log('[CCBill] Premium activated:', email);
  }

  if (['CancelSubscription', 'Expiration'].includes(eventType)) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ is_premium: false, premium_until: null })
      .eq('email', email);
    if (error) console.error('[CCBill] Supabase update error:', error);
    else console.log(`[CCBill] Premium revoked (${eventType}):`, email);
  }

  // CCBill expects HTTP 200 for all handled events
  res.status(200).json({ ok: true });
}

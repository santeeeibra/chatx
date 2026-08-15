/**
 * config.js
 * ⚠️ Reemplazá estos valores con tus claves reales antes de deployar.
 * Para Vercel: usá Environment Variables en el dashboard y un Edge Function
 * para evitar exponer claves sensibles al cliente.
 *
 * Claves "seguras" en cliente (anon/public por diseño):
 *   - SUPABASE_URL y SUPABASE_ANON_KEY → la anon key no tiene permisos admin
 *   - AGORA_APP_ID → es pública, los tokens del server dan seguridad real
 */

export const CONFIG = {
  // Supabase → Dashboard > Settings > API
  SUPABASE_URL:      'https://ippnujzindiveeldpcjv.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwcG51anppbmRpdmVlbGRwY2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1ODg0MTksImV4cCI6MjEwMjE2NDQxOX0.zHGNbOCGyo8XMDm1IitRaSk_0uja8pkpDUx0oDs0HHA',

  // Agora → console.agora.io > Project Management > App ID
  AGORA_APP_ID: 'aad9d24a2210452396affed493129046',

  // Ably → cuenta gratis en ably.com → Dashboard → API Keys → Pública
  ABLY_API_KEY: '08MvwA.nncTfQ:FzSXw2RAhtACli7bI2sJ_KOphCmjixC7k7vSunndrnI',

  // Timeouts (ms)
  MATCHMAKING_TIMEOUT: 60_000,   // 60s sin pareja → reintentar
  SLOT_CLEANUP_AGE:    55_000,   // eliminar slots inactivos > 55s
};

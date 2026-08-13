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
  SUPABASE_URL:      'https://TU_PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU_ANON_KEY_AQUI',

  // Agora → console.agora.io > Project Management > App ID
  AGORA_APP_ID: 'TU_AGORA_APP_ID',

  // Timeouts (ms)
  MATCHMAKING_TIMEOUT: 60_000,   // 60s sin pareja → reintentar
  SLOT_CLEANUP_AGE:    30_000,   // eliminar slots inactivos > 30s
};

/**
 * supabase-client.js
 * Instancia única de Supabase para toda la app.
 * Los SDKs cargados por CDN en el HTML exponen `window.supabase`.
 */

import { CONFIG } from './config.js';

export const supabase = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

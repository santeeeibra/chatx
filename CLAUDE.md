# ChatX — Contexto de proyecto

## Stack
- Vanilla JS/HTML | Ably (signaling) | Supabase (DB/auth) | Vercel (static) | FingerprintJS

## Arquitectura de archivos
src/
  index.html       ← entrada principal
  app.js           ← lógica matchmaking
  signaling.js     ← conexión Ably
  supabase.js      ← cliente y helpers DB

## Variables de entorno requeridas
ABLY_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

## Estado actual (actualizar tras cada tarea)
- [x] Scaffolding UI matchmaking
- [x] Signaling con Ably
- [ ] Moderation flow

## Tarea en curso
<describirla acá antes de iniciar Cline>

## Patrones establecidos
- Fingerprint: siempre usar `getFingerprint()` de fingerprint.js
- Supabase: todas las queries en supabase.js, no inline
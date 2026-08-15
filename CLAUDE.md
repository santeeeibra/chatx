# CamReal — Contexto Maestro

## Stack
Vanilla JS/HTML · Ably (WebRTC signaling) · Supabase (DB/auth/realtime) · Vercel (static deploy) · FingerprintJS (ID anónima)

## Árbol de archivos relevantes
/app.html               ← UI principal (matchmaking + videochat)
/index.html             ← Age gate / landing (+18)
/tos.html               ← Términos de Uso (enlazado desde el age gate)
/premium.html           ← Landing premium
/js/app.js              ← controlador principal (importa el resto)
/js/matchmaking.js      ← colas y matchmaking
/js/ably-signaling.js   ← conexión Ably (signaling)
/js/webrtc-manager.js   ← WebRTC / peer connection
/js/agora-manager.js    ← SDK Agora
/js/fingerprint.js      ← getFingerprint()
/js/config.js           ← claves y timeouts
/js/auth.js             ← autenticación (vinculada a fingerprint)
/js/bans.js             ← sistema de bans
/js/reportes.js         ← reportes a Supabase
/js/supabase-client.js  ← cliente + queries Supabase
/css/styles.css         ← estilos generales
/supabase/schema.sql    ← schema de Supabase
/supabase/migrations/   ← migraciones incrementales

## Patrones — NO romper
- ID de usuario: siempre via getFingerprint() de /js/fingerprint.js
- Queries Supabase: solo en /js/supabase-client.js, nunca inline
- Señalización: solo via Ably, NO WebSockets directos (Vercel no soporta)
- Deploy: drag-and-drop a Vercel, sin build step

## Variables de entorno
ABLY_API_KEY · SUPABASE_URL · SUPABASE_ANON_KEY

## Estado de fases
- [x] Fase 1: Scaffolding UI + matchmaking spinner
- [x] Fase 2: Signaling Ably + WebRTC básico
- [x] Fase 3: UX polish (spinner, disabled states, styles)
- [x] Fase 4: Moderación + ban system
- [ ] Fase 5: Auth + age gate + CCBill
  - [x] Age gate +18 (ya existía; verificado: checkbox, localStorage, guard en app.html)
  - [ ] Auth (registro/login Supabase → registro.html pendiente)
  - [ ] CCBill (suscripción premium → premium.html con placeholders)

## Tarea actual
Fase 5: age gate verificado y cerrado (existía en /index.html). Se creó /tos.html (el checkbox del age gate enlazaba a un 404). Próximo: Auth.

## Notas de sesión 2026-08-15
- Rebrand ChatX → CamReal completado
- Estructura limpia: 30 archivos, basura eliminada
- app.html en raíz (no /html/)
- supabase-client.js es el cliente correcto (no supabase.js)
- Fase 5 age gate: ya existía en /index.html (checkbox, localStorage, guard en app.html). Verificado end-to-end. Creado /tos.html (enlace roto). Pendiente: Auth + CCBill.
## Rebrand ChatX → CamReal + reorganización de estructura (completado)
## Decisiones importantes
- Pago: CCBill ~$4.99/mo (futuro)
- Moderación: 1er reporte → ban 24h → 2do → ban permanente
- PWA, no app nativa (evita App Store)
- Fase 4 (2026-08-15): reportUser(fingerprint) en reportes.js, checkBan al entrar a la cola en matchmaking.js, overlay de ban reutilizado
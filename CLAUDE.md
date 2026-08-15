# Memoria del Proyecto: ChatX (Videochat)

## Contexto del Proyecto
Aplicación web de videochat aleatorio (estilo ruleta) con matchmaking en tiempo real.
Tecnologías principales: HTML/JS/CSS vainilla, Ably Realtime para signaling, WebRTC para conexiones P2P de audio y video, Supabase.

## Estado Actual: Fases 1 a 4 Completadas 🚀
Las fases de Video Chat Core, UX Polish, Moderation y Age gate & auth están 100% terminadas.

## Fase 5 Completada: Monetización ✅
- ✅ **Premium feature gates:** Cooldown 30s para free, sin límite para premium. Banner de upgrade + premium.html con landing page ($4.99/mes, CCBill).
- ✅ **CCBill integration:** Webhook serverless `/api/ccbill-webhook.js` con verificación de digest MD5. Migración SQL para columnas `premium_until` y `ccbill_subscription_id`. `.env.example` documentado.

## Pendiente (configuración externa)
- Completar `CCBILL_ACCT`, `CCBILL_SUBACC`, `CCBILL_FORM_ID` en `premium.html`
- Añadir env vars en Vercel dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CCBILL_SALT`
- Ejecutar migración SQL en Supabase: `supabase/migrations/20260814_premium_columns.sql`
- Configurar URL del webhook en CCBill dashboard: `https://tu-dominio.vercel.app/api/ccbill-webhook`

## ⚠️ PROTOCOLO AUTOMÁTICO DE FIN DE TAREA
Cada vez que el usuario te pida implementar un paso y lo finalices con éxito, DEBES ejecutar este flujo automáticamente y sin que el usuario te lo pida:

1. **Actualizar el Checklist React:**
   - Lee el archivo `D:\vdc\videochat-adulto\chatx_checklist.jsx`.
   - Modifica el código para marcar la tarea recién completada como "lista".
2. **Actualizar esta Memoria (CLAUDE.md):**
   - Modifica este mismo archivo (`CLAUDE.md`) para actualizar la lista de "Estado Actual", agregando la tarea completada y ajustando el contador.
3. **Guardado en Git (Auto-Save):**
   - Ejecuta comandos en la terminal para guardar: `git add .`
   - Haz el commit: `git commit -m "feat: completado [nombre de la tarea] y checklist actualizado"`
   - Sube los cambios: `git push`
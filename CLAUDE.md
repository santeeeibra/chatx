# Memoria del Proyecto: ChatX (Videochat)

## Contexto del Proyecto
Aplicación web de videochat aleatorio (estilo ruleta) con matchmaking en tiempo real.
Tecnologías principales: HTML/JS/CSS vainilla, Ably Realtime para signaling, WebRTC para conexiones P2P de audio y video, Supabase.

## Estado Actual: Fases 1 a 4 Completadas 🚀
Las fases de Video Chat Core, UX Polish, Moderation y Age gate & auth están 100% terminadas.

## Fase Inmediata: Fase 5 (Monetización) — 1/2 Completado
- ✅ **Premium feature gates:** Cooldown 30s para free, sin límite para premium. Banner de upgrade + premium.html con landing page ($4.99/mes, CCBill).
- 🔲 **CCBill integration:** Desarrollar webhook serverless para procesar el ping de CCBill y actualizar el estado del usuario a 'premium' en la base de datos tras un pago exitoso.
- *Instrucción para Claude Code:* Continuar con CCBill webhook serverless.

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
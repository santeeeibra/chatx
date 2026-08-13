# ChatX — Setup Guide (Fase 1)

Web app de videochat random para adultos. MVP funcional con matchmaking, bans y video en tiempo real.

---

## ⚡ Setup en 15 minutos

### Paso 1 — Supabase

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a **SQL Editor → New Query**
3. Pegar y ejecutar el contenido de `supabase/schema.sql`
4. Ir a **Database → Replication** y habilitar la tabla `sala_espera`
5. Copiar desde **Settings → API**:
   - `URL` → va en `CONFIG.SUPABASE_URL`
   - `anon public` key → va en `CONFIG.SUPABASE_ANON_KEY`

### Paso 2 — Agora

1. Crear cuenta en [console.agora.io](https://console.agora.io)
2. Crear un nuevo proyecto (modo **Testing** para el MVP, sin token)
3. Copiar el **App ID** → va en `CONFIG.AGORA_APP_ID`

### Paso 3 — Configurar claves

Abrir `js/config.js` y reemplazar los valores:

```js
export const CONFIG = {
  SUPABASE_URL:      'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGci...',
  AGORA_APP_ID:      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
};
```

### Paso 4 — Deploy en Vercel

```bash
# Opción A: desde el CLI de Vercel
npm i -g vercel
vercel

# Opción B: drag & drop la carpeta en vercel.com/new
```

> ✅ No hay build step. Es HTML/CSS/JS puro. Vercel lo sirve directamente.

---

## 📁 Estructura del proyecto

```
videochat-adulto/
├── index.html              ← Landing con age gate (+18)
├── app.html                ← Sala de videochat
├── css/
│   └── styles.css          ← Todos los estilos
├── js/
│   ├── config.js           ← ⚠️ Aquí van tus API keys
│   ├── supabase-client.js  ← Init de Supabase
│   ├── fingerprint.js      ← ID único del dispositivo
│   ├── bans.js             ← Verificar y aplicar bans
│   ├── agora-manager.js    ← SDK de video
│   ├── matchmaking.js      ← Emparejar usuarios
│   ├── reportes.js         ← Sistema de reportes
│   └── app.js              ← Controlador principal
└── supabase/
    └── schema.sql          ← Tablas y políticas RLS
```

---

## 🗺️ Fases del proyecto

- [x] **Fase 1** — MVP: landing, video, matchmaking, bans, reportes
- [ ] **Fase 2** — Registro + escaneo facial (Face++) + cuentas con 5h ban
- [ ] **Fase 3** — Premium, pagos (CCBill/Stripe), filtros de género/país

---

## ⚠️ Notas importantes para Cline / Claude Code

- Stack: **HTML + Vanilla JS (ES Modules)** + Supabase + Agora SDK
- Sin bundler, sin framework — servir directamente desde Vercel
- Los SDKs (Supabase, FingerprintJS, Agora) se cargan por CDN en `app.html`
- Los módulos JS usan `import/export` estándar — necesitan servidor HTTP (no abrir con `file://`)
- **NO grabar streams de video** — solo logs de sesión en Supabase
- Para producción: mover la lógica de bans a un Supabase Edge Function
- Siempre leer `videochat-adulto-proyecto.md` antes de modificar lógica de negocio

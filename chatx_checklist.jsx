import { useState } from "react";

const PHASES = [
  {id:1,emoji:"🔧",name:"Video chat",tasks:[
    {id:"1-1",title:"Fix local camera preview",desc:"Cámara local aparece como caja oscura en el PiP.",
    prompt:`In app.html, the local camera preview shows as a dark box even though camera permissions were granted.

Fix:
1. After getUserMedia: localVideo.srcObject = stream
2. Ensure the element has attributes: autoplay playsinline muted
3. CSS: make sure #localVideo has opacity:1, is not hidden, and its container has explicit size (e.g. 140x180px)
4. Add: console.log('[Camera] tracks:', stream.getTracks())
5. Confirm video track is active: stream.getVideoTracks()[0].enabled === true

Only fix local video rendering. Do not touch matchmaking or signaling.`},
    {id:"1-2",title:"Verify Ably signaling",desc:"Confirmar que Ably conecta y los mensajes fluyen sin errores.",
    prompt:`In app.html, add debug logging to confirm Ably signaling works:

1. ably.connection.on('connected', () => console.log('[Ably] Connected'))
2. On every received message: console.log('[Ably] RX:', msg.name, msg.data)
3. On every publish: console.log('[Ably] TX:', type)
4. ably.connection.on('failed', e => console.error('[Ably] Failed', e))

Open the app and verify zero errors in the console. Do not change any logic — logging only.`},
    {id:"1-3",title:"Test matchmaking (2 tabs)",desc:"Dos tabs deben emparejarse en menos de 10 segundos.",
    prompt:`Test and fix matchmaking in app.html:

1. Open app.html in two browser tabs simultaneously
2. Add: console.log('[Match] Entered queue:', fingerprint)
3. Add: console.log('[Match] Match found:', matchedFp)
4. Add: console.log('[Match] Confirmed')

If matching never happens, check:
- Is a row inserted into Supabase 'queue' table? (Check Supabase dashboard)
- Is the Realtime subscription firing? Add log in the subscription callback
- Race condition? Both users must not claim the same slot simultaneously

Fix the bug found. Target: two tabs connect within 10 seconds.`},
    {id:"1-4",title:"WebRTC peer connection",desc:"ICE handshake debe completarse y loguear 'connected'.",
    prompt:`After matchmaking succeeds in app.html, debug the WebRTC handshake:

Add logs at each step:
1. console.log('[WebRTC] Creating offer...')  — initiator
2. console.log('[WebRTC] Offer sent')
3. console.log('[WebRTC] Answer received')
4. console.log('[WebRTC] ICE candidate sent/received')
5. pc.oniceconnectionstatechange = () => console.log('[WebRTC] ICE state:', pc.iceConnectionState)

STUN: stun:stun.l.google.com:19302

Goal: see "ICE state: connected" in BOTH tabs. Fix whatever step is failing.`},
    {id:"1-5",title:"Display remote video stream",desc:"Video remoto debe llenar la pantalla principal al conectar.",
    prompt:`In app.html, show remote video once WebRTC connects:

1. pc.ontrack = (e) => {
     remoteVideo.srcObject = e.streams[0];
     console.log('[WebRTC] Remote stream received');
   }
2. remoteVideo must NOT be muted (user needs to hear partner)
3. Ensure: <video id="remoteVideo" autoplay playsinline> in HTML
4. When stream starts playing: hide the "Buscando pareja..." spinner
5. Update header status badge to green dot + "Conectado"

Test with two tabs — each must see the other's camera.`},
    {id:"1-6",title:"Fix audio echo",desc:"Stream local no debe reproducir audio para evitar eco.",
    prompt:`In app.html, the local video is playing microphone audio back, causing echo.

Fix (2 lines):
1. HTML: <video id="localVideo" muted autoplay playsinline>
2. JS: localVideo.muted = true  — set this after assigning the stream

NEVER mute remoteVideo — the user must hear the other person.
Verify in console: localVideo.muted === true`},
  ]},
  {id:2,emoji:"✨",name:"UX polish",tasks:[
    {id:"2-1",title:"Connection status UI",desc:"Estados claros: buscando, conectando, conectado, desconectado.",
    prompt:`In app.html, create setStatus(state) with 4 states:

'searching'    → purple spinner + "Buscando pareja..."
'connecting'   → yellow dot    + "Conectando..."
'connected'    → green dot     + "Conectado"
'disconnected' → red dot       + "Desconectado"

The function updates:
- Header status badge (dot color + text label)
- Main overlay (show spinner on 'searching', hide otherwise)
- "Siguiente" button (disabled during 'connecting')

Call setStatus() at: queue join, match found, ICE connected, peer disconnect.`},
    {id:"2-2",title:'"Siguiente" full reset',desc:"Siguiente limpia la sesión y busca nueva pareja con cooldown.",
    prompt:`In app.html, make "Siguiente" cleanly reset and re-queue:

1. if (pc) { pc.close(); pc = null; }
2. remoteVideo.srcObject = null
3. Publish {type:'hangup'} to current Ably channel
4. Delete this user's row from Supabase 'queue' table
5. setStatus('searching')
6. 2-second cooldown before re-entering queue — show "Siguiente (2s)" countdown on button

Do NOT stop localStream. Camera and mic stay active throughout the session.`},
    {id:"2-3",title:"Handle partner disconnect",desc:"Mostrar mensaje y volver a buscar automáticamente en 5 segundos.",
    prompt:`In app.html, handle remote disconnect:

Detect via:
- pc.oniceconnectionstatechange: if 'disconnected' or 'failed'
- Ably channel: if msg.name === 'hangup'

On detect:
1. remoteVideo.srcObject = null
2. Show centered overlay: "Tu pareja se desconectó"
3. 5-second countdown shown below ("Buscando nueva pareja en 5...")
4. Auto-trigger Siguiente logic after 5s
5. Clicking Siguiente immediately skips the countdown

Overlay: dark semi-transparent bg (rgba(0,0,0,0.75)), white text, matches app theme.`},
    {id:"2-4",title:"Mobile responsive layout",desc:"Video full-screen en móvil con controles al fondo.",
    prompt:`In app.html, make the layout work on mobile:

1. Add if missing: <meta name="viewport" content="width=device-width,initial-scale=1">
2. remoteVideo: width:100vw; height:100dvh; object-fit:cover; position:fixed; top:0; left:0; z-index:1
3. Local PiP: position:fixed; bottom:80px; right:16px; width:120px; height:160px; z-index:10; border-radius:8px; overflow:hidden
4. Controls: position:fixed; bottom:0; left:0; right:0; padding:16px; display:flex; justify-content:center; gap:12px; z-index:20
5. Header: fixed top, compact — logo + status dot only at <768px

Test at 375px width.`},
  ]},
  {id:3,emoji:"🛡️",name:"Moderation",tasks:[
    {id:"3-1",title:"Report modal",desc:"Reportar abre modal con motivos y guarda en Supabase.",
    prompt:`In app.html, implement the report flow:

Modal when clicking "Reportar":
- Title: "Reportar usuario"
- Radio options: "Contenido inapropiado" | "Comportamiento ofensivo" | "Menor de edad" | "Spam" | "Otro"
- Optional textarea: "Comentario adicional (opcional)"
- Buttons: "Cancelar" (ghost) · "Enviar reporte" (solid purple)

On submit:
1. supabase.from('reports').insert({ reporter_fp, reported_fp, reason, comment, created_at: new Date() })
2. Show toast: "Reporte enviado" for 3s
3. Close modal
4. Auto-trigger Siguiente after 1.5s

Use FingerprintJS fp (already loaded) as user ID. Dark theme styling.`},
    {id:"3-2",title:"Ban system with countdown",desc:"Usuarios baneados ven countdown hasta su desbaneo.",
    prompt:`In app.html, on load after fingerprint is ready:

const { data } = await supabase
  .from('bans')
  .select('ban_until')
  .eq('fingerprint', fp)
  .gt('ban_until', new Date().toISOString())
  .single();

If banned:
1. Hide all chat UI
2. Show fullscreen ban screen:
   - Large icon (🚫)
   - "Tu cuenta está suspendida"
   - Live countdown: "Podrás volver en HH:MM:SS" (update every second)
   - When timer hits 0: window.location.reload()

While banned: no camera access, no Ably connection, no Supabase queue writes.
Dark purple theme for the ban screen.`},
    {id:"3-3",title:"Auto-ban on 3 reports",desc:"3 reportes en 24h activan ban automático de 1 hora.",
    prompt:`Run this SQL migration in Supabase SQL editor:

CREATE OR REPLACE FUNCTION check_report_threshold()
RETURNS TRIGGER AS $$
DECLARE report_count INT;
BEGIN
  SELECT COUNT(*) INTO report_count
  FROM reports
  WHERE reported_fp = NEW.reported_fp
    AND created_at > NOW() - INTERVAL '24 hours';
  IF report_count >= 3 THEN
    INSERT INTO bans (fingerprint, ban_until, reason)
    VALUES (NEW.reported_fp, NOW() + INTERVAL '1 hour', 'Auto-ban: 3 reports in 24h')
    ON CONFLICT (fingerprint) DO UPDATE SET ban_until = NOW() + INTERVAL '1 hour';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_ban_trigger
AFTER INSERT ON reports
FOR EACH ROW EXECUTE FUNCTION check_report_threshold();`},
  ]},
  {id:4,emoji:"🔞",name:"Age gate & auth",tasks:[
    {id:"4-1",title:"Age gate index.html",desc:"Confirmar +18 antes de acceder. app.html redirige si no verificado.",
    prompt:`In index.html, implement the age gate:

On load: if (localStorage.getItem('age_verified') === 'true') redirect to app.html

Age gate UI:
- App logo + "ChatX"
- "Este sitio contiene contenido exclusivo para adultos (+18)"
- Checkbox: "Confirmo que tengo 18 años o más y acepto los Términos de Uso"
- Button "Entrar" — disabled until checkbox is checked

On "Entrar" click:
  localStorage.setItem('age_verified', 'true');
  window.location.href = 'app.html';

Also add to app.html first line of JS:
  if (localStorage.getItem('age_verified') !== 'true') window.location.href = 'index.html';

Dark purple/pink theme. No external libraries.`},
    {id:"4-2",title:"Optional registration",desc:"Registro con Supabase Auth, vinculado al fingerprint.",
    prompt:`In app.html, add optional login/register (non-blocking):

1. Add "Iniciar sesión" text button in header top-right

2. Clicking opens modal with tabs: "Registrarse" | "Iniciar sesión"
   Fields: email + password

3. Supabase Auth:
   Register: await supabase.auth.signUp({ email, password })
   Login:    await supabase.auth.signInWithPassword({ email, password })

4. On success:
   - Replace button with user avatar circle (first 2 chars of email, uppercase)
   - Small dropdown: email address + "Cerrar sesión"
   - Link fp to account: supabase.from('user_profiles').upsert({ user_id, fingerprint })

Anonymous flow must still work — registration is purely optional.`},
  ]},
  {id:5,emoji:"💳",name:"Monetization",tasks:[
    {id:"5-1",title:"Premium feature gates",desc:"Cooldown de 30s para free, sin límite para premium.",
    prompt:`In app.html, implement free tier cooldown:

After "Siguiente" click, if user is not premium:
1. Disable button for 30 seconds
2. Show countdown on button: "Siguiente (29s)" -> "Siguiente (28s)" -> ...
3. Show upgrade banner below controls:
   "Actualiza a Premium — skips ilimitados" linking to /premium.html
4. After 30s: re-enable button, hide banner

isPremium check (after login):
  const { data } = await supabase.from('user_profiles').select('is_premium').eq('user_id', userId).single();
  isPremium = data?.is_premium === true;

Also create premium.html — simple landing page:
  Title: "ChatX Premium — $4.99/mes"
  Benefits: sin cooldown, HD 720p, filtros próximamente
  CTA: "Suscribirte" button (links to CCBill FlexForm)`},
    {id:"5-2",title:"CCBill integration",desc:"Webhook serverless para activar premium tras pago exitoso.",
    prompt:`Set up CCBill subscription payments:

1. Create /api/ccbill-webhook.js (Vercel serverless):

export default async function handler(req, res) {
  const { eventType, email } = req.body;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  if (eventType === 'NewSaleSuccess') {
    await supabase.from('user_profiles')
      .update({ is_premium: true, premium_until: new Date(Date.now() + 31*24*60*60*1000) })
      .eq('email', email);
  }
  if (['CancelSubscription','Expiration'].includes(eventType)) {
    await supabase.from('user_profiles').update({ is_premium: false }).eq('email', email);
  }
  res.status(200).json({ ok: true });
}

2. Vercel env vars to add:
   CCBILL_SALT, SUPABASE_URL, SUPABASE_SERVICE_KEY

3. CCBill FlexForm URL:
   https://api.ccbill.com/wap-frontflex/flexforms/FORM_ID?clientAccnum=ACCT&clientSubacc=SUB&initialPrice=4.99&initialPeriod=30&recurringPrice=4.99&recurringPeriod=30&rebills=99&currencyCode=840&UDF01=USER_EMAIL`},
  ]},
];

const phaseColors = {
  1: { border: "#7c3aed", bg: "rgba(124,58,237,0.08)", text: "#a78bfa" },
  2: { border: "#db2777", bg: "rgba(219,39,119,0.08)", text: "#f472b6" },
  3: { border: "#d97706", bg: "rgba(217,119,6,0.08)",  text: "#fbbf24" },
  4: { border: "#dc2626", bg: "rgba(220,38,38,0.08)",  text: "#f87171" },
  5: { border: "#059669", bg: "rgba(5,150,105,0.08)",  text: "#34d399" },
};

export default function ChatXChecklist() {
  const [done, setDone] = useState({"1-1":true,"1-2":true,"1-3":true,"1-4":true,"1-5":true,"1-6":true,"2-1":true,"2-2":true,"2-3":true,"2-4":true,"3-1":true,"3-2":true,"3-3":true,"4-1":true,"4-2":true,"5-1":true,"5-2":true});
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState(null);
  const [activePhase, setActivePhase] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [memory, setMemory] = useState(null);
  const [memError, setMemError] = useState(null);

  const totalTasks = PHASES.reduce((a, p) => a + p.tasks.length, 0);
  const doneTasks = Object.values(done).filter(Boolean).length;
  const pct = Math.round((doneTasks / totalTasks) * 100);

  const toggleDone = (id) => {
    setDone(prev => ({ ...prev, [id]: !prev[id] }));
    if (expanded === id) setExpanded(null);
  };

  const copyText = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const generateMemory = async () => {
    setGenerating(true);
    setMemory(null);
    setMemError(null);

    const completed = [];
    const pending = [];
    PHASES.forEach(p => p.tasks.forEach(t => {
      (done[t.id] ? completed : pending).push(`${p.name}: ${t.title}`);
    }));

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `Generate a CLAUDE.md memory file for ChatX — an adult video chat PWA (OmeTV-style for adults).

Tech stack: Vanilla JS/HTML, Ably Realtime (WebRTC signaling — chosen because Vercel serverless is incompatible with persistent WebSockets), Supabase (Realtime + DB + RLS + Auth), Vercel (static drag-and-drop deploy), FingerprintJS (anonymous users). Future: CCBill payments, Face++ age verification. GitHub: santeeeibra.

Completed tasks:
${completed.length ? completed.map(t => `- ✅ ${t}`).join("\n") : "- None yet"}

Pending tasks:
${pending.map(t => `- ⏳ ${t}`).join("\n")}

Write a concise CLAUDE.md (~300 words) with these sections: ## Project, ## Stack, ## Architecture decisions, ## Completed, ## Next priorities. Be specific and actionable. This file will be read by Claude Code at the start of each session to understand the full context without needing re-explanation.`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text;
      if (text) setMemory(text);
      else setMemError("Respuesta inesperada de la API.");
    } catch (e) {
      setMemError("Error de red. Intentá de nuevo.");
    }
    setGenerating(false);
  };

  const curPhase = PHASES.find(p => p.id === activePhase);
  const col = phaseColors[activePhase];

  const s = {
    root: { fontFamily: "system-ui, sans-serif", color: "#e2e8f0", padding: "1.25rem 0", maxWidth: 700 },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" },
    progressBar: { height: 3, background: "#2d3748", borderRadius: 2, marginBottom: "1.5rem", overflow: "hidden" },
    progressFill: { height: "100%", width: `${pct}%`, background: "#7c3aed", borderRadius: 2, transition: "width 0.3s" },
    tabs: { display: "flex", gap: 6, marginBottom: "1.5rem", flexWrap: "wrap" },
    taskList: { display: "flex", flexDirection: "column", gap: 8 },
    divider: { borderTop: "1px solid #2d3748", marginTop: "2rem", paddingTop: "1.5rem" },
    preBlock: { margin: 0, padding: 12, background: "#0f1117", borderRadius: 8, fontSize: 12, lineHeight: 1.65, color: "#c9d1d9", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto" },
    memPre: { margin: 0, padding: 14, fontSize: 12, lineHeight: 1.65, color: "#c9d1d9", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 380, overflowY: "auto" },
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9" }}>ChatX</span>
          <span style={{ fontSize: 13, color: "#64748b", marginLeft: 8 }}>— plan de trabajo para Claude Code</span>
        </div>
        <span style={{ fontSize: 13, color: "#64748b" }}>{doneTasks}/{totalTasks} completadas</span>
      </div>

      <div style={s.progressBar}>
        <div style={s.progressFill} />
      </div>

      <div style={s.tabs}>
        {PHASES.map(p => {
          const pd = p.tasks.filter(t => done[t.id]).length;
          const isA = activePhase === p.id;
          const c = phaseColors[p.id];
          return (
            <button key={p.id} onClick={() => { setActivePhase(p.id); setExpanded(null); }} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 8,
              border: `1px solid ${isA ? c.border : "#2d3748"}`,
              background: isA ? c.bg : "transparent",
              color: isA ? c.text : "#64748b",
              fontSize: 13, cursor: "pointer", fontWeight: isA ? 500 : 400
            }}>
              <span>{p.emoji}</span>
              <span>{p.name}</span>
              <span style={{
                fontSize: 11, padding: "1px 7px", borderRadius: 10,
                background: pd === p.tasks.length ? "rgba(16,185,129,0.15)" : "#1e293b",
                color: pd === p.tasks.length ? "#34d399" : "#475569"
              }}>{pd}/{p.tasks.length}</span>
            </button>
          );
        })}
      </div>

      <div style={s.taskList}>
        {curPhase.tasks.map(task => {
          const isDone = !!done[task.id];
          const isExp = expanded === task.id;
          const isCopied = copied === task.id;
          return (
            <div key={task.id} style={{
              background: "#0f172a", border: `1px solid ${isDone ? "#064e3b" : "#1e293b"}`,
              borderRadius: 12, overflow: "hidden", opacity: isDone ? 0.6 : 1, transition: "opacity 0.2s"
            }}>
              <div onClick={() => setExpanded(isExp ? null : task.id)} style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "13px 16px", cursor: "pointer"
              }}>
                <div onClick={e => { e.stopPropagation(); toggleDone(task.id); }} style={{
                  width: 20, height: 20, minWidth: 20, borderRadius: 5, marginTop: 1,
                  border: `1.5px solid ${isDone ? "#10b981" : "#334155"}`,
                  background: isDone ? "rgba(16,185,129,0.2)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
                }}>
                  {isDone && <span style={{ fontSize: 11, color: "#10b981" }}>✓</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: isDone ? "#475569" : "#f1f5f9", textDecoration: isDone ? "line-through" : "none" }}>{task.title}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>{task.desc}</p>
                </div>
                <span style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>{isExp ? "▲" : "▼"}</span>
              </div>

              {isExp && (
                <div style={{ borderTop: "1px solid #1e293b", padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "#475569", fontWeight: 600, letterSpacing: "0.06em" }}>PROMPT PARA CLAUDE CODE</span>
                    <button onClick={() => copyText(task.prompt, task.id)} style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "4px 10px", borderRadius: 6,
                      border: `1px solid ${isCopied ? "#064e3b" : "#2d3748"}`,
                      background: isCopied ? "rgba(16,185,129,0.15)" : "transparent",
                      color: isCopied ? "#34d399" : "#94a3b8",
                      fontSize: 12, cursor: "pointer"
                    }}>
                      {isCopied ? "✓ Copiado" : "⎘ Copiar"}
                    </button>
                  </div>
                  <pre style={s.preBlock}>{task.prompt}</pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={s.divider}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: memory || memError ? 16 : 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>Memoria CLAUDE.md</p>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>
              Genera el contexto actualizado para Claude Code. Regenerá después de completar tareas.
            </p>
          </div>
          <button onClick={generateMemory} disabled={generating} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8, marginLeft: 16, flexShrink: 0,
            border: "1px solid #334155", background: generating ? "#0f172a" : "#1e293b",
            color: generating ? "#475569" : "#e2e8f0", fontSize: 13, fontWeight: 500,
            cursor: generating ? "default" : "pointer"
          }}>
            <span style={{ display: "inline-block", animation: generating ? "spin 1s linear infinite" : "none" }}>↻</span>
            {generating ? "Generando..." : "Generar CLAUDE.md ↗"}
          </button>
        </div>

        {memError && (
          <div style={{ padding: "10px 14px", background: "rgba(220,38,38,0.1)", border: "1px solid #7f1d1d", borderRadius: 8, color: "#f87171", fontSize: 13 }}>
            {memError}
          </div>
        )}

        {memory && (
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #1e293b" }}>
              <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>📄 CLAUDE.md</span>
              <button onClick={() => copyText(memory, "memory")} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 6,
                border: `1px solid ${copied === "memory" ? "#064e3b" : "#2d3748"}`,
                background: copied === "memory" ? "rgba(16,185,129,0.15)" : "transparent",
                color: copied === "memory" ? "#34d399" : "#94a3b8",
                fontSize: 12, cursor: "pointer"
              }}>
                {copied === "memory" ? "✓ Copiado" : "⎘ Copiar archivo"}
              </button>
            </div>
            <pre style={s.memPre}>{memory}</pre>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

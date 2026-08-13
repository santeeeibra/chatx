-- ============================================================
-- ChatX — Schema de Supabase
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ============================================================
-- 1. SALA DE ESPERA (matchmaking)
-- ============================================================
CREATE TABLE IF NOT EXISTS sala_espera (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_a TEXT NOT NULL,           -- Quien creó el slot
  fingerprint_b TEXT,                    -- Quien se unió (null hasta que llega)
  channel_name  TEXT NOT NULL,           -- Nombre del canal de Agora
  estado        TEXT NOT NULL DEFAULT 'esperando'
                CHECK (estado IN ('esperando', 'conectado', 'desconectado')),
  creado_en     TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para matchmaking rápido
CREATE INDEX IF NOT EXISTS idx_sala_espera_estado ON sala_espera(estado, creado_en);

-- Realtime habilitado para esta tabla (necesario para el matchmaking)
ALTER TABLE sala_espera REPLICA IDENTITY FULL;

-- ============================================================
-- 2. BANS
-- ============================================================
CREATE TABLE IF NOT EXISTS bans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_id TEXT NOT NULL,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('24h', '5h', '2h', 'permanente')),
  razon          TEXT DEFAULT 'Reportado por otro usuario',
  expira_en      TIMESTAMPTZ,            -- NULL = ban permanente
  creado_en      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para verificación rápida de ban activo
CREATE INDEX IF NOT EXISTS idx_bans_fingerprint ON bans(fingerprint_id, expira_en);

-- ============================================================
-- 3. REPORTES
-- ============================================================
CREATE TABLE IF NOT EXISTS reportes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reportado_fingerprint   TEXT NOT NULL,
  reportante_fingerprint  TEXT,
  reportado_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sesion_id               UUID,           -- ID del slot de sala_espera
  creado_en               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reportes_reportado ON reportes(reportado_fingerprint);

-- ============================================================
-- 4. USUARIOS PERFIL (para cuando se implemente registro — Fase 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios_perfil (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  edad_verificada  BOOLEAN DEFAULT FALSE,
  edad_estimada    INT,
  es_premium       BOOLEAN DEFAULT FALSE,
  suspendido_hasta TIMESTAMPTZ,
  creado_en        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- Necesario porque usamos la anon key desde el cliente.
-- ============================================================

-- sala_espera
ALTER TABLE sala_espera ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon puede insertar en sala_espera"
  ON sala_espera FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon puede leer sala_espera"
  ON sala_espera FOR SELECT TO anon USING (true);

CREATE POLICY "anon puede actualizar sala_espera"
  ON sala_espera FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon puede borrar sala_espera"
  ON sala_espera FOR DELETE TO anon USING (true);


-- bans (solo lectura para anon, escritura también en MVP)
-- ⚠️ En producción: mover escritura de bans a un Edge Function
ALTER TABLE bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon puede leer bans"
  ON bans FOR SELECT TO anon USING (true);

CREATE POLICY "anon puede insertar bans"
  ON bans FOR INSERT TO anon WITH CHECK (true);


-- reportes
ALTER TABLE reportes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon puede insertar reportes"
  ON reportes FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon puede leer reportes propios"
  ON reportes FOR SELECT TO anon USING (true);


-- ============================================================
-- 6. HABILITAR REALTIME para sala_espera
-- En Supabase Dashboard: Database → Replication → Tables
-- Activar "sala_espera" en la lista.
-- O ejecutar:
-- ============================================================
-- (Esto se configura en el Dashboard, no por SQL directo)
-- Dashboard → Database → Replication → habilitar sala_espera

-- ============================================================
-- LISTO. Tablas creadas y RLS configurado.
-- ============================================================

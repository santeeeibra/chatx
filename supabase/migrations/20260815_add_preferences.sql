-- Agrega columnas de preferencias a sala_espera y usuarios_perfil
-- Nullable → no rompe filas existentes ni el matchmaking sin prefs

ALTER TABLE sala_espera
  ADD COLUMN IF NOT EXISTS genero_a      TEXT,
  ADD COLUMN IF NOT EXISTS pref_genero_a TEXT,
  ADD COLUMN IF NOT EXISTS pais_a        TEXT;

ALTER TABLE usuarios_perfil
  ADD COLUMN IF NOT EXISTS genero TEXT,
  ADD COLUMN IF NOT EXISTS pais   TEXT;

-- Índice para matchmaking filtrado por género y país
CREATE INDEX IF NOT EXISTS idx_sala_espera_prefs
  ON sala_espera(estado, genero_a, pais_a);

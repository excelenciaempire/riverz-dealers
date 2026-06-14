-- ============================================================
-- 031: Historial de versiones de flujos
-- ============================================================
--
-- Cada vez que el merchant pulsa Guardar Y publica (activate), o lo
-- hace explícito desde el editor, snapshotea el flujo entero al
-- momento: trigger, entry, fallback, todos los nodos. Eso le permite:
--   1. Diff "borrador vs publicado" antes de empujar a producción.
--   2. Restore a una versión anterior cuando algo se rompe.
--   3. Auditoría de quién cambió qué y cuándo.
--
-- Tres tipos de snapshot:
--   - draft: el merchant guardó pero no activó. Reemplaza el draft
--     anterior (no acumula draft tras draft).
--   - published: la versión que el engine ejecuta. Solo se crea al
--     activar — esa es la que importa para auditoría.
--   - autosave: futuro. Por ahora ignorado.
--
-- Mantenemos las últimas 50 published + el draft actual (trim por
-- cron eventual). 50 es suficiente para auditar varias semanas sin
-- explotar la tabla.

CREATE TABLE IF NOT EXISTS flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('draft', 'published', 'autosave')),
  -- Snapshot completo del flow + nodes en un solo JSON. Lo
  -- restauramos copiándolo de vuelta a flow_nodes.
  snapshot JSONB NOT NULL,
  -- Usuario que hizo el cambio. NULL si fue un trigger automático.
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Nota opcional ("ajuste botón comprar"). El UI lo permite escribir.
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS flow_versions_flow_idx
  ON flow_versions (flow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS flow_versions_flow_kind_idx
  ON flow_versions (flow_id, kind, created_at DESC);

ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;

-- RLS: el merchant ve y restaura solo las versiones de sus propios
-- flujos. Reusamos el chequeo via flows que ya tiene su propia RLS.
DROP POLICY IF EXISTS flow_versions_select ON flow_versions;
CREATE POLICY flow_versions_select ON flow_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM flows
      WHERE flows.id = flow_versions.flow_id
        AND flows.workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS flow_versions_insert ON flow_versions;
CREATE POLICY flow_versions_insert ON flow_versions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM flows
      WHERE flows.id = flow_versions.flow_id
        AND flows.workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
    )
  );

COMMENT ON TABLE flow_versions IS
  'Snapshots de flow + nodes por versión. Migration 031.';

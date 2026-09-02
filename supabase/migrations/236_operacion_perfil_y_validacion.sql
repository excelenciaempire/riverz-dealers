-- 236 — Perfil operativo y validación de salida por comercio.
--
-- El prompt ya recibía catálogo, reglas y la pizarra de herramientas, pero los
-- datos que deciden una operación (pagos, envíos, devoluciones y vertical
-- regulado) seguían repartidos entre texto libre y configuraciones aisladas.
-- Este perfil es la fuente estructurada y auditable de esos datos. Se guarda
-- en la misma fila que la activación para no crear otra instalación paralela.

ALTER TABLE operacion_setup
  ADD COLUMN IF NOT EXISTS perfil_operativo JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS perfil_actualizado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT NOT NULL DEFAULT 'v1';

COMMENT ON COLUMN operacion_setup.perfil_operativo IS
  'Perfil estructurado de operación por comercio: origen, vertical, pagos, envíos, devoluciones y checkout. Nunca contiene credenciales.';

CREATE TABLE IF NOT EXISTS operacion_validation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'warning', 'blocked')),
  readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  scenarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_version TEXT NOT NULL DEFAULT 'v2',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operacion_validation_runs_workspace_created_idx
  ON operacion_validation_runs(workspace_id, created_at DESC);

ALTER TABLE operacion_validation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read operation validation runs" ON operacion_validation_runs;
CREATE POLICY "Members read operation validation runs" ON operacion_validation_runs FOR SELECT
  USING (is_workspace_member(workspace_id));

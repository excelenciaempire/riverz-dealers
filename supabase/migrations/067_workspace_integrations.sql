-- ============================================================
-- 067 — Credenciales de integraciones por workspace.
--
-- Hasta ahora claves como la de Klaviyo se leían de env (global). Esto las
-- persiste por workspace para que cada marca conecte su propia cuenta. El
-- secreto se guarda ENCRIPTADO (misma utilidad encrypt() que el resto de
-- tokens); nunca se devuelve al cliente.
--
-- Provider inicial: 'klaviyo' (sync de leads capturados → owned audience del
-- Agente de Instagram). El diseño es genérico para sumar SMS/data-warehouse.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  provider TEXT NOT NULL CHECK (provider IN ('klaviyo')),
  -- Secreto encriptado (api key). Nunca se expone al cliente.
  api_key_encrypted TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, provider)
);

ALTER TABLE workspace_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage integrations" ON workspace_integrations;
CREATE POLICY "Members manage integrations" ON workspace_integrations FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_integrations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspace_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

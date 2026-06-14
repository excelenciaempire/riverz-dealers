-- ============================================================
-- 040: índices de FKs huérfanas + auditoría (created_by / updated_by)
-- ============================================================
--
-- Tablas heredadas (contact_notes, contact_custom_values) sólo tenían
-- contact_id; al filtrar por workspace en el dashboard cada query
-- hacía un JOIN extra a contacts. Añadimos workspace_id denormalizado
-- + backfill por JOIN.
--
-- Resto: índices en FKs que se usan en filtros (broadcast_recipients
-- por contact_id, etc.) y columnas de auditoría created_by / updated_by
-- en ai_agents y conversation_assignment_rules para mostrar "creado
-- por X" en la UI.

-- ---------- contact_notes ----------
ALTER TABLE contact_notes
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE contact_notes cn
SET workspace_id = c.workspace_id
FROM contacts c
WHERE cn.contact_id = c.id
  AND cn.workspace_id IS NULL
  AND c.workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_notes_workspace
  ON contact_notes (workspace_id);

-- ---------- custom_fields ----------
CREATE INDEX IF NOT EXISTS idx_custom_fields_workspace
  ON custom_fields (workspace_id);

-- ---------- broadcast_recipients ----------
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact
  ON broadcast_recipients (contact_id);

-- ---------- contact_custom_values ----------
ALTER TABLE contact_custom_values
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

UPDATE contact_custom_values ccv
SET workspace_id = c.workspace_id
FROM contacts c
WHERE ccv.contact_id = c.id
  AND ccv.workspace_id IS NULL
  AND c.workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_custom_values_workspace
  ON contact_custom_values (workspace_id);
CREATE INDEX IF NOT EXISTS idx_contact_custom_values_contact
  ON contact_custom_values (contact_id);

-- ---------- ai_agents: created_by ya existía (mig 024); añadir updated_by ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_agents' AND column_name = 'updated_by'
    ) THEN
      ALTER TABLE ai_agents
        ADD COLUMN updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_agents' AND column_name = 'created_by'
    ) THEN
      ALTER TABLE ai_agents
        ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
  ELSE
    ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS created_by UUID;
    ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS updated_by UUID;
  END IF;
END $$;

-- ---------- conversation_assignment_rules: created_by ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'conversation_assignment_rules' AND column_name = 'created_by'
    ) THEN
      ALTER TABLE conversation_assignment_rules
        ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
  ELSE
    ALTER TABLE conversation_assignment_rules ADD COLUMN IF NOT EXISTS created_by UUID;
  END IF;
END $$;

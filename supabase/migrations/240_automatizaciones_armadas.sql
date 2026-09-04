-- Estado deseado y estado real no son lo mismo. Un flujo armado espera sus
-- dependencias externas, pero jamás puede ejecutar mientras `is_active` sea false.
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS activation_state TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS activation_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS activation_requested_at TIMESTAMPTZ;

ALTER TABLE automations
  DROP CONSTRAINT IF EXISTS automations_activation_state_check;

ALTER TABLE automations
  ADD CONSTRAINT automations_activation_state_check
  CHECK (activation_state IN ('draft', 'armed', 'active'));

-- Conserva el significado histórico de los toggles previos a esta migración.
UPDATE automations
SET activation_state = CASE WHEN is_active THEN 'active' ELSE 'draft' END
WHERE activation_state = 'draft';

-- Ninguna fila puede declarar activo el motor con otro estado operativo.
UPDATE automations
SET is_active = FALSE
WHERE activation_state <> 'active' AND is_active;

CREATE INDEX IF NOT EXISTS idx_automations_workspace_activation_state
  ON automations(workspace_id, activation_state)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN automations.activation_state IS
  'draft = no solicitado; armed = solicitado, espera dependencias; active = validado y ejecutable.';

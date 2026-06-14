-- ============================================================
-- 037: Opt-out de contactos para broadcasts
-- ============================================================
--
-- Un contacto puede pedir no recibir más mensajes ("STOP", "BAJA",
-- click en link de unsubscribe). El motor de broadcasts y el
-- ai_agent filtran por opted_out = false antes de enviar.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts (workspace_id, opted_out)
  WHERE opted_out = TRUE;

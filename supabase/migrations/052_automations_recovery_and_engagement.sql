-- ============================================================
-- 052: Soporte para recovery 2h, re-engagement y feedback delivered
-- ============================================================
--
-- Tres cambios independientes que habilitan las automatizaciones que
-- Pilar necesita por encima del trigger system existente:
--
--   1. `shopify_checkouts.recovery_dispatched_at` — marca el momento
--      en que el cron de carritos abandonados ya disparó el mensaje de
--      recovery para ese checkout. Sirve como anti-spam: una sola
--      recuperación por checkout aunque el cron corra cada hora.
--
--   2. `shopify_order_fulfillment_state.delivered_at` +
--      `feedback_dispatched_at` — el cron de feedback post-entrega
--      busca órdenes con delivered_at < now() - 3 días y
--      feedback_dispatched_at IS NULL.
--
--   3. `contacts.last_inbound_at` — timestamp del último mensaje
--      INBOUND del contacto. Usado por el cron de re-engagement para
--      detectar contactos inactivos > 14 días. Lo mantenemos separado
--      de `conversations.last_message_at` porque ese incluye mensajes
--      salientes (agente respondió hace 14 días no es lo mismo que
--      "cliente lleva 14 días sin escribir").
--
--   4. `contact_reengagement_state` — log de cuándo se le envió un
--      mensaje de re-engagement a cada contacto. Evita reenviar el
--      mismo nudge cada vez que el cron corre. Si después de N días el
--      cliente vuelve a entrar en silencio, podemos reactivar dejando
--      pasar un cooldown.

-- 1) Cart recovery anti-spam
ALTER TABLE shopify_checkouts
  ADD COLUMN IF NOT EXISTS recovery_dispatched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shopify_checkouts_recovery_due
  ON shopify_checkouts (created_at)
  WHERE completed_at IS NULL AND recovery_dispatched_at IS NULL;

COMMENT ON COLUMN shopify_checkouts.recovery_dispatched_at IS
  'Cuándo se disparó el automation_trigger shopify_abandoned_checkout para este checkout. NULL = pendiente. El cron solo dispara una vez por checkout para no spamear al cliente.';

-- 2) Feedback post-entrega
ALTER TABLE shopify_order_fulfillment_state
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feedback_dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipment_status TEXT;

CREATE INDEX IF NOT EXISTS idx_shopify_fulfillment_feedback_due
  ON shopify_order_fulfillment_state (delivered_at)
  WHERE delivered_at IS NOT NULL AND feedback_dispatched_at IS NULL;

COMMENT ON COLUMN shopify_order_fulfillment_state.delivered_at IS
  'Cuándo Shopify reportó shipment_status=delivered para esta orden. El cron de feedback espera 3 días desde acá para preguntarle al cliente cómo le fue.';

-- 3) Re-engagement: último inbound del contacto
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_last_inbound_workspace
  ON contacts (workspace_id, last_inbound_at)
  WHERE opted_out = FALSE;

COMMENT ON COLUMN contacts.last_inbound_at IS
  'Timestamp del último mensaje INBOUND (cliente → nosotros) recibido del contacto. Distinto de conversations.last_message_at, que incluye mensajes salientes. Lo usa el cron de re-engagement para detectar contactos inactivos.';

-- 4) Log de re-engagement (anti-spam)
CREATE TABLE IF NOT EXISTS contact_reengagement_state (
  contact_id UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  last_reengagement_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reengagement_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_contact_reengagement_workspace
  ON contact_reengagement_state (workspace_id, last_reengagement_at);

ALTER TABLE contact_reengagement_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read reengagement" ON contact_reengagement_state;
CREATE POLICY "members read reengagement" ON contact_reengagement_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = contact_reengagement_state.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service role writes reengagement" ON contact_reengagement_state;
CREATE POLICY "service role writes reengagement" ON contact_reengagement_state
  FOR ALL USING (false);

COMMENT ON TABLE contact_reengagement_state IS
  'Una fila por contacto que recibió al menos un mensaje de re-engagement. El cron usa last_reengagement_at para imponer un cooldown (no volver a tocarlo antes de N días).';

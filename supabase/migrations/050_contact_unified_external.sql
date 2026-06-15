-- ============================================================
-- 050: cross-channel contact dedupe / unification
-- ============================================================
--
-- (Spec original lo numeraba "049"; bumpeamos por la colisión con
--  047_shopify_checkouts_full.)
--
-- Hasta ahora un mismo cliente que escribía por WhatsApp + IG + Gmail
-- aparecía como TRES contactos distintos. La IA respondía como si
-- nunca lo hubiera atendido, y el sidebar de Shopify mostraba sólo lo
-- que coincidía con esa columna en particular.
--
-- Estrategia:
--   * `unified_contact_id` apunta al contacto "primario" del cliente
--     (típicamente el primero que vimos). Los demás registros lo
--     referencian. Al armar el system prompt, el runner lee el
--     ai_summary + shopify_customer_data desde el primario.
--   * Índices lower(phone) / lower(email) por workspace para que el
--     dedupe en el ingest sea barato.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS unified_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_phone_norm
  ON contacts (workspace_id, lower(phone))
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email_norm
  ON contacts (workspace_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_unified
  ON contacts (unified_contact_id)
  WHERE unified_contact_id IS NOT NULL;

COMMENT ON COLUMN contacts.unified_contact_id IS
  'Si este contacto representa el mismo cliente humano que otro contacto del mismo workspace (mismo teléfono normalizado o mismo email case-insensitive), apunta al "primario" — el primer contacto que el workspace vio para ese cliente. NULL = este contacto ES el primario o no hay match.';

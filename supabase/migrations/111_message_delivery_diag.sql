-- Visibilidad de entrega de WhatsApp.
--
-- Problema real: Meta a veces marca 'failed' SIN array `errors` (calla el
-- motivo), o nunca manda 'delivered' y el mensaje queda en 'sent' para siempre
-- (TTL-drop, pausa de marketing a EE.UU., destinatario no alcanzable). Riverz
-- guardaba solo un texto derivado en error_reason (migración 110) y tiraba el
-- payload crudo, el message_status de la respuesta de envío y la salud de la
-- cuenta. Sin eso el comercio no puede entender por qué un mensaje no llegó.
--
-- Esta migración es aditiva e idempotente. NO toca el CHECK de
-- message_templates.status (Draft/Pending/Approved/Rejected): el estado crudo
-- de Meta se guarda aparte para no perder PAUSED/DISABLED.

-- 1) Diagnóstico por mensaje.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_code INT,
  ADD COLUMN IF NOT EXISTS meta_status_raw JSONB,
  ADD COLUMN IF NOT EXISTS delivery_unconfirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS held_for_quality BOOLEAN NOT NULL DEFAULT false;

-- Barrido del watchdog: candidatos = salientes atascados en 'sent' sin
-- confirmar. Índice parcial para que el sweep no escanee toda la tabla.
CREATE INDEX IF NOT EXISTS idx_messages_stuck_sent
  ON messages (created_at)
  WHERE status = 'sent' AND delivery_unconfirmed_at IS NULL;

-- 2) Snapshot de salud de la cuenta sobre la conexión. Hoy fetchWhatsAppAccountHealth
--    se llama una vez al conectar y su resultado se tira en un toast. Persistirlo
--    habilita el panel "Estado de WhatsApp" y el refresco periódico.
--    messaging_limit_tier ya existe (migración 058).
ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS health_can_send TEXT,
  ADD COLUMN IF NOT EXISTS health_review_status TEXT,
  ADD COLUMN IF NOT EXISTS health_blockers JSONB,
  ADD COLUMN IF NOT EXISTS quality_rating TEXT,
  ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ;

-- 3) Calidad y estado real (Meta) por plantilla. quality_score UNKNOWN =
--    plantilla nueva sin historial → elegible a pacing (retención). meta_status
--    preserva PAUSED/DISABLED, que el `status` reducido colapsaba a 'Rejected'.
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS quality_score TEXT,
  ADD COLUMN IF NOT EXISTS meta_status TEXT;

-- 4) wa_id normalizado del contacto: la identidad que Meta devuelve. El "+54 9"
--    argentino resuelve al mismo wa_id con o sin el 9, así que deduplicar por
--    wa_id evita el split "misma persona, dos contactos".
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_id TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_wa_id
  ON contacts (workspace_id, wa_id)
  WHERE wa_id IS NOT NULL;

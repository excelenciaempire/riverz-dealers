-- ============================================================
-- 140: mp_rejected_payments — recuperación de pagos rechazados
-- ============================================================
--
-- Un pago rechazado en Mercado Pago NO genera pedido en Shopify, así que
-- no existe en ninguna tabla de comercio: se pierde. La hoja de
-- contabilidad (repo contabilidad-shopify) ya los junta y les cruza el
-- contacto contra los carritos abandonados; esta tabla es el espejo de
-- esa lista dentro de Riverz, con el estado de contacto y recuperación.
--
-- Ciclo de vida de una fila:
--
--   ingresada        → la app de contabilidad la empujó (POST)
--   dispatched_at    → el cron la reclamó (barrera anti doble envío)
--   contacted_at     → el disparador `payment_rejected` corrió de verdad
--   skip_reason      → no se le escribió, y por qué (auditable)
--   recovered_at     → después de contactar apareció un pedido pagado
--
-- La clave (workspace_id, external_key) es el id de pago MP MÁS VIEJO del
-- grupo de intentos de esa persona. Es estable: los reintentos nuevos se
-- suman al grupo sin cambiar el mínimo, así que reenviar la misma lista
-- nunca duplica la fila ni el mensaje.

CREATE TABLE IF NOT EXISTS mp_rejected_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identidad del grupo de intentos (id MP más viejo de la persona).
  external_key TEXT NOT NULL,
  mp_payment_ids TEXT[] NOT NULL DEFAULT '{}',

  rejected_at TIMESTAMPTZ NOT NULL,
  payer_name TEXT,
  email TEXT,
  -- E.164 sin `+` (formato Meta). NULL = la hoja no pudo cruzar el contacto.
  phone TEXT,
  amount NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'ARS',
  installments INT,
  attempts INT NOT NULL DEFAULT 1,
  status_detail TEXT,
  -- Agrupación del status_detail: retry | funds | bank | risk | other.
  reason_bucket TEXT,
  payment_method TEXT,
  recovery_url TEXT,

  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  dispatched_at TIMESTAMPTZ,
  contacted_at TIMESTAMPTZ,
  dispatch_attempts INT NOT NULL DEFAULT 0,
  skip_reason TEXT,
  last_error TEXT,

  recovered_at TIMESTAMPTZ,
  recovered_order_id TEXT,
  recovered_amount NUMERIC(12, 2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mp_rejected_payments_unique_key
    UNIQUE (workspace_id, external_key)
);

-- Cola del cron: pendientes de reclamar, con teléfono, más viejos primero.
CREATE INDEX IF NOT EXISTS idx_mp_rejected_pending
  ON mp_rejected_payments (workspace_id, rejected_at)
  WHERE dispatched_at IS NULL AND phone IS NOT NULL;

-- Antispam por teléfono + verificación de recuperación (ambos filtran por
-- contactados recientes).
CREATE INDEX IF NOT EXISTS idx_mp_rejected_contacted
  ON mp_rejected_payments (workspace_id, contacted_at DESC)
  WHERE contacted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mp_rejected_contact
  ON mp_rejected_payments (contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE mp_rejected_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read mp rejected" ON mp_rejected_payments;
CREATE POLICY "members read mp rejected" ON mp_rejected_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = mp_rejected_payments.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Escrituras solo por service role (endpoint de ingesta + cron).
DROP POLICY IF EXISTS "service role writes mp rejected" ON mp_rejected_payments;
CREATE POLICY "service role writes mp rejected" ON mp_rejected_payments
  FOR ALL USING (false);

COMMENT ON TABLE mp_rejected_payments IS
  'Pagos rechazados de Mercado Pago espejados desde la hoja de contabilidad, con el estado de contacto por WhatsApp y de recuperación. Un pago rechazado no crea pedido en Shopify, así que esta es la única huella dentro de Riverz.';

COMMENT ON COLUMN mp_rejected_payments.external_key IS
  'Id de pago MP más viejo del grupo de intentos de la persona. Estable ante reintentos nuevos, por eso se usa como clave de upsert.';

COMMENT ON COLUMN mp_rejected_payments.skip_reason IS
  'Por qué no se le escribió: no_phone | too_old | risk | recent_contact | opted_out | no_contact | not_sent. NULL = no se saltó. not_sent = el motor no llegó a enviar (sin automatización activa, segmento que no matcheó, o el guard de IA reciente).';

COMMENT ON COLUMN mp_rejected_payments.reason_bucket IS
  'retry (datos mal cargados) | funds (sin fondos) | bank (autorización del banco) | risk (fraude, NO se contacta) | other.';

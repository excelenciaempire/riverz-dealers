-- ============================================================
-- 142: Mercado Pago como integración auto-servicio
-- ============================================================
--
-- Hasta ahora los pagos rechazados sólo entraban empujados por la hoja de
-- contabilidad de UN comercio (migración 140). Para que cualquier cuenta
-- pueda usar la recuperación, Mercado Pago pasa a ser una integración más:
-- el comerciante pega su Access Token y un cron le trae los rechazos.
--
-- El token va en `workspace_integrations`, que ya tiene RLS y la columna
-- del secreto revocada para `authenticated` (migración 078). Sólo hace
-- falta admitir el proveedor nuevo en el CHECK.

ALTER TABLE workspace_integrations
  DROP CONSTRAINT IF EXISTS workspace_integrations_provider_check;

ALTER TABLE workspace_integrations
  ADD CONSTRAINT workspace_integrations_provider_check
  CHECK (provider IN ('klaviyo', 'mercadopago'));

-- Marca de la última corrida del sync, para no volver a barrer meses de
-- historial en cada tick. Es informativa: el cron igual pide una ventana
-- con solape, porque un pago puede aparecer con retraso.
ALTER TABLE workspace_integrations
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

GRANT SELECT (last_sync_at) ON public.workspace_integrations TO authenticated;

COMMENT ON COLUMN workspace_integrations.last_sync_at IS
  'Última vez que un cron leyó datos de este proveedor. Informativo: los syncs piden una ventana con solape porque los pagos pueden llegar con retraso.';

-- ── El pago rechazado necesita saber si la persona terminó comprando ──
--
-- La regla del producto es escribirle SÓLO a quien no completó la compra.
-- `paid_at` la marca el sync cuando aparece un pago aprobado de la misma
-- persona posterior al rechazo, y el cron de envío no toca esas filas.
-- Es distinto de `recovered_at`: eso es "compró DESPUÉS de que le
-- escribimos" (mérito de la automatización); esto es "compró solo".
ALTER TABLE mp_rejected_payments
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mp_rejected_unpaid
  ON mp_rejected_payments (workspace_id, rejected_at)
  WHERE dispatched_at IS NULL AND paid_at IS NULL AND phone IS NOT NULL;

COMMENT ON COLUMN mp_rejected_payments.paid_at IS
  'La persona completó la compra por su cuenta después del rechazo. Nunca se le escribe. No confundir con recovered_at, que es la compra posterior a nuestro mensaje.';

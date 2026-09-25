-- Diario de entregas de WhatsApp para el backfill de mensajes.
--
-- WhatsApp Cloud API no tiene un endpoint para leer mensajes pasados, ni en
-- coexistencia: lo que no quedó guardado cuando llegó el webhook no se puede
-- volver a pedir a Meta. Por eso cada entrega que trae mensajes queda anotada
-- en webhook_events_raw (provider 'channels:whatsapp:journal', ya procesada:
-- no cuenta como pendiente y /api/cron/pii-purge la borra a los 14 días) y el
-- backfill la vuelve a pasar por la bandeja.
--
-- account_id es el phone_number_id del número: con él el backfill encuentra
-- las entregas de una conexión sin recorrer el cuerpo de todas las demás.

ALTER TABLE public.webhook_events_raw
  ADD COLUMN IF NOT EXISTS account_id text;

CREATE INDEX IF NOT EXISTS webhook_events_raw_account_idx
  ON public.webhook_events_raw (account_id, received_at)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN public.webhook_events_raw.account_id IS
  'phone_number_id de WhatsApp de la entrega. Lo usa el backfill de mensajes para encontrar las entregas de una conexión.';

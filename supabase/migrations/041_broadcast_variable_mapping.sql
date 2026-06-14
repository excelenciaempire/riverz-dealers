-- ============================================================
-- 041: Mapeo de variables por broadcast + status skipped_opt_out
-- ============================================================
--
-- variable_mapping: por cada variable de la plantilla ({{1}}, {{2}}…)
-- el merchant elige qué campo del CRM va a llenarla en el momento del
-- envío. Se guarda como { "1": "first_name", "2": "email", ... }.
-- El cron de broadcasts lee el contacto + este mapping y arma los
-- parámetros antes de pegarle a Meta.
--
-- skipped_opt_out: cuando el motor encuentra un contacto con
-- contacts.opted_out = TRUE no manda el template y deja el destinatario
-- marcado con este nuevo status, para que la métrica del campaña
-- distinga "fallaron" de "se saltaron por opt-out".

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS variable_mapping JSONB;

ALTER TABLE broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;

ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN (
    'pending',
    'sent',
    'delivered',
    'read',
    'replied',
    'failed',
    'skipped_opt_out'
  ));

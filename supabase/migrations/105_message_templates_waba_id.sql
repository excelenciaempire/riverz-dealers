-- Alcance de las plantillas por WABA.
--
-- Las plantillas viven en Meta A NIVEL de WABA: cada WhatsApp Business Account
-- tiene su propio catálogo. `message_templates` solo guardaba user_id +
-- workspace_id, así que al cambiar de número (nuevo WABA) las plantillas del
-- WABA anterior seguían listadas para el nuevo — porque nada las ataba al WABA
-- del que salieron. Con `waba_id` la sincronización estampa el WABA origen y la
-- bandeja/plantillas filtran por el WABA actualmente conectado; las de un WABA
-- viejo dejan de aparecer.
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS waba_id TEXT;

CREATE INDEX IF NOT EXISTS idx_message_templates_waba_id
  ON message_templates (waba_id);

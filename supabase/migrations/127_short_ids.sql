-- ============================================================
-- 127: Short IDs para URLs cortas
-- ============================================================
-- Las páginas de detalle usaban el UUID completo en la URL
-- (/plantillas/de9c8c9f-e9ae-4df7-bb58-fd2db42094d1). Agregamos un `short_id`
-- generado = primeros 8 caracteres del UUID. Los enlaces usan el short id y los
-- loaders lo resuelven (siguen aceptando el UUID completo por compatibilidad).
--
-- Columna GENERATED STORED: se calcula sola al insertar y se backfillea sola en
-- las filas existentes; el id nunca cambia, así que es estable.
--
-- Colisión: 8 hex = 32 bits; la consulta va acotada al workspace por RLS, así
-- que dos filas del mismo comercio con igual prefijo es prácticamente imposible.
--
-- Aplicar MANUALMENTE vía la Management API.
-- ============================================================

ALTER TABLE message_templates   ADD COLUMN IF NOT EXISTS short_id text GENERATED ALWAYS AS (left(id::text, 8)) STORED;
ALTER TABLE broadcasts          ADD COLUMN IF NOT EXISTS short_id text GENERATED ALWAYS AS (left(id::text, 8)) STORED;
ALTER TABLE automations         ADD COLUMN IF NOT EXISTS short_id text GENERATED ALWAYS AS (left(id::text, 8)) STORED;
ALTER TABLE flows               ADD COLUMN IF NOT EXISTS short_id text GENERATED ALWAYS AS (left(id::text, 8)) STORED;
ALTER TABLE instagram_campaigns ADD COLUMN IF NOT EXISTS short_id text GENERATED ALWAYS AS (left(id::text, 8)) STORED;
ALTER TABLE workspaces          ADD COLUMN IF NOT EXISTS short_id text GENERATED ALWAYS AS (left(id::text, 8)) STORED;

CREATE INDEX IF NOT EXISTS message_templates_short_id_idx   ON message_templates (short_id);
CREATE INDEX IF NOT EXISTS broadcasts_short_id_idx          ON broadcasts (short_id);
CREATE INDEX IF NOT EXISTS automations_short_id_idx         ON automations (short_id);
CREATE INDEX IF NOT EXISTS flows_short_id_idx               ON flows (short_id);
CREATE INDEX IF NOT EXISTS instagram_campaigns_short_id_idx ON instagram_campaigns (short_id);
CREATE INDEX IF NOT EXISTS workspaces_short_id_idx          ON workspaces (short_id);

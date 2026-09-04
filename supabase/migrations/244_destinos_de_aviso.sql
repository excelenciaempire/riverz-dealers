-- 244 — Cada número elige qué avisos recibe.
--
-- Un encargado de turno no siempre necesita enterarse de un cobro y quien
-- administra el saldo no siempre atiende conversaciones. La lista anterior no
-- podía expresarlo: todo número recibía todo.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS alert_destinations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE workspaces
  DROP CONSTRAINT IF EXISTS workspaces_alert_destinations_array;

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_alert_destinations_array
  CHECK (jsonb_typeof(alert_destinations) = 'array');

COMMENT ON COLUMN workspaces.alert_destinations IS
  'Destinos de WhatsApp y su alcance: escalations, notifications o both. Reemplaza gradualmente alert_phones.';

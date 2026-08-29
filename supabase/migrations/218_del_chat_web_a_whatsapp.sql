-- 218 — El chat de la web sigue en WhatsApp.
--
-- El problema:
--   Quien escribe en el chat de la tienda es un visitante anónimo. Cierra la
--   pestaña y la conversación se termina: no hay a dónde escribirle, y si
--   vuelve mañana desde el teléfono es otra persona para el sistema. La
--   llamada ya tiene su salida a un canal más rico (`send_whatsapp` durante la
--   llamada) y el comentario también (comentario → DM). El chat web era el
--   único que no tenía ninguna.
--
-- La salida:
--   Un botón "Seguir por WhatsApp" que abre wa.me con un mensaje ya escrito
--   que lleva un código. Lo INICIA la persona, así que no hace falta ninguna
--   plantilla aprobada por Meta y se abre la ventana de 24 h sola.
--
-- Por qué una tabla y no un código derivado del id de visitante:
--   El código llega por un canal público —el propio mensaje de WhatsApp— y lo
--   único que hace es unir dos fichas. Un código adivinable dejaba que
--   cualquiera se quedara con la conversación web de otro y, con ella, con lo
--   que esa persona hubiera contado. El código es aleatorio, se usa UNA vez y
--   vence a las 24 h.
--
-- Lo que el código prueba, y lo que no:
--   Prueba que quien escribe por WhatsApp tenía abierta esa sesión del chat
--   web. Eso es identidad PROBADA por el canal (migración 206), del mismo
--   orden que un pedido pagado — muy por encima de un correo que un anónimo
--   tipea en un chat. Por eso el teléfono que queda se marca `canal` y sí une.
--
-- APLICAR A MANO por la Management API (no corre en el deploy de Render).

CREATE TABLE IF NOT EXISTS webchat_handoffs (
  -- Aleatorio, imposible de adivinar. Es lo único que viaja por WhatsApp.
  code TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- El visitante del chat web y su hilo. Es lo que se va a unir.
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cuándo llegó el WhatsApp con este código, y de qué ficha vino.
  claimed_at TIMESTAMPTZ,
  claimed_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL
);

-- La búsqueda del reclamo es por código (la PK). Este índice es para la
-- limpieza de los vencidos y para mirar los de un comercio.
CREATE INDEX IF NOT EXISTS webchat_handoffs_workspace_idx
  ON webchat_handoffs (workspace_id, created_at DESC);

ALTER TABLE webchat_handoffs ENABLE ROW LEVEL SECURITY;

-- Sólo el comercio ve los suyos. El widget y el webhook entran con la clave de
-- servicio, que saltea RLS: nadie más necesita escribir acá.
DROP POLICY IF EXISTS webchat_handoffs_select ON webchat_handoffs;
CREATE POLICY webchat_handoffs_select ON webchat_handoffs
  FOR SELECT USING (is_workspace_member(workspace_id));

COMMENT ON TABLE webchat_handoffs IS
  'Chat web → WhatsApp: código de un solo uso que une al visitante anónimo con el número desde el que escribe. Vence a las 24 h.';

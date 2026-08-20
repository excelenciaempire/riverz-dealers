-- 171 — Canal `webchat`: el chat de la web del comercio.
--
-- Qué es:
--   Un widget que el comercio pega en su tienda. Quien navega escribe ahí y
--   habla con el mismo agente de IA que ya atiende WhatsApp e Instagram, con
--   el mismo conocimiento (la web crawleada, el research de cada producto, el
--   catálogo) y las mismas herramientas (consultar un pedido, armar un
--   checkout). La conversación cae en la bandeja como una más.
--
-- Por qué un canal propio y no una variante de otro:
--   No hay cuenta de plataforma detrás. La persona es un visitante anónimo
--   —sin teléfono, sin email, sin usuario— identificado por un id que el
--   navegador guarda. `contacts.phone` ya es nullable y el índice
--   `uq_contact_identity (workspace_id, channel, external_id)` lo soporta sin
--   tocar el esquema: el `external_id` es ese id de visitante.
--
-- La conexión (`channel_connections` con channel='webchat', una por comercio)
-- guarda en `config` lo que el comercio configura —color, saludo, agente,
-- dominios permitidos— y nada secreto: la llave pública del widget se deriva
-- por HMAC del workspace, no se almacena.
--
-- APLICAR A MANO por la Management API (no corre en el deploy de Render) y
-- ANTES de desplegar el código que inserta channel='webchat'.

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'
));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'
));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'
));

ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_connections_channel_check;
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'
));

-- Una sola conexión de chat web por comercio: el widget se instala una vez y
-- toda la configuración vive en esa fila. Sin esto, guardar dos veces desde
-- dos pestañas dejaba filas hermanas y el visitante caía en la que el `limit(1)`
-- eligiera, con otra configuración.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webchat_connection_per_workspace
  ON channel_connections(workspace_id)
  WHERE channel = 'webchat';

-- 135 — Canal `ml_review`: las opiniones de producto de Mercado Libre.
--
-- Por qué un canal propio y no `mercadolibre`:
--   Una opinión NO es una conversación. Mercado Libre la publica anonimizada
--   (`reviewer_id: 0`) y no ofrece forma de contestarla por API. Meterla en
--   `mercadolibre` la mezclaría con las preguntas y los mensajes post-venta
--   —que sí son de una persona y sí se responden— y aparecería en la pestaña
--   de Mensajes prometiendo una respuesta que no existe.
--
--   Como comentario público sobre un producto, su lugar es la pestaña de
--   Comentarios, junto a los de Facebook e Instagram. Mismo precedente que
--   `tiktok_comment` (migración 099).
--
-- APLICAR A MANO por la Management API (no corre en el deploy de Render) y
-- ANTES de desplegar el código que inserta channel='ml_review'.

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review'
));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review'
));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review'
));

ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_connections_channel_check;
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_channel_check CHECK (channel IN (
  'whatsapp','instagram','messenger','gmail','outlook',
  'fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review'
));

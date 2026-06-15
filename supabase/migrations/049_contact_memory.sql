-- ============================================================
-- 049: contact memory — long-term knowledge about the customer
-- ============================================================
--
-- (Spec original lo numeraba "048"; bumpeamos a 049 por la colisión
--  con 047_shopify_checkouts_full.)
--
-- Queremos que el agente IA recuerde QUIÉN es el cliente entre
-- conversaciones — no sólo dentro de una. Para eso persistimos:
--
--   * `ai_summary`: resumen rodante de lo que sabemos del cliente
--     (preferencias, alergias, requests comunes, tono que usa, etc.).
--     Generado por Claude al cerrar la conversación o cada 25 mensajes.
--   * `shopify_customer_data`: cache JSONB del customer en Shopify —
--     total gastado, # pedidos, último pedido, tags, ciudad, marketing
--     opt-in y los últimos pedidos con line_items. Refrescado cada 24h
--     vía /lib/contacts/enrich.ts.
--   * `conversation_count` / `last_ai_conversation_at`: telemetría para
--     decidir cuándo regenerar el resumen y para mostrar "Cliente
--     frecuente — X conversaciones previas" en el sidebar.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS shopify_customer_data JSONB;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS shopify_data_synced_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conversation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_ai_conversation_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.ai_summary IS
  'Resumen acumulativo de lo que sabemos del cliente (preferencias, contexto, historial). Inyectado como "Lo que sabemos del cliente" en el system prompt de la IA.';

COMMENT ON COLUMN contacts.shopify_customer_data IS
  'Cache JSONB del customer en Shopify: total_spent, orders_count, last_order_date, tags, default_address (country, city), accepts_marketing, lifetime_orders [{name,total_price,line_items_titles}]. TTL 24h.';

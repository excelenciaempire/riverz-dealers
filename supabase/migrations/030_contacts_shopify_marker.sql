-- ============================================================
-- 030: Marca contacts.is_shopify_customer
-- ============================================================
--
-- Flag para que la lista de Contactos pueda mostrar un badge
-- "Cliente Shopify" sin tener que pegar la Admin API por cada fila
-- (que sería N requests por página).
--
-- Se setea true:
--   1) Al upsertear un contacto via Shopify webhook (orders/create,
--      checkouts/create, customers/create — el adapter en
--      contact-upsert.ts marca esta flag).
--   2) Manualmente con un backfill por workspace (futura iteración).
--
-- Default false — los contactos creados por la entrada por WhatsApp
-- (sin pasar por Shopify) quedan sin marca hasta que aparezca su
-- email o teléfono en una orden.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_shopify_customer BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS contacts_is_shopify_customer_idx
  ON contacts (workspace_id, is_shopify_customer)
  WHERE is_shopify_customer = true;

COMMENT ON COLUMN contacts.is_shopify_customer IS
  'True si el contacto fue visto en una orden/customer de Shopify. Se usa en /contactos para mostrar un badge sin pegar la Admin API.';

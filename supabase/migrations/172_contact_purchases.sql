-- ============================================================
-- 172_contact_purchases.sql
--
-- Qué compró cada contacto, guardado para siempre.
--
-- Hasta ahora lo único que Riverz sabía de las compras de una persona era el
-- resumen que trae Shopify en la ficha del cliente —cuántos pedidos y cuánto
-- gastó— más un puñado de pedidos recientes metidos dentro del jsonb
-- `contacts.shopify_customer_data`. Ese jsonb se PISA entero en cada
-- sincronización, y la lista de pedidos que Shopify deja leer sin el permiso
-- `read_all_orders` llega sólo hasta 60 días atrás. Resultado: el detalle de
-- las compras se borraba solo cada semana, y en la base viva quedaban 1.770
-- clientes con pedidos contados pero sin un solo pedido a la vista.
--
-- Esta tabla es lo contrario: una fila por pedido, que se agrega y nunca se
-- borra. Da igual si el pedido entró por webhook, por la sincronización
-- nocturna o por un backfill: la clave (workspace, plataforma, id externo) lo
-- deduplica, así que el historial sólo puede crecer. A partir de la conexión,
-- el historial completo se construye solo.
--
-- Por qué NO va en `orders`: esa tabla significa "pedidos que originó el
-- asistente" y es lo que muestra /pedidos. Volcar ahí todas las ventas de la
-- tienda cambiaría el sentido de esa página.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Puede quedar en null: un pedido de invitado se guarda igual y se engancha
  -- al contacto cuando aparece (por email o teléfono).
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'shopify'
    CHECK (platform = ANY (ARRAY['shopify', 'tiendanube', 'woocommerce', 'mercadolibre'])),
  shop_domain TEXT,
  -- Id del pedido en SU plataforma. Junto con workspace + plataforma es la
  -- identidad del pedido para todos los caminos que escriben acá.
  external_id TEXT NOT NULL,
  order_number TEXT,
  placed_at TIMESTAMPTZ,
  currency TEXT,
  total NUMERIC(12,2),
  financial_status TEXT,
  fulfillment_status TEXT,
  -- [{ title, quantity, price }] — lo que hace falta para decir qué compró.
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_email TEXT,
  customer_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE contact_purchases IS
  'Historial de compras del contacto en la tienda conectada. Acumulativo: se agrega y nunca se pisa. Distinto de `orders`, que son los pedidos que originó el asistente.';

-- ON CONFLICT necesita un índice único NO parcial.
CREATE UNIQUE INDEX IF NOT EXISTS contact_purchases_external_key
  ON contact_purchases(workspace_id, platform, external_id);

CREATE INDEX IF NOT EXISTS contact_purchases_contact_idx
  ON contact_purchases(contact_id, placed_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS contact_purchases_workspace_idx
  ON contact_purchases(workspace_id, placed_at DESC NULLS LAST);

-- Enganchar pedidos de invitado cuando el contacto aparezca después.
CREATE INDEX IF NOT EXISTS contact_purchases_email_idx
  ON contact_purchases(workspace_id, customer_email)
  WHERE contact_id IS NULL AND customer_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS contact_purchases_phone_idx
  ON contact_purchases(workspace_id, customer_phone)
  WHERE contact_id IS NULL AND customer_phone IS NOT NULL;

ALTER TABLE contact_purchases ENABLE ROW LEVEL SECURITY;

-- Sólo lectura para el equipo del comercio: todo lo que escribe acá corre con
-- la clave de servicio (webhooks y crons).
DROP POLICY IF EXISTS "Members read workspace purchases" ON contact_purchases;
CREATE POLICY "Members read workspace purchases" ON contact_purchases
  FOR SELECT USING (is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- Hasta dónde llega el historial de cada tienda.
--
-- Sin esto la ficha no puede ser honesta: "3 pedidos" a secas se lee como
-- "compró 3 veces", cuando puede ser "compró 3 veces DESDE que conectaste".
-- Se guarda la fecha del pedido más viejo que la tienda dejó leer.
-- ------------------------------------------------------------
ALTER TABLE shopify_connections
  ADD COLUMN IF NOT EXISTS purchase_history_since TIMESTAMPTZ;

COMMENT ON COLUMN shopify_connections.purchase_history_since IS
  'Fecha del pedido más antiguo que Riverz pudo leer de esta tienda. Sin el permiso read_all_orders, Shopify sólo entrega los últimos 60 días.';

-- ============================================================
-- 126 — Tiendas multi-plataforma: Tiendanube + WooCommerce
-- ============================================================
--
-- Hasta acá "tienda conectada" era sinónimo de Shopify: la conexión, el
-- catálogo, los carritos y los pedidos vivían en tablas con el nombre de
-- la plataforma adentro. Tiendanube (AR/BR/MX) y WooCommerce cubren el
-- mercado donde Shopify no llega, y necesitan EXACTAMENTE las mismas
-- capacidades: catálogo para el agente, carrito abandonado, pedidos
-- espejados, contactos marcados como compradores.
--
-- Decisión de diseño: NO duplicamos el modelo por plataforma. Las tablas
-- existentes pasan a ser genéricas y se discriminan por una columna
-- `platform`. Los ~60 consumidores que ya leen shopify_products /
-- shopify_checkouts / orders (catálogo del agente, cron de recuperación
-- de carritos, segmentos, tablero, exportaciones) siguen funcionando sin
-- tocarlos y ganan las tiendas nuevas de arranque. El nombre de las
-- tablas queda por compatibilidad — renombrarlas obligaría a reescribir
-- cada consumidor por cero ganancia funcional.
--
-- La clave de tienda sigue siendo `shop_domain`, ahora genérica:
--   * shopify      → "mitienda.myshopify.com"
--   * tiendanube   → "mitienda.mitiendanube.com" (host de la tienda)
--   * woocommerce  → "mitienda.com" (host del sitio WordPress)
--
-- Idempotente. Se aplica a mano vía la Management API de Supabase.
-- ============================================================

-- ── 1) Conexiones de tienda ──────────────────────────────────────────
ALTER TABLE public.shopify_connections
  -- Qué plataforma es esta conexión. 'shopify' por defecto para que las
  -- filas existentes queden correctamente clasificadas sin backfill.
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'shopify',
  -- Id de tienda del lado de la plataforma. Tiendanube lo exige en la
  -- URL de CADA request (https://api.tiendanube.com/{v}/{store_id}/...),
  -- así que sin esto la conexión es inutilizable. En WooCommerce guarda
  -- el key_id que devuelve /wc-auth (sirve para revocar la clave).
  ADD COLUMN IF NOT EXISTS external_store_id TEXT,
  -- URL pública de la tienda. Shopify la deriva del shop_domain, pero
  -- Tiendanube y WooCommerce pueden servir en un dominio propio distinto
  -- de la clave — la necesitamos para armar los links de producto.
  ADD COLUMN IF NOT EXISTS store_url TEXT,
  -- Segundo secreto de credencial, cifrado (iv:ct:tag). Hoy solo lo usa
  -- WooCommerce, cuya autenticación es un PAR (consumer_key va en
  -- access_token, consumer_secret acá). Separado de webhook_secret a
  -- propósito: ese firma las entregas entrantes y se rota aparte.
  ADD COLUMN IF NOT EXISTS api_secret TEXT;

-- Shopify tiene sus dos métodos ('oauth' | 'admin_token'); WooCommerce
-- suma 'api_key' (el par consumer_key/secret, sea por /wc-auth o pegado
-- a mano). Tiendanube usa 'oauth'. El CHECK viejo rechazaría 'api_key',
-- así que lo reemplazamos.
ALTER TABLE public.shopify_connections
  DROP CONSTRAINT IF EXISTS shopify_connections_connection_method_check;
ALTER TABLE public.shopify_connections
  ADD CONSTRAINT shopify_connections_connection_method_check
    CHECK (connection_method IN ('oauth', 'admin_token', 'api_key'));

ALTER TABLE public.shopify_connections
  DROP CONSTRAINT IF EXISTS shopify_connections_platform_check;
ALTER TABLE public.shopify_connections
  ADD CONSTRAINT shopify_connections_platform_check
    CHECK (platform IN ('shopify', 'tiendanube', 'woocommerce'));

-- Toda búsqueda por tienda (webhooks) y por workspace (tarjeta de
-- Ajustes, crons) ahora filtra también por plataforma: un workspace
-- puede tener Shopify y WooCommerce a la vez y cada camino de código
-- debe encontrar LA SUYA, no la más reciente.
CREATE INDEX IF NOT EXISTS idx_store_connections_platform_shop
  ON public.shopify_connections (platform, shop_domain);
CREATE INDEX IF NOT EXISTS idx_store_connections_workspace_platform
  ON public.shopify_connections (workspace_id, platform, status);

-- Re-emitimos el grant a nivel columna de la migración 087. Los grants
-- por columna NO se extienden solos a las columnas nuevas, así que sin
-- esto `platform` sería ilegible para el cliente con cookie y la tarjeta
-- de Ajustes no podría distinguir plataformas. `api_secret` queda fuera
-- a propósito, igual que access_token y webhook_secret.
REVOKE SELECT ON public.shopify_connections FROM authenticated;
GRANT SELECT (
  id, user_id, shop_domain, shop_name, scope, status, last_error,
  installed_at, uninstalled_at, created_at, updated_at, workspace_id,
  connection_method, currency, platform, external_store_id, store_url
) ON public.shopify_connections TO authenticated;

COMMENT ON COLUMN public.shopify_connections.platform IS
  'shopify | tiendanube | woocommerce. Discrimina la conexión: cada camino de código debe filtrar por su plataforma, nunca tomar "la más reciente del workspace".';
COMMENT ON COLUMN public.shopify_connections.shop_domain IS
  'Clave de tienda genérica: host myshopify.com (Shopify), host mitiendanube.com (Tiendanube) u host del sitio WordPress (WooCommerce).';
COMMENT ON COLUMN public.shopify_connections.external_store_id IS
  'Id de tienda del lado de la plataforma. Obligatorio en Tiendanube (va en la URL de cada request); en WooCommerce guarda el key_id de la credencial.';
COMMENT ON COLUMN public.shopify_connections.api_secret IS
  'Segundo secreto de la credencial, cifrado (iv:ct:tag). WooCommerce: consumer_secret. Nunca se expone al cliente.';

-- ── 2) Catálogo ──────────────────────────────────────────────────────
-- La clave (shop_domain, external_id) ya es única entre plataformas
-- porque shop_domain lo es. `platform` es para mostrar el origen y para
-- que un resync borre solo lo suyo.
ALTER TABLE public.shopify_products
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'shopify';

ALTER TABLE public.shopify_products
  DROP CONSTRAINT IF EXISTS shopify_products_platform_check;
ALTER TABLE public.shopify_products
  ADD CONSTRAINT shopify_products_platform_check
    CHECK (platform IN ('shopify', 'tiendanube', 'woocommerce'));

CREATE INDEX IF NOT EXISTS idx_store_products_platform_shop
  ON public.shopify_products (platform, shop_domain);

COMMENT ON COLUMN public.shopify_products.platform IS
  'Plataforma de origen del producto. El catálogo es una sola tabla: el agente consulta productos sin importar dónde vive la tienda.';

-- ── 3) Carritos abandonados ──────────────────────────────────────────
-- El cron /api/cron/shopify-cart-recovery escanea esta tabla sin filtrar
-- por plataforma: en cuanto Tiendanube escribe acá, la recuperación de
-- carrito funciona igual que en Shopify, sin tocar el cron.
ALTER TABLE public.shopify_checkouts
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'shopify';

ALTER TABLE public.shopify_checkouts
  DROP CONSTRAINT IF EXISTS shopify_checkouts_platform_check;
ALTER TABLE public.shopify_checkouts
  ADD CONSTRAINT shopify_checkouts_platform_check
    CHECK (platform IN ('shopify', 'tiendanube', 'woocommerce'));

COMMENT ON COLUMN public.shopify_checkouts.platform IS
  'Plataforma de origen del carrito. El cron de recuperación no filtra por esto a propósito: recupera carritos de cualquier tienda conectada.';

-- ── 4) Pedidos ───────────────────────────────────────────────────────
-- `shopify_order_id` pasa a ser "id del pedido en la plataforma". No lo
-- renombramos: la columna la escriben/leen el runner de IA, el webhook
-- de pedidos y la reconciliación, y el rename obligaría a tocarlos todos
-- para no ganar nada.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'shopify';

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_platform_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_platform_check
    CHECK (platform IN ('shopify', 'tiendanube', 'woocommerce'));

CREATE INDEX IF NOT EXISTS idx_orders_platform_external
  ON public.orders (platform, shop_domain, shopify_order_id);

COMMENT ON COLUMN public.orders.platform IS
  'Plataforma donde vive el pedido real. shopify_order_id es el id en ESA plataforma (el nombre queda por compatibilidad).';

-- ── 5) Deduplicación de webhooks ─────────────────────────────────────
-- Tiendanube y WooCommerce reintentan las entregas igual que Shopify.
-- La tabla de dedupe existente se llena con (shop_domain, webhook_id),
-- ambas genéricas, así que solo hace falta que exista para los nuevos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'shopify_webhook_deliveries'
  ) THEN
    RAISE NOTICE '126: shopify_webhook_deliveries no existe — el dedupe de webhooks queda inactivo hasta aplicar su migración.';
  END IF;
END $$;

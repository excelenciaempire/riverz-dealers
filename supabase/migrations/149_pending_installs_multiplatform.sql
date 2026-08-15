-- ============================================================
-- 149 — Instalaciones pendientes, para cualquier plataforma
-- ============================================================
--
-- `shopify_pending_installs` (migración 101) resuelve el flujo de tienda
-- de aplicaciones: el comercio instala desde el panel de SU plataforma,
-- antes de tener cuenta en Riverz, así que el token se estaciona acá
-- hasta que se registra o entra y el panel lo reclama.
--
-- Tiendanube exige exactamente lo mismo para homologar —"instalación de
-- la app desde Nuvemshop y no desde el panel de la app"— y hoy no puede:
-- el callback exige un `state` firmado que sólo emite nuestro botón, así
-- que quien llega desde su tienda de aplicaciones muere en
-- `?tiendanube=error&reason=invalid_state`.
--
-- Se generaliza la tabla en vez de duplicarla, igual que en la migración
-- 126: una columna `platform` y la unicidad por (plataforma, tienda). El
-- nombre de la tabla queda por compatibilidad — renombrarla obligaría a
-- tocar el flujo de Shopify, que está en revisión, por cero ganancia.
--
-- Idempotente. Se aplica a mano vía la Management API de Supabase.
-- ============================================================

ALTER TABLE public.shopify_pending_installs
  -- Qué plataforma estacionó esta instalación. 'shopify' por defecto para
  -- que las filas existentes queden bien clasificadas sin backfill.
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'shopify',
  -- Id de tienda del lado de la plataforma. Tiendanube lo exige en la URL
  -- de CADA request, y en el momento de estacionar es lo ÚNICO que
  -- tenemos: el dominio hay que ir a preguntárselo a su API, y eso ya se
  -- hace al reclamar. Shopify no lo usa.
  ADD COLUMN IF NOT EXISTS external_store_id TEXT;

ALTER TABLE public.shopify_pending_installs
  DROP CONSTRAINT IF EXISTS shopify_pending_installs_platform_check;
ALTER TABLE public.shopify_pending_installs
  ADD CONSTRAINT shopify_pending_installs_platform_check
    CHECK (platform IN ('shopify', 'tiendanube', 'woocommerce'));

-- La unicidad pasa a ser por (plataforma, tienda). Antes era sólo
-- shop_domain: con dos plataformas, dos tiendas distintas que compartan
-- dominio —posible: el dominio propio de una tienda Tiendanube puede ser
-- el mismo sitio que un WooCommerce— se pisarían la instalación pendiente
-- una a la otra.
ALTER TABLE public.shopify_pending_installs
  DROP CONSTRAINT IF EXISTS shopify_pending_installs_shop_domain_key;
DROP INDEX IF EXISTS shopify_pending_installs_shop_domain_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_installs_platform_shop
  ON public.shopify_pending_installs (platform, shop_domain);

COMMENT ON COLUMN public.shopify_pending_installs.platform IS
  'shopify | tiendanube | woocommerce. Instalación estacionada esperando que alguien la reclame desde su cuenta.';
COMMENT ON COLUMN public.shopify_pending_installs.external_store_id IS
  'Id de tienda del lado de la plataforma. Obligatorio en Tiendanube (va en la URL de cada request); Shopify no lo usa.';

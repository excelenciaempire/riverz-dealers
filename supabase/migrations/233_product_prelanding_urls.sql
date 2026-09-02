-- Pre-landings públicas encontradas automáticamente durante el sync Shopify.
-- Se mantienen separadas de `websites`: esas son fuentes que el merchant
-- agregó o editó, mientras estas se pueden refrescar al cambiar el sitemap.
ALTER TABLE public.shopify_products
  ADD COLUMN IF NOT EXISTS prelanding_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.shopify_products.prelanding_urls IS
  'Pre-landings públicas asociadas automáticamente al producto desde sitemap.xml de la tienda Shopify.';

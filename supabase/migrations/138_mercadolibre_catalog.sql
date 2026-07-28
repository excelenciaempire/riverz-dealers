-- 138 — Mercado Libre como plataforma de catálogo.
--
-- `shopify_products` es la tabla única de catálogo (migración 126): el agente,
-- la página de Productos, los flujos y la búsqueda leen todos de ahí, y
-- `platform` sólo marca el origen. Sumar Mercado Libre a la lista permitida es
-- lo único que falta para que sus publicaciones queden disponibles para todo
-- eso sin tocar un solo consumidor.
--
-- No se toca `shopify_connections_platform_check`: Mercado Libre no se conecta
-- como tienda, ya viene conectado como canal (`channel_connections`), y
-- duplicar la conexión sería pedirle al comercio que autorice dos veces lo
-- mismo.
--
-- APLICAR A MANO por la Management API.

ALTER TABLE public.shopify_products
  DROP CONSTRAINT IF EXISTS shopify_products_platform_check;
ALTER TABLE public.shopify_products
  ADD CONSTRAINT shopify_products_platform_check
    CHECK (platform IN ('shopify', 'tiendanube', 'woocommerce', 'mercadolibre'));

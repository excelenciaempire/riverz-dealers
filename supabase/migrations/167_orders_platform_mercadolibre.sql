-- Un pedido tiene que decir de dónde viene.
--
-- La columna `platform` de `orders` sólo admitía shopify/tiendanube/woocommerce
-- y su default es 'shopify', así que TODA venta espejada de Mercado Libre
-- quedaba anotada como venta de Shopify. La bandeja no tenía forma de saber a
-- qué panel mandar cuando el comercio quiere ver el pedido del cliente con el
-- que está hablando.
--
-- 1) Se suma 'mercadolibre' al vocabulario.
-- 2) Se corrigen las filas ya escritas: la marca es el shop_domain, que para
--    Mercado Libre es 'mercadolibre:<seller_id>'.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_platform_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_platform_check
  CHECK (platform = ANY (ARRAY['shopify', 'tiendanube', 'woocommerce', 'mercadolibre']));

UPDATE orders
   SET platform = 'mercadolibre'
 WHERE shop_domain LIKE 'mercadolibre:%'
   AND platform IS DISTINCT FROM 'mercadolibre';

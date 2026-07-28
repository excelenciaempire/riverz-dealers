-- ============================================================
-- 128: orders.checkout_token — vínculo exacto entre un pedido y su checkout
-- ============================================================
--
-- La atribución de recuperación de carrito lee la compra por dos caminos:
-- el checkout completado (`shopify_checkouts`) y el pedido nacido de la
-- conversación (`orders`). Hasta ahora no había forma de saber si una fila
-- de cada tabla era LA MISMA compra, así que el analytics las cruzaba por
-- una heurística (misma persona + mismo importe + 24h) que fundía dos
-- compras reales del mismo cliente en una sola.
--
-- Shopify reutiliza el token del checkout en la orden que lo cierra, y ese
-- token es exactamente la clave de `shopify_checkouts (shop_domain,
-- checkout_id)`. Guardándolo en `orders` el cruce pasa a ser exacto: mismo
-- token = misma compra; sin token = compras distintas, se cuentan las dos.
--
-- Queda NULL en los pedidos que el asistente crea vía Admin API
-- (`POST /orders.json`), que no nacen de ningún checkout — que es
-- justamente lo que queremos: esos no tienen contraparte que colapsar.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_token TEXT;

-- El cruce del analytics: dado un checkout, ¿existe el pedido que lo cerró?
CREATE INDEX IF NOT EXISTS idx_orders_checkout_token
  ON public.orders (shop_domain, checkout_token)
  WHERE checkout_token IS NOT NULL;

COMMENT ON COLUMN public.orders.checkout_token IS
  'Token del checkout que originó el pedido (= shopify_checkouts.checkout_id). NULL cuando el pedido no nació de un checkout, p. ej. los que crea el asistente vía Admin API. Lo llena el receptor de pedidos al reconciliar.';

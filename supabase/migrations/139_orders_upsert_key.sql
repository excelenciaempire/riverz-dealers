-- 139 — El índice único de `orders` tiene que servir para UPSERT.
--
-- La migración 137 lo creó PARCIAL (`WHERE shop_domain IS NOT NULL AND
-- shopify_order_id IS NOT NULL`) para no molestar a las filas viejas creadas
-- por la IA sin id de tienda todavía. Postgres rechaza un índice parcial como
-- destino de ON CONFLICT si la inferencia no incluye el mismo predicado, y
-- PostgREST no puede expresarlo: cada upsert moría con
--
--   42P10 — there is no unique or exclusion constraint matching the ON
--           CONFLICT specification
--
-- El sincronizador de Mercado Libre reportaba 42 pedidos y guardaba 0.
--
-- El índice COMPLETO es igual de seguro para aquellas filas: en un índice
-- único de Postgres los NULL no chocan entre sí, así que todos los pedidos de
-- la IA sin `shopify_order_id` conviven sin conflicto. Verificado antes de
-- aplicar: 0 duplicados entre los valores no nulos.
--
-- APLICAR A MANO por la Management API.

DROP INDEX IF EXISTS uq_orders_external;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_external
  ON public.orders (workspace_id, shop_domain, shopify_order_id);

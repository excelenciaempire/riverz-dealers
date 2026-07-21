-- La automatización "Nuevo pedido" no disparaba NUNCA. Carrera entre webhooks.
--
-- `shopify_claim_order_created` usaba la EXISTENCIA de la fila en
-- shopify_order_fulfillment_state como marca de "primera vez que vemos este
-- pedido": INSERT ... ON CONFLICT DO NOTHING, y devolvía true solo si insertó.
--
-- El problema es que esa misma tabla la escribe también el camino de
-- `orders/updated` (vía shopify_record_fulfillment_transition). Shopify entrega
-- ambos topics casi simultáneamente y con frecuencia updated llega PRIMERO —
-- sobre todo cuando el pedido nace pagado. Medido en producción con un pedido
-- real: updated a las 02:57:24.184 y .319, create recién a las .951 y .994.
--
-- Cuando el create llegaba, la fila ya existía → ROW_COUNT = 0 → claim false →
-- la ruta cortaba con skipped:'duplicate_order' y la automatización de
-- confirmación jamás corría. Por eso automation_logs estaba vacía y
-- execution_count en 0 desde el día uno.
--
-- El claim ahora es una marca explícita y propia, no un efecto secundario de
-- que la fila exista. Así el orden de llegada de los topics deja de importar.
alter table public.shopify_order_fulfillment_state
  add column if not exists order_created_claimed_at timestamptz;

comment on column public.shopify_order_fulfillment_state.order_created_claimed_at is
  'Marca de claim del topic orders/create: se setea UNA sola vez por pedido. Independiente de la existencia de la fila, que también crea el camino orders/updated. NULL = todavía no se procesó un orders/create para este pedido.';

-- Backfill: los pedidos que ya existen se dan por reclamados. Sin esto, un
-- reintento de Shopify sobre un pedido viejo pasaría el claim por primera vez
-- y mandaría una confirmación duplicada a un cliente que ya compró hace días.
update public.shopify_order_fulfillment_state
set order_created_claimed_at = coalesce(updated_at, now())
where order_created_claimed_at is null;

create or replace function public.shopify_claim_order_created(
  p_shop_domain text,
  p_order_id bigint,
  p_fulfillment_status text
)
returns boolean
language plpgsql
as $$
DECLARE v_claimed boolean;
BEGIN
  -- Un solo statement atómico: inserta la fila si no existe, o marca el claim
  -- sobre la fila que dejó orders/updated. El WHERE del DO UPDATE hace que un
  -- segundo orders/create (reintento o entrega duplicada) no devuelva fila.
  INSERT INTO shopify_order_fulfillment_state(
    shop_domain, order_id, fulfillment_status, order_created_claimed_at
  )
  VALUES (p_shop_domain, p_order_id, p_fulfillment_status, now())
  ON CONFLICT (shop_domain, order_id) DO UPDATE
    SET order_created_claimed_at = now()
    WHERE shopify_order_fulfillment_state.order_created_claimed_at IS NULL
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

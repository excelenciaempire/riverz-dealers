-- Más disparadores de pedido: pagado / cancelado / reembolsado / entregado.
--
-- El webhook `orders/updated` ya llega a Riverz; hasta ahora solo detectábamos
-- la transición a "despachado". Extendemos el mismo registro de estado (con
-- lock de fila, para no disparar duplicados ante entregas casi simultáneas de
-- Shopify) para detectar también los cambios de estado de pago y la cancelación.
--
-- Las nuevas transiciones solo disparan si YA vimos el pedido antes
-- (`prev_exists`): así un pedido ya-pagado al crearse no dispara "pagado"
-- además de "nuevo pedido". El webhook `orders/create` siembra el estado
-- inicial (sin disparar) para que la primera actualización real compute bien.

ALTER TABLE shopify_order_fulfillment_state
  ADD COLUMN IF NOT EXISTS financial_status TEXT,
  ADD COLUMN IF NOT EXISTS cancelled BOOLEAN NOT NULL DEFAULT false;

-- Cambia el tipo de retorno → hay que DROP + CREATE. Los dos parámetros nuevos
-- llevan DEFAULT para que una llamada vieja de 5 argumentos (código aún no
-- desplegado) siga resolviendo durante la ventana de deploy.
DROP FUNCTION IF EXISTS shopify_record_fulfillment_transition(TEXT, BIGINT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION shopify_record_fulfillment_transition(
  p_shop_domain TEXT,
  p_order_id BIGINT,
  p_fulfillment_status TEXT,
  p_shipment_status TEXT,
  p_just_delivered BOOLEAN,
  p_financial_status TEXT DEFAULT NULL,
  p_cancelled BOOLEAN DEFAULT false
) RETURNS TABLE(
  transitioned_to_fulfilled BOOLEAN,
  transitioned_to_delivered BOOLEAN,
  transitioned_to_paid BOOLEAN,
  transitioned_to_cancelled BOOLEAN,
  transitioned_to_refunded BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
  prev_exists BOOLEAN;
  prev_fulfillment TEXT;
  prev_shipment TEXT;
  prev_delivered_at TIMESTAMPTZ;
  prev_financial TEXT;
  prev_cancelled BOOLEAN;
BEGIN
  SELECT fulfillment_status, shipment_status, delivered_at, financial_status, cancelled
    INTO prev_fulfillment, prev_shipment, prev_delivered_at, prev_financial, prev_cancelled
  FROM shopify_order_fulfillment_state
  WHERE shop_domain = p_shop_domain AND order_id = p_order_id
  FOR UPDATE;
  prev_exists := FOUND;

  INSERT INTO shopify_order_fulfillment_state (
    shop_domain, order_id, fulfillment_status, shipment_status,
    delivered_at, financial_status, cancelled, updated_at
  ) VALUES (
    p_shop_domain, p_order_id, p_fulfillment_status, p_shipment_status,
    CASE WHEN p_just_delivered AND prev_shipment IS DISTINCT FROM 'delivered'
         THEN NOW() ELSE prev_delivered_at END,
    p_financial_status, p_cancelled, NOW()
  )
  ON CONFLICT (shop_domain, order_id) DO UPDATE SET
    fulfillment_status = EXCLUDED.fulfillment_status,
    shipment_status = EXCLUDED.shipment_status,
    delivered_at = EXCLUDED.delivered_at,
    financial_status = EXCLUDED.financial_status,
    cancelled = EXCLUDED.cancelled,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT
    (p_fulfillment_status = 'fulfilled' AND prev_fulfillment IS DISTINCT FROM 'fulfilled'),
    (p_just_delivered AND prev_shipment IS DISTINCT FROM 'delivered'),
    -- Las nuevas solo si ya conocíamos el pedido (evita disparar en el primer
    -- avistamiento, que duplicaría con "nuevo pedido").
    (prev_exists AND p_financial_status = 'paid' AND prev_financial IS DISTINCT FROM 'paid'),
    (prev_exists AND p_cancelled AND prev_cancelled IS DISTINCT FROM true),
    (prev_exists AND p_financial_status IN ('refunded', 'partially_refunded')
       AND COALESCE(prev_financial, '') NOT IN ('refunded', 'partially_refunded'));
END $$;

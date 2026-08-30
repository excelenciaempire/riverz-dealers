-- 222 — Un comprobante es una prueba, no un número suelto
--
-- Hoy un pedido se marca pagado solo si el monto declarado coincide con el
-- total. Medido en Pilar sobre 90 días: 558 pedidos y CUATRO montos cubren el
-- 79% —$39.990 solo es el 36%—, y el precio está publicado en el anuncio. O sea
-- que "el monto coincide" no prueba casi nada: escribir el número correcto lo
-- puede hacer cualquiera que vio la publicidad.
--
-- Peor: el monto lo pasa el modelo, y nada lo obligaba a leerlo de un
-- comprobante. Podía tomarlo del propio mensaje del cliente ("ya te transferí
-- 39990") y marcar el pedido pagado sin que exista ninguna imagen.
--
-- Estas columnas son lo que faltaba para poder decidir con algo más:
--
--   `payment_reference`  el número de operación del comprobante. Es lo único
--                        que identifica UNA transferencia, y por lo tanto lo
--                        único que permite no aceptar la misma dos veces.
--   `payment_evidence`   qué se leyó y qué controles pasaron, para poder
--                        reconstruir el caso si alguien lo discute. Sin esto,
--                        auditar un cobro automático es volver a abrir la
--                        imagen a mano.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_evidence JSONB;

COMMENT ON COLUMN orders.payment_reference IS
  'Número de operación del comprobante. Identifica UNA transferencia: es lo que impide que el mismo comprobante pague dos pedidos.';
COMMENT ON COLUMN orders.payment_evidence IS
  'Qué leyó la IA del comprobante y qué controles pasaron. Para poder explicar un cobro automático meses después.';

-- El mismo comprobante no paga dos pedidos del mismo comercio. Parcial porque
-- la enorme mayoría de los pedidos no tiene referencia y NULL no colisiona.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pago_referencia_por_workspace
  ON orders (workspace_id, payment_reference)
  WHERE payment_reference IS NOT NULL;

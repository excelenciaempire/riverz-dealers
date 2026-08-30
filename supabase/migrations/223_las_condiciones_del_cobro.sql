-- 223 — Las condiciones del cobro automático las pone el comercio
--
-- Cuando llega un comprobante por WhatsApp, la IA puede dar el pedido por
-- cobrado sola. Para no marcar pagado lo que no se pagó, tenía cuatro cortes
-- —comprobante de verdad, un solo pedido pendiente, número de operación sin
-- repetir, y cuánto puede diferir el monto— y los cuatro estaban escritos en el
-- código. O sea: la política de cobro de cada negocio era la nuestra.
--
-- No es lo mismo un comercio que vende cuatro precios repetidos (donde acertar
-- el monto no prueba nada) que uno de presupuestos únicos (donde el monto SÍ
-- identifica la transferencia). Estas columnas dejan que cada uno lo decida.
--
-- Los valores por defecto son exactamente lo que hacía el código, así que nadie
-- se despierta con un agente distinto del que tenía.

ALTER TABLE workspace_checkout_config
  ADD COLUMN IF NOT EXISTS pago_exige_comprobante BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pago_un_solo_pendiente BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pago_exige_referencia BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pago_tolerancia_pct NUMERIC(5,2) NOT NULL DEFAULT 0.1;

COMMENT ON COLUMN workspace_checkout_config.pago_exige_comprobante IS
  'Exigir una imagen o documento del cliente para dar por cobrado. Apagado, alcanza con que lo diga por escrito.';
COMMENT ON COLUMN workspace_checkout_config.pago_un_solo_pendiente IS
  'No cobrar solo cuando la persona tiene más de un pedido pendiente: el monto no dice cuál pagó.';
COMMENT ON COLUMN workspace_checkout_config.pago_exige_referencia IS
  'Exigir el número de operación. Es lo único que impide que el mismo comprobante pague dos pedidos.';
COMMENT ON COLUMN workspace_checkout_config.pago_tolerancia_pct IS
  'Cuánto puede diferir el monto del comprobante respecto del total, en porcentaje. Nunca por debajo de un centavo.';

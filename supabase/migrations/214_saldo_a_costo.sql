-- 214 — Saldo a costo: cuentas a las que el consumo se les pasa sin margen
--
-- Hoy Riverz no gana con el saldo. La mensualidad es el negocio y el saldo es
-- lo que cuesta atender: el comercio usa las llaves de Riverz —Anthropic,
-- Telnyx, Fish Audio— y lo que consume se le descuenta **a lo que costó**, sin
-- un centavo encima.
--
-- Eso no se modela poniendo las tarifas a la par del costo, por dos razones:
--
-- 1. El costo no es un número fijo. Una respuesta de 3.000 tokens y una de
--    39.000 cuestan diez veces distinto, y una tarifa por respuesta sólo puede
--    ser un promedio: cobra de más a las cortas y de menos a las largas. Justo
--    lo que no hay que hacer cuando se prometió pasar el costo tal cual.
-- 2. Es por cuenta, no global. Al primer cliente se le pasa a costo mientras se
--    descubre el precio; al que entre en seis meses, no. Con una tarifa sola no
--    se pueden tener las dos cosas.
--
-- Entonces: la fila decide. Con `cobrar_a_costo` prendido se descuenta lo que
-- ese consumo costó de verdad —lo que ya se venía guardando en
-- `wallet_movimientos.costo_centavos`, que existía para poder mirar el margen y
-- ahora además define el cobro— y las tarifas quedan de referencia.

ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS cobrar_a_costo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN wallet_accounts.cobrar_a_costo IS
  'El consumo se descuenta a lo que costó, sin margen. Para los primeros clientes, mientras el precio se descubre. Cuando el costo de un consumo no se puede saber, se cae a la tarifa: nada sale gratis por no haberlo medido.';

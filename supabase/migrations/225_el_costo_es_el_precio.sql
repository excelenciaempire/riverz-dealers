-- 225 — El costo ES el precio: pasar a costo deja de ser la excepción
--
-- La 214 dejó `cobrar_a_costo` en FALSE por defecto y lo pensó como un trato
-- para los primeros clientes: "al primer cliente se le pasa a costo mientras se
-- descubre el precio; al que entre en seis meses, no".
--
-- La decisión del dueño (2026-08-30) es la contraria y es la definitiva: **lo
-- que cobra Anthropic —o cualquier API conectada— es exactamente lo que se le
-- carga al comercio.** El saldo no es un producto con margen; es el traspaso de
-- lo que cuesta atender. El negocio es la mensualidad. Los costos de plataforma
-- y de servidores no se le pasan a nadie.
--
-- Lo que se midió y forzó la decisión: la tarifa de `ia_respuesta` es 2 ¢ y el
-- costo real medido en producción sobre 25 respuestas fue **6,05 ¢** (p90 8,48),
-- porque ese agente corre Opus 5. La tarifa es plana y no mira el modelo, así
-- que cada cuenta a tarifa de lista perdía ~4 ¢ por respuesta — y ese hueco lo
-- pagaba Riverz.
--
-- Las tarifas NO se borran. Siguen siendo el piso para cuando el costo de un
-- consumo no se puede medir: nada puede salir gratis por no haberlo medido. Y
-- el interruptor por cuenta queda, ahora al revés — apagarlo es la excepción,
-- para cobrarle de lista a alguien si algún día hace falta.

ALTER TABLE wallet_accounts
  ALTER COLUMN cobrar_a_costo SET DEFAULT TRUE;

-- Las cuentas que ya existen también: nadie quedó a tarifa de lista a
-- propósito, quedaron por el default viejo.
UPDATE wallet_accounts SET cobrar_a_costo = TRUE WHERE cobrar_a_costo = FALSE;

COMMENT ON COLUMN wallet_accounts.cobrar_a_costo IS
  'El consumo se descuenta a lo que costó, sin margen: lo que cobra el proveedor es lo que se le carga al comercio. Prendido por defecto desde la migración 225 — es el modelo, no una excepción. Cuando el costo de un consumo no se puede medir se cae a la tarifa, que queda de piso: nada sale gratis por no haberlo medido.';

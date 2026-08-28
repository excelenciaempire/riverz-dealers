-- 213 — Recarga automática: la tarjeta guardada y el reintento que se rinde
--
-- La billetera ya sabía cobrar y sabía recargarse, pero la recarga había que
-- pedirla a mano. Eso significa que un comercio se queda sin saldo un domingo a
-- la noche, la IA se calla, y se entera el lunes por un cliente que no le
-- contestaron. La recarga automática existe para que ese domingo no pase.
--
-- Tres decisiones que explican las columnas:
--
-- 1. **La tarjeta se guarda en Stripe, no acá.** Lo único que se guarda es el
--    id del método de pago. Guardar un número de tarjeta convertiría esta base
--    en un problema regulatorio que hoy no es.
--
-- 2. **Se rinde a los 3 fallos seguidos.** Una tarjeta vencida no se arregla
--    reintentando: se arregla cambiándola. Sin tope, la plataforma pasaría el
--    mes entero pegándole a un banco que ya dijo que no —y cada intento
--    fallido cuenta para la reputación de la cuenta de Stripe.
--
-- 3. **El último error se guarda en texto.** «No se pudo cobrar» no le sirve a
--    nadie: lo que hay que poder mostrar es *fondos insuficientes* o *tarjeta
--    vencida*, que son dos cosas que el comercio arregla distinto.

ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS auto_fallos INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_ultimo_error TEXT,
  ADD COLUMN IF NOT EXISTS auto_ultimo_intento TIMESTAMPTZ;

COMMENT ON COLUMN wallet_accounts.stripe_payment_method_id IS
  'Id del método de pago en Stripe. La tarjeta vive allá; acá sólo su nombre.';
COMMENT ON COLUMN wallet_accounts.auto_recarga_centavos IS
  'Cuánto se carga cada vez que el saldo toca el umbral. NULL = recarga automática apagada.';
COMMENT ON COLUMN wallet_accounts.auto_umbral_centavos IS
  'Debajo de esto se dispara la recarga. Se compara con el saldo, no con el gasto.';
COMMENT ON COLUMN wallet_accounts.auto_fallos IS
  'Fallos seguidos del cobro automático. A los 3 se deja de intentar: una tarjeta vencida no se arregla reintentando.';

-- Para que el cron no barra la tabla entera: sólo las que tienen la recarga
-- prendida y todavía no se rindieron.
CREATE INDEX IF NOT EXISTS wallet_accounts_auto_idx
  ON wallet_accounts (workspace_id)
  WHERE auto_recarga_centavos IS NOT NULL AND auto_fallos < 3;

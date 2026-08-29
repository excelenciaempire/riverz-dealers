-- 218 — Qué tarjeta quedó guardada
--
-- Se guardaba el id del método de pago y nada más, así que la pantalla sólo
-- podía decir "hay una tarjeta". Quien tiene tres en la billetera no sabe cuál
-- dejó, y ante la duda la cambia — o peor: no la cambia porque no sabe si hace
-- falta.
--
-- Con la marca y los últimos cuatro alcanza para reconocerla, y son los dos
-- únicos datos de una tarjeta que se pueden guardar sin entrar en territorio
-- regulatorio. El número sigue estando sólo en Stripe.
ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS tarjeta_marca TEXT,
  ADD COLUMN IF NOT EXISTS tarjeta_ultimos4 TEXT;

COMMENT ON COLUMN wallet_accounts.tarjeta_marca IS
  'visa, mastercard, amex… tal como lo devuelve Stripe. Para mostrar el logo.';
COMMENT ON COLUMN wallet_accounts.tarjeta_ultimos4 IS
  'Los últimos cuatro dígitos. Es lo único que hace falta para reconocerla.';

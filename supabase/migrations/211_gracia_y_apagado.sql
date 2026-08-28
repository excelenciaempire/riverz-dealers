-- 211 — 48 horas de gracia, y la IA apagada sin saldo
--
-- Dos reglas que hasta hoy no existían en ningún lado.
--
-- 1. **La suscripción que no se paga da 48 horas y después cierra la cuenta.**
--    `acceso()` ya sabía decir que una cuenta vencida no puede operar, pero
--    NADIE la llamaba: se calculaba para pintar un cartel en Ajustes y nada
--    más. Faltaba además desde cuándo está vencida, que es lo único con lo que
--    se puede contar una gracia. Sin esa marca, "48 horas" no se puede
--    calcular: el estado dice que debe, no desde cuándo.
--
-- 2. **Sin saldo no hay IA.** `bloquear_sin_saldo` nació en FALSE para que
--    estrenar la billetera no dejara mudo a nadie. Ya está estrenada: el valor
--    por defecto pasa a TRUE y se prende en las cuentas que existen. Las de
--    cortesía no se ven afectadas — la puerta las deja pasar siempre, porque a
--    ellas se les prometió que no pagan.
--
-- Lo que ninguna de las dos apaga: la bandeja. El comercio sigue leyendo y
-- contestando a mano. Cortarle el acceso a sus propias conversaciones sería
-- tomarle de rehén a sus clientes, que no deben nada.

ALTER TABLE workspace_subscriptions
  ADD COLUMN IF NOT EXISTS vencida_desde TIMESTAMPTZ;

COMMENT ON COLUMN workspace_subscriptions.vencida_desde IS
  'Cuándo Stripe dijo por primera vez que este cobro falló. Es el reloj de las 48 horas de gracia; se borra al volver a estar al día.';

-- Una cuenta que YA figuraba vencida cuando esto se aplicó no puede empezar con
-- el reloj en cero-para-siempre: se le pone la marca ahora y tiene sus 48 horas
-- desde acá. Es lo justo — nunca se le avisó antes.
UPDATE workspace_subscriptions
   SET vencida_desde = now()
 WHERE estado = 'vencida' AND vencida_desde IS NULL;

ALTER TABLE wallet_accounts
  ALTER COLUMN bloquear_sin_saldo SET DEFAULT TRUE;

UPDATE wallet_accounts SET bloquear_sin_saldo = TRUE WHERE bloquear_sin_saldo = FALSE;

-- 216 — Cuándo se le avisó del plan
--
-- La billetera ya tenía `wallet_accounts.avisado_en` para no repetir el aviso
-- de saldo. Al plan le faltaba el suyo: sin una marca propia, avisar "el cobro
-- no entró" cada cinco minutos —que es cada cuánto corre el cron— sería
-- enseñarle al comercio a silenciar el número por el que después le vamos a
-- avisar algo importante.
ALTER TABLE workspace_subscriptions
  ADD COLUMN IF NOT EXISTS aviso_plan_en TIMESTAMPTZ;

COMMENT ON COLUMN workspace_subscriptions.aviso_plan_en IS
  'Última vez que se le avisó por WhatsApp que el plan necesita atención. Un aviso por día como máximo.';

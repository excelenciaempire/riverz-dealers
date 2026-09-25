-- 274 — Cuentas BYOK: la IA corre con la clave de Anthropic del comercio
--
-- El comercio le paga su consumo a Anthropic directo; a Riverz, la mensualidad
-- que se pacta con cada cuenta. Por eso el plan no tiene precio de lista: se
-- escribe en la cuenta al configurarla. Sin su clave, la IA de una cuenta BYOK
-- no responde: la de Riverz nunca la cubre.
BEGIN;

ALTER TABLE public.workspace_subscriptions
  DROP CONSTRAINT IF EXISTS workspace_subscriptions_modelo_cobro_check;
ALTER TABLE public.workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_modelo_cobro_check
  CHECK (modelo_cobro IN ('oficial', 'saldo', 'byok'));

COMMENT ON COLUMN public.workspace_subscriptions.modelo_cobro IS
  'oficial = la mensualidad incluye el consumo; saldo = mensualidad y el consumo desde la billetera; byok = mensualidad y la IA con la clave del comercio.';

INSERT INTO public.billing_plans
  (slug, nombre, activo, precio_centavos, moneda, incluidas, excedente_centavos, orden)
VALUES
  ('byok', 'Clave propia de IA', true, 0, 'usd', 0, 0, 91)
ON CONFLICT (slug) DO NOTHING;

COMMIT;

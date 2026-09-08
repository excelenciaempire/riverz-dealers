-- Admin reporting for variable usage only. Provider subscriptions remain excluded.
BEGIN;

CREATE OR REPLACE VIEW public.wallet_margen_proveedores
WITH (security_invoker = true) AS
SELECT
  coalesce(nullif(detalle->>'proveedor', ''), 'desconocido') AS proveedor,
  count(*) AS movimientos,
  coalesce(sum(costo_centavos) FILTER (
    WHERE coalesce((detalle->>'exenta')::boolean, false) = false
  ), 0)::numeric(20,8) AS costo_centavos,
  coalesce(-sum(centavos) FILTER (
    WHERE coalesce((detalle->>'exenta')::boolean, false) = false
  ), 0)::bigint AS cobrado_centavos,
  max(creado_en) AS ultimo_movimiento
FROM public.wallet_movimientos
WHERE referencia_tipo IN ('provider_operation', 'provider_receipt')
GROUP BY coalesce(nullif(detalle->>'proveedor', ''), 'desconocido');

REVOKE ALL ON public.wallet_margen_proveedores FROM anon, authenticated;
GRANT SELECT ON public.wallet_margen_proveedores TO service_role;

COMMIT;

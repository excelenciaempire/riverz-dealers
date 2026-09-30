-- Distinguish a confirmed prepaid balance from an automatically billed plan.
BEGIN;
ALTER TABLE public.platform_provider_balances
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'prepaid'
    CHECK (billing_mode IN ('prepaid', 'postpaid'));

CREATE OR REPLACE FUNCTION public.admin_funding_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'wallets', COALESCE((
      SELECT jsonb_agg(to_jsonb(w)) FROM (
        SELECT upper(moneda) AS currency, count(*) AS accounts,
          sum(saldo_centavos) AS balance_cents,
          sum(reservado_centavos) AS reserved_cents,
          sum(greatest(0, saldo_centavos - reservado_centavos - resto_costo_centavos)) AS available_cents
        FROM wallet_accounts GROUP BY upper(moneda)
      ) w
    ), '[]'::jsonb),
    'usage', COALESCE((
      SELECT jsonb_agg(to_jsonb(u)) FROM (
        SELECT proveedor AS provider,
          sum(costo_centavos) / 100 AS usd_week
        FROM wallet_operaciones
        WHERE estado = 'liquidada' AND created_at >= now() - interval '7 days'
        GROUP BY proveedor
      ) u
    ), '[]'::jsonb),
    'manual', COALESCE((
      SELECT jsonb_agg(to_jsonb(m)) FROM (
        SELECT b.provider, b.balance_usd, b.key_digest, b.confirmed_at, b.billing_mode,
          COALESCE((SELECT sum(o.costo_centavos) / 100 FROM wallet_operaciones o
            WHERE o.proveedor = b.provider AND o.estado = 'liquidada'
              AND o.created_at >= b.confirmed_at), 0) AS spent_since_usd
        FROM platform_provider_balances b
      ) m
    ), '[]'::jsonb),
    'measured_at', now()
  );
$$;
REVOKE ALL ON FUNCTION public.admin_funding_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_funding_snapshot() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

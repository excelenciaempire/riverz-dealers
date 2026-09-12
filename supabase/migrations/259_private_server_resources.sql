-- These resources are accessed only through authenticated server routes.
-- Browser roles must not read plans across accounts or invoke financial/call mutations directly.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE resource text; fn record;
BEGIN
  FOREACH resource IN ARRAY ARRAY[
    'operator_plans', 'operator_plan_steps', 'operator_agent_usage', 'operator_runs',
    'billing_plans', 'workspace_subscriptions', 'billing_usage_daily', 'support_access'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', resource);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', resource);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', resource);
  END LOOP;

  FOR fn IN
    SELECT p.oid::regprocedure signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'wallet_mover', 'wallet_acumular', 'claim_voice_call_with_capacity',
      '_bcast_bump', 'recompute_broadcast_counts', 'get_waba_24h_sent_count'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

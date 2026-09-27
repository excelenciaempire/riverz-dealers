BEGIN;
ALTER TABLE public.platform_watch_state ADD COLUMN IF NOT EXISTS alert_history jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Seed already-announced incidents so this deployment never reannounces them.
UPDATE public.platform_watch_state s SET alert_history = coalesce((
  SELECT jsonb_object_agg(k, coalesce(s.notified_at, now()))
  FROM unnest(string_to_array(s.fingerprint, '|')) AS k WHERE k <> '' AND left(k,1) <> '~'
), '{}'::jsonb) WHERE alert_history = '{}'::jsonb;

ALTER TABLE public.automation_pending_executions ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.flow_pending_executions ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
-- run_at is the scheduled time, NOT when a worker actually claimed the job.
CREATE OR REPLACE FUNCTION public.stamp_pending_claim() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status = 'running' THEN
    IF TG_OP = 'INSERT' THEN NEW.claimed_at := clock_timestamp();
    ELSIF OLD.status IS DISTINCT FROM 'running' THEN NEW.claimed_at := clock_timestamp();
    END IF;
  ELSE NEW.claimed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stamp_pending_claim ON public.automation_pending_executions;
CREATE TRIGGER stamp_pending_claim BEFORE INSERT OR UPDATE OF status ON public.automation_pending_executions
FOR EACH ROW EXECUTE FUNCTION public.stamp_pending_claim();
DROP TRIGGER IF EXISTS stamp_pending_claim ON public.flow_pending_executions;
CREATE TRIGGER stamp_pending_claim BEFORE INSERT OR UPDATE OF status ON public.flow_pending_executions
FOR EACH ROW EXECUTE FUNCTION public.stamp_pending_claim();
UPDATE public.automation_pending_executions SET claimed_at=now() WHERE status='running' AND claimed_at IS NULL;
UPDATE public.flow_pending_executions SET claimed_at=now() WHERE status='running' AND claimed_at IS NULL;

-- Only the service role can merge provider state. Never replace a fresh token
-- expiry with the stale config snapshot held by an orders/messages poller.
CREATE OR REPLACE FUNCTION public.patch_ml_connection_state(
  p_id uuid, p_config jsonb DEFAULT '{}'::jsonb, p_secrets jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT NULL, p_clear_error boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE channel_connections SET config=coalesce(config,'{}'::jsonb)||p_config,
   secrets=coalesce(secrets,'{}'::jsonb)||p_secrets,
   status=coalesce(p_status,status), last_error=CASE WHEN p_clear_error THEN NULL ELSE last_error END
 WHERE id=p_id AND channel='mercadolibre';
 IF NOT FOUND THEN RAISE EXCEPTION 'Mercado Libre connection not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.patch_ml_connection_state(uuid,jsonb,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patch_ml_connection_state(uuid,jsonb,jsonb,text,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.settle_orphan_automation_logs(p_before timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 WITH candidates AS (
   SELECT l.id, (l.error_message IS NOT NULL
     OR coalesce(jsonb_array_length(l.steps_executed),0)=0
     OR l.steps_executed->-1->>'step_type'='wait'
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(l.steps_executed) s WHERE s->>'status'='failed')
     OR EXISTS(SELECT 1 FROM automation_pending_executions p WHERE p.log_id=l.id AND p.status='failed')) AS failed
   FROM automation_logs l WHERE l.status='partial' AND l.created_at<p_before
   AND NOT EXISTS(SELECT 1 FROM automation_pending_executions p WHERE p.log_id=l.id AND p.status IN ('pending','running'))
   ORDER BY l.created_at LIMIT 100 FOR UPDATE OF l SKIP LOCKED
 )
 UPDATE automation_logs l SET status=CASE WHEN c.failed THEN 'failed' ELSE 'success' END,
   error_message=CASE WHEN c.failed THEN coalesce(l.error_message,'Interrupted execution requires review; no message replayed') ELSE l.error_message END
 FROM candidates c WHERE l.id=c.id AND l.status='partial';
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.settle_orphan_automation_logs(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_orphan_automation_logs(timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

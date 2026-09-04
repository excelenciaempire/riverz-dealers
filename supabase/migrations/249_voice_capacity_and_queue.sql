-- Capacity-aware voice queue. Outbound calls claim a slot atomically; inbound
-- calls remain provider-driven but count against the same workspace total.

ALTER TABLE public.voice_calls
  ADD COLUMN IF NOT EXISTS dispatch_priority smallint NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS external_call_id text;

-- Existing workspaces start conservatively: three total slots, no inbound
-- reservation, and only one campaign call at once. The stored values make the
-- UI explicit while the right-hand config keeps any merchant choice intact.
UPDATE public.channel_connections
SET config = jsonb_build_object(
  'max_concurrent_calls', 3,
  'reserved_inbound_slots', 0,
  'max_campaign_concurrent', 1,
  'dedupe_minutes', 15
) || COALESCE(config, '{}'::jsonb)
WHERE channel = 'voice';

UPDATE public.voice_calls
SET dispatch_priority = CASE
  WHEN direction = 'inbound' THEN 500
  WHEN call_type = 'manual' THEN 400
  WHEN automation_id IS NOT NULL OR call_type = 'order_confirmation' THEN 300
  WHEN context ? 'campaign_id' THEN 100
  ELSE 250
END
WHERE dispatch_priority = 200;

CREATE INDEX IF NOT EXISTS voice_calls_dispatch_queue_idx
  ON public.voice_calls (dispatch_priority DESC, scheduled_at ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS voice_calls_active_workspace_idx
  ON public.voice_calls (workspace_id, direction, started_at)
  WHERE status IN ('dialing', 'in_progress') AND ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS voice_calls_active_dedupe_idx
  ON public.voice_calls (workspace_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status IN ('queued', 'dialing', 'in_progress')
    AND ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS voice_calls_external_call_id_idx
  ON public.voice_calls (external_call_id)
  WHERE external_call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_voice_call_with_capacity(
  p_call_id uuid,
  p_room_name text,
  p_global_limit integer DEFAULT 10
)
RETURNS TABLE (claimed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call public.voice_calls%ROWTYPE;
  v_config jsonb := '{}'::jsonb;
  v_max integer := 3;
  v_reserved integer := 0;
  v_campaign_max integer := 1;
  v_global_active integer := 0;
  v_workspace_active integer := 0;
  v_outbound_active integer := 0;
  v_campaign_active integer := 0;
  v_is_campaign boolean := false;
BEGIN
  -- Every cron runner uses the same lock while it counts + claims. This keeps
  -- the capacity check atomic without holding locks during the phone call.
  PERFORM pg_advisory_xact_lock(hashtext('riverz_voice_capacity'));

  SELECT * INTO v_call
  FROM public.voice_calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND OR v_call.status <> 'queued' OR v_call.scheduled_at > now() THEN
    RETURN QUERY SELECT false, 'not_queued'::text;
    RETURN;
  END IF;

  SELECT COALESCE(config, '{}'::jsonb) INTO v_config
  FROM public.channel_connections
  WHERE workspace_id = v_call.workspace_id AND channel = 'voice'
  LIMIT 1;

  IF COALESCE(v_config->>'max_concurrent_calls', '') ~ '^\d+$' THEN
    v_max := LEAST(50, GREATEST(1, (v_config->>'max_concurrent_calls')::integer));
  END IF;
  IF COALESCE(v_config->>'reserved_inbound_slots', '') ~ '^\d+$' THEN
    v_reserved := LEAST(v_max - 1, GREATEST(0, (v_config->>'reserved_inbound_slots')::integer));
  END IF;
  IF COALESCE(v_config->>'max_campaign_concurrent', '') ~ '^\d+$' THEN
    v_campaign_max := LEAST(v_max, GREATEST(1, (v_config->>'max_campaign_concurrent')::integer));
  END IF;

  SELECT count(*) INTO v_global_active
  FROM public.voice_calls
  WHERE status IN ('dialing', 'in_progress') AND ended_at IS NULL;
  IF v_global_active >= LEAST(250, GREATEST(1, COALESCE(p_global_limit, 10))) THEN
    RETURN QUERY SELECT false, 'global_capacity'::text;
    RETURN;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE direction = 'outbound'),
    count(*) FILTER (WHERE direction = 'outbound' AND context ? 'campaign_id')
  INTO v_workspace_active, v_outbound_active, v_campaign_active
  FROM public.voice_calls
  WHERE workspace_id = v_call.workspace_id
    AND status IN ('dialing', 'in_progress')
    AND ended_at IS NULL;

  IF v_workspace_active >= v_max THEN
    RETURN QUERY SELECT false, 'workspace_capacity'::text;
    RETURN;
  END IF;
  IF v_call.direction = 'outbound' AND v_outbound_active >= (v_max - v_reserved) THEN
    RETURN QUERY SELECT false, 'inbound_reserved'::text;
    RETURN;
  END IF;

  v_is_campaign := v_call.context ? 'campaign_id';
  IF v_is_campaign AND v_campaign_active >= v_campaign_max THEN
    RETURN QUERY SELECT false, 'campaign_capacity'::text;
    RETURN;
  END IF;

  UPDATE public.voice_calls
  SET status = 'dialing',
      started_at = now(),
      room_name = p_room_name,
      updated_at = now()
  WHERE id = v_call.id AND status = 'queued';

  RETURN QUERY SELECT FOUND, CASE WHEN FOUND THEN NULL::text ELSE 'lost_race'::text END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_voice_call_with_capacity(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_voice_call_with_capacity(uuid, text, integer) TO service_role;

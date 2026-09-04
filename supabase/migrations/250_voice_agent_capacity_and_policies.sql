-- Operational voice settings belong to the voice profile that performs the
-- call. The account/provider still has a hard global ceiling, but merchants
-- configure the behavior they understand on each agent.

ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS voice_max_concurrent_calls integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS voice_reserved_inbound_slots integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_max_campaign_concurrent integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS voice_dedupe_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS voice_monthly_minutes_limit integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_recording_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS voice_recording_disclosure boolean NOT NULL DEFAULT false;

-- Preserve every existing workspace policy on its existing voice agents.
UPDATE public.ai_agents AS agent
SET
  voice_max_concurrent_calls = CASE
    WHEN COALESCE(connection.config->>'max_concurrent_calls', '') ~ '^\d+$'
      THEN LEAST(20, GREATEST(1, (connection.config->>'max_concurrent_calls')::integer))
    ELSE 3
  END,
  voice_reserved_inbound_slots = CASE
    WHEN COALESCE(connection.config->>'reserved_inbound_slots', '') ~ '^\d+$'
      THEN LEAST(19, GREATEST(0, (connection.config->>'reserved_inbound_slots')::integer))
    ELSE 0
  END,
  voice_max_campaign_concurrent = CASE
    WHEN COALESCE(connection.config->>'max_campaign_concurrent', '') ~ '^\d+$'
      THEN LEAST(20, GREATEST(1, (connection.config->>'max_campaign_concurrent')::integer))
    ELSE 1
  END,
  voice_dedupe_minutes = CASE
    WHEN COALESCE(connection.config->>'dedupe_minutes', '') ~ '^\d+$'
      THEN LEAST(1440, GREATEST(0, (connection.config->>'dedupe_minutes')::integer))
    ELSE 15
  END,
  voice_monthly_minutes_limit = CASE
    WHEN COALESCE(connection.config->>'monthly_minutes_limit', '') ~ '^\d+$'
      THEN GREATEST(0, (connection.config->>'monthly_minutes_limit')::integer)
    ELSE 0
  END,
  voice_recording_enabled = COALESCE((connection.config->>'recording_enabled')::boolean, true),
  voice_recording_disclosure = COALESCE((connection.config->>'recording_disclosure')::boolean, false)
FROM public.channel_connections AS connection
WHERE connection.workspace_id = agent.workspace_id
  AND connection.channel = 'voice'
  AND agent.voice_enabled = true;

-- Older workspace values were independently configurable. Normalize them
-- against the new per-agent maximum before adding the relational checks.
UPDATE public.ai_agents
SET
  voice_reserved_inbound_slots = LEAST(
    voice_reserved_inbound_slots,
    voice_max_concurrent_calls - 1
  ),
  voice_max_campaign_concurrent = LEAST(
    voice_max_campaign_concurrent,
    voice_max_concurrent_calls
  ),
  voice_monthly_minutes_limit = COALESCE(voice_monthly_minutes_limit, 0);

ALTER TABLE public.ai_agents
  ALTER COLUMN voice_monthly_minutes_limit SET DEFAULT 0,
  ALTER COLUMN voice_monthly_minutes_limit SET NOT NULL;

ALTER TABLE public.ai_agents DROP CONSTRAINT IF EXISTS ai_agents_voice_max_concurrent_check;
ALTER TABLE public.ai_agents ADD CONSTRAINT ai_agents_voice_max_concurrent_check
  CHECK (voice_max_concurrent_calls BETWEEN 1 AND 20);
ALTER TABLE public.ai_agents DROP CONSTRAINT IF EXISTS ai_agents_voice_reserved_inbound_check;
ALTER TABLE public.ai_agents ADD CONSTRAINT ai_agents_voice_reserved_inbound_check
  CHECK (voice_reserved_inbound_slots >= 0 AND voice_reserved_inbound_slots < voice_max_concurrent_calls);
ALTER TABLE public.ai_agents DROP CONSTRAINT IF EXISTS ai_agents_voice_campaign_concurrent_check;
ALTER TABLE public.ai_agents ADD CONSTRAINT ai_agents_voice_campaign_concurrent_check
  CHECK (voice_max_campaign_concurrent BETWEEN 1 AND voice_max_concurrent_calls);
ALTER TABLE public.ai_agents DROP CONSTRAINT IF EXISTS ai_agents_voice_dedupe_minutes_check;
ALTER TABLE public.ai_agents ADD CONSTRAINT ai_agents_voice_dedupe_minutes_check
  CHECK (voice_dedupe_minutes BETWEEN 0 AND 1440);
ALTER TABLE public.ai_agents DROP CONSTRAINT IF EXISTS ai_agents_voice_monthly_minutes_check;
ALTER TABLE public.ai_agents ADD CONSTRAINT ai_agents_voice_monthly_minutes_check
  CHECK (voice_monthly_minutes_limit >= 0);

GRANT SELECT, INSERT, UPDATE (
  voice_max_concurrent_calls,
  voice_reserved_inbound_slots,
  voice_max_campaign_concurrent,
  voice_dedupe_minutes,
  voice_monthly_minutes_limit,
  voice_recording_enabled,
  voice_recording_disclosure
) ON public.ai_agents TO authenticated;

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
  v_agent_max integer := 3;
  v_agent_reserved integer := 0;
  v_campaign_max integer := 1;
  v_global_active integer := 0;
  v_agent_active integer := 0;
  v_agent_outbound integer := 0;
  v_campaign_active integer := 0;
  v_is_campaign boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('riverz_voice_capacity'));

  SELECT * INTO v_call
  FROM public.voice_calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND OR v_call.status <> 'queued' OR v_call.scheduled_at > now() THEN
    RETURN QUERY SELECT false, 'not_queued'::text;
    RETURN;
  END IF;

  SELECT
    voice_max_concurrent_calls,
    voice_reserved_inbound_slots,
    voice_max_campaign_concurrent
  INTO v_agent_max, v_agent_reserved, v_campaign_max
  FROM public.ai_agents
  WHERE id = v_call.agent_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'agent_missing'::text;
    RETURN;
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
  INTO v_agent_active, v_agent_outbound, v_campaign_active
  FROM public.voice_calls
  WHERE agent_id = v_call.agent_id
    AND status IN ('dialing', 'in_progress')
    AND ended_at IS NULL;

  IF v_agent_active >= v_agent_max THEN
    RETURN QUERY SELECT false, 'agent_capacity'::text;
    RETURN;
  END IF;
  IF v_call.direction = 'outbound' AND v_agent_outbound >= (v_agent_max - v_agent_reserved) THEN
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

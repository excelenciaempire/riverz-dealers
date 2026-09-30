-- New tag additions and scheduled slots are durable. No historical tag backfill.
CREATE TABLE IF NOT EXISTS public.automation_event_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('tag_added', 'time_based')),
  event_key text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'skipped', 'failed', 'uncertain')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  UNIQUE (automation_id, contact_id, event_key)
);
CREATE INDEX IF NOT EXISTS automation_event_jobs_queue ON public.automation_event_jobs(created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS automation_event_jobs_history ON public.automation_event_jobs(workspace_id, automation_id, created_at DESC);
ALTER TABLE public.automation_event_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_event_jobs FROM anon, authenticated;
GRANT ALL ON public.automation_event_jobs TO service_role;

CREATE TABLE IF NOT EXISTS public.automation_schedule_slots (
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  slot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, slot)
);
ALTER TABLE public.automation_schedule_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_schedule_slots FROM anon, authenticated;
GRANT ALL ON public.automation_schedule_slots TO service_role;

CREATE OR REPLACE FUNCTION public.queue_tag_automation_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ws uuid; chain jsonb;
BEGIN
  SELECT c.workspace_id INTO ws FROM public.contacts c JOIN public.tags t
    ON t.id = NEW.tag_id AND t.workspace_id = c.workspace_id WHERE c.id = NEW.contact_id;
  IF ws IS NULL THEN RAISE EXCEPTION 'Contact and tag must belong to the same workspace'; END IF;
  chain := COALESCE(NULLIF(current_setting('riverz.automation_chain', true), ''), '[]')::jsonb;
  IF jsonb_typeof(chain) <> 'array' OR jsonb_array_length(chain) >= 8 THEN RETURN NEW; END IF;
  INSERT INTO public.automation_event_jobs(workspace_id, automation_id, contact_id, event_type, event_key, context)
    SELECT ws, a.id, NEW.contact_id, 'tag_added', 'tag:' || NEW.id,
      jsonb_build_object('tag_id', NEW.tag_id, 'automation_chain', chain)
    FROM public.automations a WHERE a.workspace_id = ws AND a.is_active AND a.deleted_at IS NULL
      AND a.trigger_type = 'tag_added' AND a.trigger_config->>'tag_id' = NEW.tag_id::text
      AND NOT chain ? a.id::text
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contact_tag_automation_event ON public.contact_tags;
CREATE TRIGGER contact_tag_automation_event AFTER INSERT ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.queue_tag_automation_event();
REVOKE ALL ON FUNCTION public.queue_tag_automation_event() FROM PUBLIC, anon, authenticated;

-- Only the trusted worker can propagate a chain. A no-op upsert emits no event.
CREATE OR REPLACE FUNCTION public.automation_attach_tag(p_workspace_id uuid, p_contact_id uuid, p_tag_id uuid, p_chain jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact_id AND workspace_id = p_workspace_id)
    OR NOT EXISTS (SELECT 1 FROM public.tags WHERE id = p_tag_id AND workspace_id = p_workspace_id)
    OR jsonb_typeof(p_chain) IS DISTINCT FROM 'array' OR jsonb_array_length(p_chain) > 8
  THEN RAISE EXCEPTION 'Invalid tag context'; END IF;
  PERFORM set_config('riverz.automation_chain', p_chain::text, true);
  INSERT INTO public.contact_tags(contact_id, tag_id) VALUES (p_contact_id, p_tag_id)
    ON CONFLICT (contact_id, tag_id) DO NOTHING;
  PERFORM set_config('riverz.automation_chain', '', true);
END $$;
REVOKE ALL ON FUNCTION public.automation_attach_tag(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_attach_tag(uuid, uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_automation_schedule(p_automation_id uuid, p_slot text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ws uuid; count_rows integer;
BEGIN
  SELECT workspace_id INTO ws FROM public.automations WHERE id = p_automation_id
    AND is_active AND deleted_at IS NULL AND trigger_type = 'time_based';
  IF ws IS NULL OR length(p_slot) NOT BETWEEN 1 AND 150 THEN RETURN 0; END IF;
  INSERT INTO public.automation_schedule_slots(automation_id, slot) VALUES (p_automation_id, p_slot) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 0; END IF;
  INSERT INTO public.automation_event_jobs(workspace_id, automation_id, contact_id, event_type, event_key, context, expires_at)
    SELECT ws, p_automation_id, c.id, 'time_based', 'schedule:' || p_slot,
      jsonb_build_object('vars', jsonb_build_object('scheduled_slot', p_slot)), now() + interval '6 hours'
    FROM public.contacts c WHERE c.workspace_id = ws ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS count_rows = ROW_COUNT;
  RETURN count_rows;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_automation_schedule(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_automation_schedule(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_automation_events(p_limit integer DEFAULT 40)
RETURNS SETOF public.automation_event_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- An interrupted send has an unknown outcome. Never replay it automatically.
  UPDATE public.automation_event_jobs SET status = 'uncertain', reason = 'worker_interrupted', finished_at = now()
    WHERE status = 'running' AND claimed_at < now() - interval '15 minutes';
  UPDATE public.automation_event_jobs SET status = 'skipped', reason = 'event_expired', finished_at = now()
    WHERE status = 'queued' AND expires_at <= now();
  RETURN QUERY UPDATE public.automation_event_jobs j SET status = 'running', claimed_at = now()
    WHERE j.id IN (SELECT id FROM public.automation_event_jobs WHERE status = 'queued' AND expires_at > now()
      ORDER BY created_at LIMIT LEAST(GREATEST(p_limit, 1), 100) FOR UPDATE SKIP LOCKED) RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_automation_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_events(integer) TO service_role;
-- Contextual access includes old approval payloads which only stored an order ID.
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS approval_requests_contact_pending ON public.approval_requests(workspace_id, contact_id, created_at DESC) WHERE status = 'pendiente';
CREATE OR REPLACE FUNCTION public.approval_contact_context() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.contact_id := NULL;
  SELECT id INTO NEW.contact_id FROM public.contacts
    WHERE workspace_id = NEW.workspace_id AND id::text = NEW.payload->>'contact_id';
  IF NEW.contact_id IS NULL THEN
    SELECT contact_id INTO NEW.contact_id FROM public.orders
      WHERE workspace_id = NEW.workspace_id AND id::text = NEW.payload->>'order_id';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS approval_contact_context ON public.approval_requests;
CREATE TRIGGER approval_contact_context BEFORE INSERT OR UPDATE OF payload, workspace_id ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.approval_contact_context();
REVOKE ALL ON FUNCTION public.approval_contact_context() FROM PUBLIC, anon, authenticated;
UPDATE public.approval_requests a SET contact_id = c.id FROM public.contacts c
  WHERE a.contact_id IS NULL AND c.workspace_id = a.workspace_id AND c.id::text = a.payload->>'contact_id';
UPDATE public.approval_requests a SET contact_id = o.contact_id FROM public.orders o
  WHERE a.contact_id IS NULL AND o.workspace_id = a.workspace_id AND o.id::text = a.payload->>'order_id';
NOTIFY pgrst, 'reload schema';

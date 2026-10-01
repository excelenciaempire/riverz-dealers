-- Case observations and changes, not proof of a refund or provider operation.
-- AFTER triggers see the stored row and append in the same transaction:
-- https://www.postgresql.org/docs/current/sql-createtrigger.html
CREATE TABLE IF NOT EXISTS public.return_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('baseline','opened','state_changed','evidence_changed','updated')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  previous_snapshot jsonb CHECK (previous_snapshot IS NULL OR jsonb_typeof(previous_snapshot) = 'object')
);
CREATE INDEX IF NOT EXISTS return_case_events_case ON public.return_case_events(workspace_id,case_id,event_sequence DESC);
ALTER TABLE public.return_case_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS return_case_events_read ON public.return_case_events;
CREATE POLICY return_case_events_read ON public.return_case_events FOR SELECT
  USING (public.is_workspace_member(workspace_id));
REVOKE ALL ON public.return_case_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.return_case_events_event_sequence_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.return_case_events TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.record_return_case_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_snapshot jsonb; prior_snapshot jsonb; event_kind text; actor uuid;
BEGIN
  current_snapshot := jsonb_build_object('status',NEW.status,'resolution',NEW.resolution,
    'kind',NEW.kind,'reason',NEW.reason,'customer_note',NEW.customer_note,'photos',NEW.photos,
    'order_number',NEW.order_number,'platform',NEW.platform,
    'decided_by',NEW.decided_by,'decided_at',NEW.decided_at);
  IF TG_OP = 'INSERT' THEN event_kind := 'opened';
  ELSE
    IF OLD.workspace_id = NEW.workspace_id THEN
      prior_snapshot := jsonb_build_object('status',OLD.status,'resolution',OLD.resolution,
        'kind',OLD.kind,'reason',OLD.reason,'customer_note',OLD.customer_note,'photos',OLD.photos,
        'order_number',OLD.order_number,'platform',OLD.platform,
        'decided_by',OLD.decided_by,'decided_at',OLD.decided_at);
    END IF;
    IF current_snapshot IS NOT DISTINCT FROM prior_snapshot THEN RETURN NEW; END IF;
    event_kind := CASE WHEN prior_snapshot IS NULL THEN 'baseline'
      WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'state_changed'
      WHEN OLD.photos IS DISTINCT FROM NEW.photos THEN 'evidence_changed' ELSE 'updated' END;
  END IF;
  -- A signed DB actor takes precedence over editable attribution columns.
  actor := auth.uid();
  IF actor IS NULL AND TG_OP = 'UPDATE' AND OLD.workspace_id = NEW.workspace_id
    AND (NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decided_by IS DISTINCT FROM OLD.decided_by)
    AND EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=NEW.workspace_id AND user_id=NEW.decided_by)
  THEN actor := NEW.decided_by; END IF;
  IF actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=NEW.workspace_id AND user_id=actor)
  THEN actor := NULL; END IF;
  INSERT INTO public.return_case_events(workspace_id,case_id,event_type,actor_id,snapshot,previous_snapshot)
    VALUES(NEW.workspace_id,NEW.id,event_kind,actor,current_snapshot,prior_snapshot);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_return_case_event() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS returns_case_history ON public.returns;
CREATE TRIGGER returns_case_history AFTER INSERT OR UPDATE ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public.record_return_case_event();

-- Existing cases start with an observation now; never invent earlier decisions.
INSERT INTO public.return_case_events(workspace_id,case_id,event_type,snapshot)
SELECT r.workspace_id,r.id,'baseline',jsonb_build_object('status',r.status,'resolution',r.resolution,
  'kind',r.kind,'reason',r.reason,'customer_note',r.customer_note,'photos',r.photos,
  'order_number',r.order_number,'platform',r.platform,'decided_by',r.decided_by,'decided_at',r.decided_at)
FROM public.returns r WHERE NOT EXISTS (
  SELECT 1 FROM public.return_case_events e WHERE e.workspace_id=r.workspace_id AND e.case_id=r.id
);
NOTIFY pgrst,'reload schema';

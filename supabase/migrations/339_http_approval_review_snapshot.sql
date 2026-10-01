-- HTTP review text and execution parameters are one immutable proposal.
-- Existing non-HTTP approvals retain their current update/dedupe behavior.
CREATE FUNCTION public.freeze_http_approval_review() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE old_http boolean=false;new_http boolean;
BEGIN
 new_http=coalesce(left(NEW.payload->>'tool',12)='http_action_' OR left(NEW.payload->>'tool',17)='http_flow_action_',false);
 IF TG_OP='UPDATE' THEN
  old_http=coalesce(left(OLD.payload->>'tool',12)='http_action_' OR left(OLD.payload->>'tool',17)='http_flow_action_',false);
 END IF;
 IF NOT old_http AND NOT new_http THEN RETURN NEW;END IF;
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'http_approval_service_required';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.kind IS DISTINCT FROM 'herramienta' OR jsonb_typeof(NEW.payload->'dedupe_key') IS DISTINCT FROM 'string'
   OR length(NEW.payload->>'dedupe_key') NOT BETWEEN 1 AND 100 OR NEW.status IS DISTINCT FROM 'pendiente'
   OR NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_via IS NOT NULL
  THEN RAISE EXCEPTION 'invalid_http_approval_proposal';END IF;
  RETURN NEW;
 END IF;
 IF NOT old_http OR NOT new_http OR
  ROW(NEW.id,NEW.workspace_id,NEW.kind,NEW.title,NEW.body,NEW.payload,NEW.contact_id,NEW.expires_at,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.kind,OLD.title,OLD.body,OLD.payload,OLD.contact_id,OLD.expires_at,OLD.created_at)
 THEN RAISE EXCEPTION 'http_approval_snapshot_changed';END IF;
 IF OLD.status IS DISTINCT FROM 'pendiente' THEN
  IF ROW(NEW.decided_at,NEW.decided_by,NEW.decided_via) IS DISTINCT FROM ROW(OLD.decided_at,OLD.decided_by,OLD.decided_via)
   OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='aprobada' AND NEW.status='fallida'))
  THEN RAISE EXCEPTION 'http_approval_already_decided';END IF;
 ELSIF NEW.status IN ('aprobada','rechazada') THEN
  IF NEW.decided_by IS NULL OR NEW.decided_via IS DISTINCT FROM 'panel' OR NEW.decided_at IS NULL
   OR NEW.expires_at IS NULL OR NEW.decided_at>=NEW.expires_at OR NEW.decided_at>clock_timestamp()
  THEN RAISE EXCEPTION 'invalid_http_approval_decision';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.freeze_http_approval_review() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_http_approval_review() TO service_role;
CREATE TRIGGER http_approval_review_snapshot BEFORE INSERT OR UPDATE ON public.approval_requests
 FOR EACH ROW EXECUTE FUNCTION public.freeze_http_approval_review();

-- A retry of the same protected proposal cannot create another approval after a decision.
-- Fail the migration rather than rewrite any conflicting historical evidence.
CREATE UNIQUE INDEX http_approval_proposal_dedupe_idx
 ON public.approval_requests(workspace_id,kind,(payload->>'dedupe_key'))
 WHERE payload ? 'dedupe_key' AND
 (left(payload->>'tool',12)='http_action_' OR left(payload->>'tool',17)='http_flow_action_');

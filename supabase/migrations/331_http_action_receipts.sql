CREATE TABLE IF NOT EXISTS public.http_action_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 action_id uuid NOT NULL REFERENCES public.http_actions(id) ON DELETE CASCADE,
 action_revision integer NOT NULL CHECK(action_revision>0),
 actor_id uuid NOT NULL,
 conversation_id uuid,
 invocation_key text NOT NULL CHECK(invocation_key ~ '^[0-9a-f]{64}$'),
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 lease_id uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'claimed' CHECK(state IN ('claimed','acknowledged','blocked','uncertain')),
 status_code integer CHECK(status_code BETWEEN 100 AND 599),
 error_code text,
 result jsonb CHECK(result IS NULL OR (jsonb_typeof(result)='object' AND octet_length(result::text)<=65536)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 UNIQUE(workspace_id,action_id,invocation_key)
);
CREATE INDEX IF NOT EXISTS http_action_runs_uncertain_idx ON public.http_action_runs(workspace_id,action_id,input_hash)
 WHERE state IN ('claimed','uncertain');
ALTER TABLE public.http_action_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.http_action_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.http_action_runs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_http_action(
 p_workspace_id uuid,p_actor_id uuid,p_action_id uuid,p_revision integer,p_invocation_key text,p_input_hash text,
 p_confirmed boolean DEFAULT false,p_conversation_id uuid DEFAULT NULL,p_context jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.http_actions;r public.http_action_runs;c public.conversations;customer record;owner_id uuid;member_role text;sections jsonb;administrator boolean;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_action_id IS NULL OR p_revision IS NULL OR p_revision<1
 OR p_invocation_key IS NULL OR p_invocation_key !~ '^[0-9a-f]{64}$' OR p_input_hash IS NULL OR p_input_hash !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 SELECT w.owner_id INTO owner_id FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 administrator=owner_id IS NOT DISTINCT FROM p_actor_id;
 IF NOT administrator THEN
  SELECT m.role,to_jsonb(m.allowed_sections) INTO member_role,sections FROM public.workspace_members m WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id FOR SHARE;
  IF NOT FOUND OR member_role IS NULL OR member_role NOT IN ('admin','agent') OR (sections IS NOT NULL AND (jsonb_typeof(sections)<>'array' OR NOT (sections ? '/automatizaciones')))
  THEN RAISE EXCEPTION 'http_execution_forbidden';END IF;
  administrator=member_role='admin';
 END IF;
 SELECT * INTO a FROM public.http_actions WHERE id=p_action_id AND workspace_id=p_workspace_id AND state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 IF a.revision<>p_revision THEN RAISE EXCEPTION 'http_action_changed';END IF;
 IF a.definition->>'method'='POST' THEN
  IF NOT administrator OR NOT COALESCE(p_confirmed,false) THEN RAISE EXCEPTION 'http_execution_confirmation_required';END IF;
  IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 END IF;
 IF p_conversation_id IS NOT NULL THEN
  IF sections IS NOT NULL AND NOT (sections ? '/bandeja') THEN RAISE EXCEPTION 'http_execution_forbidden';END IF;
  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
  SELECT id,phone,email INTO customer FROM public.contacts WHERE id=c.contact_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND OR p_context IS DISTINCT FROM jsonb_build_object('contact_id',customer.id::text,'conversation_id',c.id::text,'phone',customer.phone,'email',customer.email)
  THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
  IF c.channel::text IN ('gmail','outlook','zoho') THEN
   PERFORM 1 FROM public.channel_connections WHERE id=c.connection_id AND workspace_id=p_workspace_id AND created_by=p_actor_id AND channel::text=c.channel::text FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
  END IF;
 ELSE
  IF p_context IS NOT NULL THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 END IF;
 -- The payload lock also blocks a new confirmation key from bypassing an uncertain POST.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('http-run:'||p_workspace_id::text||':'||p_action_id::text||':'||p_input_hash,0));
 SELECT * INTO r FROM public.http_action_runs WHERE workspace_id=p_workspace_id AND action_id=p_action_id AND invocation_key=p_invocation_key FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>p_actor_id OR r.action_revision<>p_revision OR r.input_hash<>p_input_hash OR r.conversation_id IS DISTINCT FROM p_conversation_id THEN RAISE EXCEPTION 'http_execution_conflict';END IF;
  RETURN jsonb_build_object('claimed',false,'id',r.id,'state',r.state,'status_code',r.status_code,'error_code',r.error_code,'result',r.result);
 END IF;
 IF a.definition->>'method'='POST' AND EXISTS(SELECT 1 FROM public.http_action_runs WHERE workspace_id=p_workspace_id AND action_id=p_action_id AND input_hash=p_input_hash AND state IN ('claimed','uncertain'))
 THEN RAISE EXCEPTION 'http_execution_review_required';END IF;
 INSERT INTO public.http_action_runs(workspace_id,action_id,action_revision,actor_id,conversation_id,invocation_key,input_hash)
 VALUES(p_workspace_id,p_action_id,p_revision,p_actor_id,p_conversation_id,p_invocation_key,p_input_hash) RETURNING * INTO r;
 RETURN jsonb_build_object('claimed',true,'id',r.id,'state',r.state,'lease_id',r.lease_id);
END $$;
REVOKE ALL ON FUNCTION public.claim_http_action(uuid,uuid,uuid,integer,text,text,boolean,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_http_action(uuid,uuid,uuid,integer,text,text,boolean,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_http_action(
 p_workspace_id uuid,p_run_id uuid,p_lease_id uuid,p_state text,p_status_code integer DEFAULT NULL,p_error_code text DEFAULT NULL,p_result jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.http_action_runs;
BEGIN
 IF p_workspace_id IS NULL OR p_run_id IS NULL OR p_lease_id IS NULL OR p_state IS NULL OR p_state NOT IN ('acknowledged','blocked','uncertain')
 OR (p_status_code IS NOT NULL AND p_status_code NOT BETWEEN 100 AND 599)
 OR (p_state='acknowledged' AND (p_status_code IS NULL OR p_status_code NOT BETWEEN 200 AND 299 OR p_error_code IS NOT NULL OR p_result IS NULL OR jsonb_typeof(p_result)<>'object'))
 OR (p_state<>'acknowledged' AND p_result IS NOT NULL)
 OR (p_state<>'acknowledged' AND p_error_code IS NULL)
 OR (p_state='blocked' AND p_status_code IS NOT NULL)
 OR (p_result IS NOT NULL AND octet_length(p_result::text)>65536)
 OR (p_error_code IS NOT NULL AND p_error_code NOT IN ('http_destination_forbidden','http_input_invalid','http_timeout','http_transport_failed','http_response_invalid','http_response_too_large','http_status_failed','http_output_invalid','http_action_credential_unavailable','http_execution_unavailable'))
 THEN RAISE EXCEPTION 'invalid_http_execution_receipt';END IF;
 UPDATE public.http_action_runs SET state=p_state,status_code=p_status_code,error_code=p_error_code,result=p_result,finished_at=clock_timestamp()
 WHERE id=p_run_id AND workspace_id=p_workspace_id AND lease_id=p_lease_id AND state='claimed' RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_execution_conflict';END IF;
 RETURN jsonb_build_object('id',r.id,'state',r.state,'status_code',r.status_code,'error_code',r.error_code,'result',r.result);
END $$;
REVOKE ALL ON FUNCTION public.finish_http_action(uuid,uuid,uuid,text,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_http_action(uuid,uuid,uuid,text,integer,text,jsonb) TO service_role;

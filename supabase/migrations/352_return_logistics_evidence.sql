-- Manual guide and receiving attestations. No carrier API, label purchase or refund.
CREATE TABLE public.return_logistics_events (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES public.returns(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 kind text NOT NULL CHECK(kind IN ('guide','receipt')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX return_logistics_case_page ON public.return_logistics_events(workspace_id,case_id,event_sequence DESC);
ALTER TABLE public.return_logistics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.return_logistics_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.return_logistics_events_event_sequence_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_return_logistics(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid,p_cursor_sequence bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE events jsonb;next_cursor text;r public.returns;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL OR (p_cursor_sequence IS NOT NULL AND (p_cursor_sequence<1 OR p_cursor_sequence>9007199254740991)) THEN RAISE EXCEPTION 'invalid_return_logistics';END IF;
 IF NOT public.return_case_actor_access(p_workspace_id,p_actor_id,p_case_id) THEN RAISE EXCEPTION 'return_not_found';END IF;
 SELECT * INTO r FROM public.returns WHERE id=p_case_id AND workspace_id=p_workspace_id;
 WITH page AS(SELECT *,row_number() OVER(ORDER BY event_sequence DESC) AS n FROM public.return_logistics_events
  WHERE workspace_id=p_workspace_id AND case_id=p_case_id AND (p_cursor_sequence IS NULL OR event_sequence<p_cursor_sequence) ORDER BY event_sequence DESC LIMIT 21)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'event_sequence',event_sequence,'kind',kind,'actor_id',actor_id,'payload',payload,'recorded_at',recorded_at) ORDER BY event_sequence DESC) FILTER(WHERE n<=20),'[]'::jsonb),
 CASE WHEN count(*)>20 THEN jsonb_build_object('event_sequence',min(event_sequence) FILTER(WHERE n<=20))::text ELSE NULL END INTO events,next_cursor FROM page;
 RETURN jsonb_build_object('case_id',r.id,'status',r.status,'updated_at',r.updated_at,'platform',r.platform,'events',events,'next_cursor',next_cursor);
END $$;

CREATE FUNCTION public.record_return_logistics(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid,p_id uuid,p_kind text,p_payload jsonb,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.returns;prior public.return_logistics_events;receipt_time timestamptz;event public.return_logistics_events;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL OR p_id IS NULL OR p_expected_updated_at IS NULL
 OR p_kind IS NULL OR p_kind NOT IN ('guide','receipt') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'invalid_return_logistics';END IF;
 IF p_kind='guide' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['carrier','tracking_number']::text[]
   OR jsonb_typeof(p_payload->'carrier') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'tracking_number') IS DISTINCT FROM 'string'
   OR length(p_payload->>'carrier') NOT BETWEEN 1 AND 80 OR btrim(p_payload->>'carrier') IS DISTINCT FROM p_payload->>'carrier'
   OR length(p_payload->>'tracking_number') NOT BETWEEN 1 AND 100 OR btrim(p_payload->>'tracking_number') IS DISTINCT FROM p_payload->>'tracking_number'
  THEN RAISE EXCEPTION 'invalid_return_logistics';END IF;
 ELSE
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['condition','note','quantity','received_at','reference']::text[]
   OR jsonb_typeof(p_payload->'condition') IS DISTINCT FROM 'string' OR p_payload->>'condition' NOT IN ('accepted','damaged','incomplete')
   OR jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'string' OR length(p_payload->>'note')>500
   OR jsonb_typeof(p_payload->'reference') IS DISTINCT FROM 'string' OR length(p_payload->>'reference') NOT BETWEEN 1 AND 100 OR btrim(p_payload->>'reference') IS DISTINCT FROM p_payload->>'reference'
   OR jsonb_typeof(p_payload->'received_at') IS DISTINCT FROM 'string'
   OR (p_payload->>'received_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   OR jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'number' OR (p_payload->>'quantity') !~ '^[1-9][0-9]{0,4}$'
   OR (p_payload->>'quantity')::numeric>10000 THEN RAISE EXCEPTION 'invalid_return_logistics';END IF;
  BEGIN receipt_time=(p_payload->>'received_at')::timestamptz;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_return_logistics';END;
  IF NOT isfinite(receipt_time) OR receipt_time>clock_timestamp()+interval '5 minutes' OR receipt_time<'2000-01-01'::timestamptz THEN RAISE EXCEPTION 'invalid_return_logistics';END IF;
 END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'return_not_found';END IF;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT public.return_actor_access(p_workspace_id,p_actor_id) THEN RAISE EXCEPTION 'return_access_forbidden';END IF;
 SELECT * INTO r FROM public.returns WHERE id=p_case_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'return_not_found';END IF;
 IF r.conversation_id IS NOT NULL THEN
  PERFORM 1 FROM public.conversations WHERE id=r.conversation_id AND workspace_id=p_workspace_id FOR SHARE;
  PERFORM 1 FROM public.channel_connections cc JOIN public.conversations c ON c.connection_id=cc.id WHERE c.id=r.conversation_id AND cc.workspace_id=p_workspace_id FOR SHARE OF cc;
 END IF;
 IF r.contact_id IS NOT NULL THEN PERFORM 1 FROM public.contacts WHERE id=r.contact_id AND workspace_id=p_workspace_id FOR SHARE;END IF;
 IF NOT public.return_case_actor_access(p_workspace_id,p_actor_id,p_case_id) THEN RAISE EXCEPTION 'return_not_found';END IF;
 IF r.platform IS NOT NULL THEN RAISE EXCEPTION 'return_platform_managed';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,352));
 SELECT * INTO prior FROM public.return_logistics_events WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.case_id IS DISTINCT FROM p_case_id OR prior.actor_id IS DISTINCT FROM p_actor_id
   OR prior.kind IS DISTINCT FROM p_kind OR prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'return_logistics_conflict';END IF;
  RETURN jsonb_build_object('event_id',prior.id,'unchanged',true,'status',r.status,'updated_at',r.updated_at);
 END IF;
 IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'return_decision_changed';END IF;
 IF r.status NOT IN ('aprobada','recibida') THEN RAISE EXCEPTION 'invalid_return_transition';END IF;
 IF receipt_time IS NOT NULL AND receipt_time<r.created_at THEN RAISE EXCEPTION 'invalid_return_logistics';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'return_subscription_read_only';END IF;
 IF (SELECT count(*) FROM public.return_logistics_events WHERE workspace_id=p_workspace_id AND case_id=p_case_id)>=500 THEN RAISE EXCEPTION 'return_logistics_limit';END IF;
 INSERT INTO public.return_logistics_events(id,workspace_id,case_id,actor_id,kind,payload) VALUES(p_id,p_workspace_id,p_case_id,p_actor_id,p_kind,p_payload) RETURNING * INTO event;
 -- Every new attestation advances the concurrency token. Receipt and case history are atomic.
 UPDATE public.returns SET status=CASE WHEN p_kind='receipt' THEN 'recibida' ELSE r.status END,
  decided_by=p_actor_id,decided_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=r.id AND workspace_id=r.workspace_id RETURNING * INTO r;
 RETURN jsonb_build_object('event_id',event.id,'unchanged',false,'status',r.status,'updated_at',r.updated_at);
END $$;

REVOKE ALL ON FUNCTION public.read_return_logistics(uuid,uuid,uuid,bigint),public.record_return_logistics(uuid,uuid,uuid,uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_return_logistics(uuid,uuid,uuid,bigint),public.record_return_logistics(uuid,uuid,uuid,uuid,text,jsonb,timestamptz) TO service_role;

CREATE FUNCTION public.return_logistics_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.return_logistics_events'::regclass)
 AND NOT has_table_privilege('anon','public.return_logistics_events','select,insert,update,delete')
 AND NOT has_table_privilege('authenticated','public.return_logistics_events','select,insert,update,delete')
 AND NOT has_table_privilege('service_role','public.return_logistics_events','select,insert,update,delete')
 AND (SELECT count(*)=2 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute')) FROM pg_catalog.pg_proc WHERE oid IN
 ('public.read_return_logistics(uuid,uuid,uuid,bigint)'::regprocedure,'public.record_return_logistics(uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'::regprocedure));
$$;
REVOKE ALL ON FUNCTION public.return_logistics_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.return_logistics_ready() TO service_role;

-- Aggregate the complete authorized cohort in PostgreSQL; never count a REST page as a total.
CREATE INDEX flow_metric_cohort ON public.flow_runs(workspace_id,flow_id,started_at,id);
CREATE FUNCTION public.read_flow_metric_evidence(p_workspace_id uuid,p_actor_id uuid,p_flow_id uuid,p_from timestamptz,p_through timestamptz,p_node_key text DEFAULT NULL,p_status text DEFAULT NULL,p_cursor jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;cursor_at timestamptz;cursor_id uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_flow_id IS NULL OR p_from IS NULL OR p_through IS NULL
 OR NOT isfinite(p_from) OR NOT isfinite(p_through) OR p_through<=p_from OR p_through-p_from>interval '90 days'
 OR p_node_key IS NOT NULL AND length(p_node_key) NOT BETWEEN 1 AND 120 OR p_status IS NOT NULL AND length(p_status) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_flow_metrics';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.flows f JOIN public.workspaces w ON w.id=f.workspace_id WHERE f.id=p_flow_id AND f.workspace_id=p_workspace_id
 AND f.deleted_at IS NULL AND w.deleted_at IS NULL AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m
 WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent') AND (m.allowed_sections IS NULL OR
 (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/menus' AND to_jsonb(m.allowed_sections) ? '/bandeja'))))) THEN RAISE EXCEPTION 'flow_metrics_not_found';END IF;
 IF p_cursor IS NOT NULL THEN
  BEGIN
   IF jsonb_typeof(p_cursor)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_cursor) key) IS DISTINCT FROM ARRAY['id','started_at']::text[]
   OR jsonb_typeof(p_cursor->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_cursor->'started_at') IS DISTINCT FROM 'string'
   OR (p_cursor->>'started_at') !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$' THEN RAISE EXCEPTION 'invalid_flow_metrics';END IF;
   cursor_at=(p_cursor->>'started_at')::timestamptz;cursor_id=(p_cursor->>'id')::uuid;
   IF NOT isfinite(cursor_at) OR cursor_at<p_from OR cursor_at>=p_through THEN RAISE EXCEPTION 'invalid_flow_metrics';END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_flow_metrics';END;
 END IF;
 WITH cohort AS MATERIALIZED (
 SELECT r.id,r.conversation_id,r.status,r.started_at,r.ended_at FROM public.flow_runs r
 JOIN public.contacts ct ON ct.id=r.contact_id AND ct.workspace_id=r.workspace_id
 JOIN public.conversations c ON c.id=r.conversation_id AND c.workspace_id=r.workspace_id AND c.contact_id=r.contact_id
 LEFT JOIN public.channel_connections cc ON cc.id=c.connection_id
 WHERE r.workspace_id=p_workspace_id AND r.flow_id=p_flow_id AND r.started_at>=p_from AND r.started_at<p_through AND c.deleted_at IS NULL
 AND (c.connection_id IS NULL OR cc.workspace_id=p_workspace_id AND cc.channel=c.channel)
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR cc.created_by=p_actor_id)
 ), entries AS MATERIALIZED (
 SELECT e.flow_run_id,e.node_key FROM public.flow_run_events e JOIN cohort r ON r.id=e.flow_run_id
 WHERE e.event_type='node_entered' AND e.node_key IS NOT NULL AND e.created_at>=r.started_at AND e.created_at<p_through
 ), matched AS MATERIALIZED (
 SELECT r.* FROM cohort r WHERE (p_status IS NULL OR r.status=p_status) AND (p_node_key IS NULL OR EXISTS(SELECT 1 FROM entries e WHERE e.flow_run_id=r.id AND e.node_key=p_node_key))
 ), page AS MATERIALIZED (
 SELECT * FROM matched WHERE p_cursor IS NULL OR (started_at,id)<(cursor_at,cursor_id) ORDER BY started_at DESC,id DESC LIMIT 21
 ), shown AS (SELECT * FROM page ORDER BY started_at DESC,id DESC LIMIT 20)
 SELECT jsonb_build_object('flow_id',p_flow_id,'from_at',p_from,'through_at',p_through,'attribution','recorded_execution',
 'total_runs',(SELECT count(*) FROM cohort),'node_entries',(SELECT count(*) FROM entries),
 'by_node',(SELECT coalesce(jsonb_object_agg(node_key,n),'{}'::jsonb) FROM (SELECT node_key,count(*) n FROM entries GROUP BY node_key) counts),
 'by_status',(SELECT coalesce(jsonb_object_agg(status,n),'{}'::jsonb) FROM (SELECT status,count(*) n FROM cohort GROUP BY status) counts),
 'evidence_filter',jsonb_build_object('node_key',p_node_key,'status',p_status),'matched_runs',(SELECT count(*) FROM matched),
 'records',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'conversation_id',conversation_id,'status',status,'started_at',started_at,'ended_at',ended_at) ORDER BY started_at DESC,id DESC),'[]'::jsonb) FROM shown),
 'next_cursor',CASE WHEN (SELECT count(*) FROM page)>20 THEN (SELECT jsonb_build_object('started_at',started_at,'id',id) FROM shown ORDER BY started_at,id LIMIT 1) END)
 INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_flow_metric_evidence(uuid,uuid,uuid,timestamptz,timestamptz,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_flow_metric_evidence(uuid,uuid,uuid,timestamptz,timestamptz,text,text,jsonb) TO service_role;
CREATE FUNCTION public.flow_metric_evidence_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.read_flow_metric_evidence(uuid,uuid,uuid,timestamptz,timestamptz,text,text,jsonb)'::regprocedure
 AND prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute'))
 AND to_regclass('public.flow_metric_cohort') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.flow_metric_evidence_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.flow_metric_evidence_ready() TO service_role;

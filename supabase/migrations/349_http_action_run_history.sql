CREATE INDEX http_action_runs_history_idx ON public.http_action_runs(workspace_id,action_id,created_at DESC,id DESC);
CREATE FUNCTION public.read_http_action_runs(p_workspace_id uuid,p_actor_id uuid,p_action_id uuid,p_cursor_at timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid;member_role text;sections jsonb;rows jsonb;next_cursor jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_action_id IS NULL OR ((p_cursor_at IS NULL)<>(p_cursor_id IS NULL)) THEN RAISE EXCEPTION 'invalid_http_action_context';END IF;
 SELECT w.owner_id INTO owner_id FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_action_context';END IF;
 IF owner_id IS DISTINCT FROM p_actor_id THEN
  SELECT role,to_jsonb(allowed_sections) INTO member_role,sections FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id;
  IF NOT FOUND OR member_role IS DISTINCT FROM 'admin' OR (sections IS NOT NULL AND (jsonb_typeof(sections)<>'array' OR NOT (sections ? '/ajustes') OR NOT (sections ? '/automatizaciones')))
  THEN RAISE EXCEPTION 'http_action_admin_required';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.http_actions WHERE id=p_action_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'invalid_http_action_context';END IF;
 WITH page AS (
  SELECT r.id,r.action_revision,r.state,r.status_code,r.error_code,r.created_at,r.finished_at
  FROM public.http_action_runs r WHERE r.workspace_id=p_workspace_id AND r.action_id=p_action_id
   AND (p_cursor_id IS NULL OR (r.created_at,r.id)<(p_cursor_at,p_cursor_id))
   AND (r.conversation_id IS NULL OR ((sections IS NULL OR sections ? '/bandeja') AND EXISTS(
    SELECT 1 FROM public.conversations c WHERE c.id=r.conversation_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL
     AND (c.channel::text NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=p_workspace_id AND cc.created_by=p_actor_id AND cc.channel=c.channel)))))
  ORDER BY r.created_at DESC,r.id DESC LIMIT 21
 ), numbered AS (SELECT *,row_number() OVER(ORDER BY created_at DESC,id DESC) AS n FROM page)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'action_revision',action_revision,'state',state,'status_code',status_code,
  'error_code',CASE WHEN error_code IS NULL THEN NULL WHEN error_code IN ('http_destination_forbidden','http_input_invalid','http_timeout','http_transport_failed','http_response_invalid','http_response_too_large','http_status_failed','http_output_invalid','http_action_credential_unavailable','http_execution_unavailable') THEN error_code ELSE 'http_execution_unavailable' END,
  'created_at',created_at,'finished_at',finished_at) ORDER BY created_at DESC,id DESC) FILTER(WHERE n<=20),'[]'::jsonb),
  CASE WHEN count(*)>20 THEN jsonb_agg(jsonb_build_object('created_at',created_at,'id',id) ORDER BY created_at DESC,id DESC)->19 ELSE NULL END
 INTO rows,next_cursor FROM numbered;
 RETURN jsonb_build_object('runs',rows,'next_cursor',next_cursor,'observed_at',statement_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.read_http_action_runs(uuid,uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_http_action_runs(uuid,uuid,uuid,timestamptz,uuid) TO service_role;
CREATE FUNCTION public.http_action_run_history_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.read_http_action_runs(uuid,uuid,uuid,timestamptz,uuid)'::regprocedure)
 AND NOT has_function_privilege('anon','public.read_http_action_runs(uuid,uuid,uuid,timestamptz,uuid)','execute')
 AND NOT has_function_privilege('authenticated','public.read_http_action_runs(uuid,uuid,uuid,timestamptz,uuid)','execute')
 AND has_function_privilege('service_role','public.read_http_action_runs(uuid,uuid,uuid,timestamptz,uuid)','execute')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid='public.http_action_runs_history_idx'::regclass AND indisvalid)
 AND (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.http_action_runs'::regclass)
 AND NOT has_table_privilege('anon','public.http_action_runs','select')
 AND NOT has_table_privilege('authenticated','public.http_action_runs','select')
 AND NOT has_table_privilege('service_role','public.http_action_runs','insert,update,delete');
$$;
REVOKE ALL ON FUNCTION public.http_action_run_history_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.http_action_run_history_ready() TO service_role;

-- Bind observation and advancement to the exact immutable proposal receipt, even after approval deletion.
CREATE OR REPLACE FUNCTION public.prepare_http_flow_post(p_workspace_id uuid,p_run_id uuid,p_flow_id uuid,p_node_key text,p_config jsonb,
 p_grant_revision integer,p_expected_node text,p_visit_at timestamptz,p_vars jsonb,p_input_hash text,p_locale text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb;proposal public.http_action_flow_approvals;approval public.approval_requests;receipt jsonb;name text;title text;body text;key text;
BEGIN
 IF p_input_hash IS NULL OR p_input_hash !~ '^[0-9a-f]{64}$' OR p_locale IS NULL OR p_locale NOT IN ('es','en') THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 snapshot=public.http_flow_post_snapshot(p_workspace_id,p_run_id,p_flow_id,p_node_key,p_config,p_grant_revision,p_visit_at,p_vars,p_expected_node);
 SELECT * INTO proposal FROM public.http_action_flow_approvals WHERE flow_run_id=p_run_id AND flow_id=p_flow_id AND node_key=p_node_key AND visit_at=p_visit_at;
 IF FOUND THEN
  SELECT * INTO approval FROM public.approval_requests WHERE id=proposal.approval_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND OR proposal.node_config IS DISTINCT FROM p_config OR proposal.grant_revision<>p_grant_revision
   OR proposal.observed_vars IS DISTINCT FROM p_vars OR proposal.input_hash IS DISTINCT FROM p_input_hash
   OR (approval.payload-'dedupe_key') IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 ELSE
  key='flow-post:'||replace(gen_random_uuid()::text,'-','');
  SELECT definition->>'name' INTO name FROM public.http_actions WHERE id=(p_config->>'action_id')::uuid;
  title=CASE WHEN p_locale='en' THEN 'System action: ' ELSE 'Acción del sistema: ' END||coalesce(name,'POST');
  body=CASE WHEN p_locale='en' THEN 'Review this operation before execution.' ELSE 'Revisa esta operación antes de ejecutarla.' END
   ||E'\nPOST · v'||(p_config->>'action_revision')||CASE WHEN p_locale='en' THEN E'\nFlow: ' ELSE E'\nFlujo: ' END||p_flow_id||' · '||p_node_key
   ||E'\n'||jsonb_build_object('contact_id',snapshot->'contact_id','conversation_id',snapshot->'conversation_id','input',snapshot->'input')::text;
  INSERT INTO public.approval_requests(workspace_id,kind,title,body,payload,contact_id,expires_at)
  VALUES(p_workspace_id,'herramienta',title,body,snapshot||jsonb_build_object('dedupe_key',key),(snapshot->>'contact_id')::uuid,clock_timestamp()+interval '1 day') RETURNING * INTO approval;
  INSERT INTO public.http_action_flow_approvals VALUES(p_workspace_id,p_run_id,p_flow_id,p_node_key,p_visit_at,approval.id,p_config,p_grant_revision,p_vars,p_input_hash,
   replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')) RETURNING * INTO proposal;
 END IF;
 IF approval.status='pendiente' AND approval.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 UPDATE public.flow_runs SET current_node_key=p_node_key WHERE id=p_run_id;
 SELECT jsonb_build_object('id',a.id,'state',a.state,'status_code',a.status_code,'error_code',a.error_code,'result',a.result) INTO receipt
 FROM public.http_action_flow_receipts f JOIN public.http_action_runs a ON a.id=f.receipt_id
 WHERE f.flow_run_id=p_run_id AND f.flow_id=p_flow_id AND f.node_key=p_node_key AND f.visit_at=p_visit_at AND f.workspace_id=p_workspace_id AND a.workspace_id=p_workspace_id
 AND a.invocation_key=proposal.invocation_key AND a.input_hash=proposal.input_hash
 AND a.action_id=(p_config->>'action_id')::uuid AND a.action_revision=(p_config->>'action_revision')::integer
 AND a.actor_id=approval.decided_by AND a.conversation_id=(snapshot->>'conversation_id')::uuid;
 RETURN jsonb_build_object('approval_id',approval.id,'status',approval.status,'receipt',receipt,'invocation_key',proposal.invocation_key);
END $$;
REVOKE ALL ON FUNCTION public.prepare_http_flow_post(uuid,uuid,uuid,text,jsonb,integer,text,timestamptz,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_http_flow_post(uuid,uuid,uuid,text,jsonb,integer,text,timestamptz,jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_http_flow_post(p_workspace_id uuid,p_approval_id uuid,p_vars jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review jsonb;actor uuid;receipt_id uuid;result jsonb;definition jsonb;projected jsonb;field jsonb;output_key text;
BEGIN
 IF p_workspace_id IS NULL OR p_approval_id IS NULL OR p_vars IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT decided_by INTO actor FROM public.approval_requests WHERE id=p_approval_id AND workspace_id=p_workspace_id;
 review=public.review_http_flow_post(p_workspace_id,p_approval_id,actor,true);
 SELECT f.receipt_id INTO receipt_id FROM public.http_action_flow_receipts f WHERE f.flow_run_id=(review->>'flow_run_id')::uuid
 AND f.flow_id=(review->>'flow_id')::uuid AND f.node_key=review->>'node_key' AND f.visit_at=(review->>'visit_at')::timestamptz;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 SELECT a.result INTO result FROM public.http_action_runs a WHERE a.id=receipt_id AND a.state='acknowledged'
 AND a.workspace_id=p_workspace_id AND a.actor_id=actor
 AND a.action_id=(review->'node_config'->>'action_id')::uuid AND a.action_revision=(review->'node_config'->>'action_revision')::integer
 AND a.conversation_id=(review->'payload'->>'conversation_id')::uuid
 AND a.invocation_key=review->>'invocation_key' AND a.input_hash=review->>'input_hash' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 SELECT a.definition INTO definition FROM public.http_actions a WHERE a.id=(review->'node_config'->>'action_id')::uuid;
 projected=review->'observed_vars';
 FOR field IN SELECT f FROM jsonb_array_elements(definition->'outputs') f LOOP
  output_key=(review->'node_config'->>'output_prefix')||'_'||(field->>'key');
  projected=projected-output_key;
  IF result ? (field->>'key') THEN projected=projected||jsonb_build_object(output_key,result->(field->>'key'));
  ELSIF field->>'required'='true' THEN RAISE EXCEPTION 'http_flow_output_invalid';END IF;
 END LOOP;
 IF projected IS DISTINCT FROM p_vars THEN RAISE EXCEPTION 'http_flow_output_invalid';END IF;
 RETURN public.finish_http_action_flow(p_workspace_id,(review->>'flow_run_id')::uuid,(review->>'flow_id')::uuid,review->>'node_key',
  review->'node_config',(review->>'grant_revision')::integer,receipt_id,(review->>'visit_at')::timestamptz,review->'observed_vars',p_vars);
END $$;
REVOKE ALL ON FUNCTION public.finish_http_flow_post(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_http_flow_post(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.http_flow_post_receipt_binding_ready() RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.http_flow_post_ready()
 AND (SELECT count(*)=2 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""']
  AND strpos(pg_get_functiondef(p.oid),'a.invocation_key=')>0 AND strpos(pg_get_functiondef(p.oid),'a.input_hash=')>0
  AND strpos(pg_get_functiondef(p.oid),'a.actor_id=')>0 AND strpos(pg_get_functiondef(p.oid),'a.conversation_id=')>0
  AND NOT has_function_privilege('anon',p.oid,'execute') AND NOT has_function_privilege('authenticated',p.oid,'execute')
  AND has_function_privilege('service_role',p.oid,'execute')) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('prepare_http_flow_post','finish_http_flow_post'));
$$;
REVOKE ALL ON FUNCTION public.http_flow_post_receipt_binding_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.http_flow_post_receipt_binding_ready() TO service_role;


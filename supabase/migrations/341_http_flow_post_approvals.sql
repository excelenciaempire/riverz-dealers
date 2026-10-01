-- A flow grant permits preparing a POST, never bypassing an individual panel decision.
CREATE TABLE public.http_action_flow_approvals (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
 flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,node_key text NOT NULL,
 visit_at timestamptz NOT NULL,approval_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
 node_config jsonb NOT NULL,grant_revision integer NOT NULL,observed_vars jsonb NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 invocation_key text NOT NULL CHECK(invocation_key ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(flow_run_id,flow_id,node_key,visit_at),UNIQUE(approval_id),UNIQUE(invocation_key)
);
ALTER TABLE public.http_action_flow_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.http_action_flow_approvals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.http_action_flow_approvals TO service_role;

-- Shared transactional snapshot. Parameters are derived from the saved graph and observed run.
CREATE FUNCTION public.http_flow_post_snapshot(p_workspace_id uuid,p_run_id uuid,p_flow_id uuid,p_node_key text,
 p_config jsonb,p_grant_revision integer,p_visit_at timestamptz,p_vars jsonb,p_expected_node text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flow_runs;g public.http_action_flow_grants;a public.http_actions;
 active_flow uuid;context jsonb;input jsonb='{}';field jsonb;value jsonb;variable text;
BEGIN
 IF p_workspace_id IS NULL OR p_run_id IS NULL OR p_flow_id IS NULL OR p_node_key IS NULL OR p_config IS NULL
 OR p_grant_revision IS NULL OR p_visit_at IS NULL OR p_vars IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO r FROM public.flow_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'active' OR r.current_node_key IS DISTINCT FROM p_expected_node
 OR r.last_advanced_at IS DISTINCT FROM p_visit_at OR r.vars IS DISTINCT FROM p_vars THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 active_flow=CASE WHEN jsonb_array_length(coalesce(r.call_stack,'[]'::jsonb))>0 THEN (r.call_stack->-1->>'flow_id')::uuid ELSE r.flow_id END;
 IF active_flow IS DISTINCT FROM p_flow_id THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 PERFORM 1 FROM public.flows WHERE id=r.flow_id AND workspace_id=p_workspace_id AND status='active' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 PERFORM 1 FROM public.flow_nodes n JOIN public.flows f ON f.id=n.flow_id WHERE n.flow_id=p_flow_id AND n.node_key=p_node_key
 AND n.node_type='http_action' AND n.config=p_config AND f.workspace_id=p_workspace_id AND f.status='active' AND f.deleted_at IS NULL FOR SHARE OF n,f;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 SELECT * INTO g FROM public.http_action_flow_grants WHERE workspace_id=p_workspace_id AND flow_id=p_flow_id AND node_key=p_node_key FOR SHARE;
 IF NOT FOUND OR g.state<>'active' OR g.revision<>p_grant_revision OR g.node_config IS DISTINCT FROM p_config
 OR g.action_id IS DISTINCT FROM (p_config->>'action_id')::uuid OR g.action_revision<>(p_config->>'action_revision')::integer
 THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 PERFORM public.http_flow_admin(p_workspace_id,g.granted_by);
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 SELECT jsonb_build_object('contact_id',customer.id,'conversation_id',c.id,'phone',customer.phone,'email',customer.email) INTO context
 FROM public.conversations c JOIN public.contacts customer ON customer.id=c.contact_id AND customer.workspace_id=p_workspace_id
 WHERE c.id=r.conversation_id AND c.workspace_id=p_workspace_id AND c.contact_id=r.contact_id AND c.deleted_at IS NULL
 AND (c.channel::text NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc
 WHERE cc.id=c.connection_id AND cc.workspace_id=p_workspace_id AND cc.channel::text=c.channel::text AND cc.created_by=g.granted_by)) FOR SHARE OF c,customer;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO a FROM public.http_actions WHERE id=g.action_id AND workspace_id=p_workspace_id AND state='active' FOR SHARE;
 IF NOT FOUND OR a.revision<>g.action_revision THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 IF a.definition->>'method' IS DISTINCT FROM 'POST'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f WHERE f->>'source'='contact_id' AND f->>'type'='string' AND f->>'required'='true')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f WHERE f->>'source'='conversation_id' AND f->>'type'='string' AND f->>'required'='true')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f WHERE f->>'source' IN ('phone','email')) THEN RAISE EXCEPTION 'http_flow_action_forbidden';END IF;
 IF jsonb_typeof(p_config->'input_vars') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_config->'input_vars') k
 WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f WHERE f->>'key'=k AND coalesce(f->>'source','input')='input'))
 THEN RAISE EXCEPTION 'http_flow_input_invalid';END IF;
 FOR field IN SELECT f FROM jsonb_array_elements(a.definition->'parameters') f WHERE coalesce(f->>'source','input')='input' LOOP
  variable=p_config->'input_vars'->>(field->>'key');
  IF variable IS NULL OR NOT(p_vars ? variable) THEN
   IF field->>'required'='true' THEN RAISE EXCEPTION 'http_flow_input_invalid';END IF;
   CONTINUE;
  END IF;
  value=p_vars->variable;
  IF jsonb_typeof(value) IS DISTINCT FROM field->>'type' OR (field->>'type'='string' AND length(value#>>'{}')>2000)
   OR (field->>'type'='number' AND abs((value#>>'{}')::numeric)>1e12) THEN RAISE EXCEPTION 'http_flow_input_invalid';END IF;
  input=input||jsonb_build_object(field->>'key',value);
 END LOOP;
 RETURN jsonb_build_object('tool','http_flow_action_'||replace(a.id::text,'-','')||'_v'||a.revision,
  'input',input,'contact_id',r.contact_id,'conversation_id',r.conversation_id,'http_action_context',context,
  'http_flow',jsonb_build_object('run_id',r.id,'flow_id',p_flow_id,'node_key',p_node_key,'visit_at',p_visit_at,
   'node_config',p_config,'grant_revision',g.revision));
END $$;
REVOKE ALL ON FUNCTION public.http_flow_post_snapshot(uuid,uuid,uuid,text,jsonb,integer,timestamptz,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.http_flow_post_snapshot(uuid,uuid,uuid,text,jsonb,integer,timestamptz,jsonb,text) TO service_role;

CREATE FUNCTION public.prepare_http_flow_post(p_workspace_id uuid,p_run_id uuid,p_flow_id uuid,p_node_key text,p_config jsonb,
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
 WHERE f.flow_run_id=p_run_id AND f.flow_id=p_flow_id AND f.node_key=p_node_key AND f.visit_at=p_visit_at AND f.workspace_id=p_workspace_id;
 RETURN jsonb_build_object('approval_id',approval.id,'status',approval.status,'receipt',receipt,'invocation_key',proposal.invocation_key);
END $$;
REVOKE ALL ON FUNCTION public.prepare_http_flow_post(uuid,uuid,uuid,text,jsonb,integer,text,timestamptz,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_http_flow_post(uuid,uuid,uuid,text,jsonb,integer,text,timestamptz,jsonb,text,text) TO service_role;

-- Decision identity is checked again while holding the run/approval snapshots, before any lease.
CREATE FUNCTION public.review_http_flow_post(p_workspace_id uuid,p_approval_id uuid,p_actor_id uuid,p_approved boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proposal public.http_action_flow_approvals;approval public.approval_requests;snapshot jsonb;sections jsonb;owner_id uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_approval_id IS NULL OR p_actor_id IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO proposal FROM public.http_action_flow_approvals WHERE workspace_id=p_workspace_id AND approval_id=p_approval_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 snapshot=public.http_flow_post_snapshot(p_workspace_id,proposal.flow_run_id,proposal.flow_id,proposal.node_key,proposal.node_config,
  proposal.grant_revision,proposal.visit_at,proposal.observed_vars,proposal.node_key);
 PERFORM public.http_flow_admin(p_workspace_id,p_actor_id);
 SELECT w.owner_id INTO owner_id FROM public.workspaces w WHERE w.id=p_workspace_id;
 IF owner_id IS DISTINCT FROM p_actor_id THEN
  SELECT to_jsonb(m.allowed_sections) INTO sections FROM public.workspace_members m WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id;
  IF sections IS NOT NULL AND NOT(sections ? '/aprobaciones') THEN RAISE EXCEPTION 'http_flow_admin_required';END IF;
 END IF;
 PERFORM 1 FROM public.conversations c WHERE c.id=(snapshot->>'conversation_id')::uuid AND c.workspace_id=p_workspace_id
 AND (c.channel::text NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id
 AND cc.workspace_id=p_workspace_id AND cc.channel::text=c.channel::text AND cc.created_by=p_actor_id)) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO approval FROM public.approval_requests WHERE id=p_approval_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND OR approval.kind<>'herramienta' OR (approval.payload-'dedupe_key') IS DISTINCT FROM snapshot
 OR (p_approved IS NULL AND (approval.status<>'pendiente' OR approval.expires_at<=clock_timestamp()))
 OR (p_approved IS NOT NULL AND (approval.status IS DISTINCT FROM CASE WHEN p_approved THEN 'aprobada' ELSE 'rechazada' END
 OR approval.decided_by IS DISTINCT FROM p_actor_id OR approval.decided_via IS DISTINCT FROM 'panel'
 OR approval.decided_at IS NULL OR approval.decided_at>=approval.expires_at OR approval.decided_at>clock_timestamp()))
 THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 RETURN to_jsonb(proposal)||jsonb_build_object('payload',snapshot,'decided_at',approval.decided_at);
END $$;
REVOKE ALL ON FUNCTION public.review_http_flow_post(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_http_flow_post(uuid,uuid,uuid,boolean) TO service_role;

CREATE FUNCTION public.claim_http_flow_post(p_workspace_id uuid,p_approval_id uuid,p_actor_id uuid,p_input_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review jsonb;answer jsonb;receipt_id uuid;
BEGIN
 review=public.review_http_flow_post(p_workspace_id,p_approval_id,p_actor_id,true);
 IF p_input_hash IS NULL OR p_input_hash IS DISTINCT FROM review->>'input_hash' THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 SELECT f.receipt_id INTO receipt_id FROM public.http_action_flow_receipts f WHERE f.flow_run_id=(review->>'flow_run_id')::uuid
 AND f.flow_id=(review->>'flow_id')::uuid AND f.node_key=review->>'node_key' AND f.visit_at=(review->>'visit_at')::timestamptz;
 IF NOT FOUND AND (review->>'decided_at')::timestamptz<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 answer=public.claim_http_action(p_workspace_id,p_actor_id,(review->'node_config'->>'action_id')::uuid,
  (review->'node_config'->>'action_revision')::integer,review->>'invocation_key',p_input_hash,true,
  (review->'payload'->>'conversation_id')::uuid,review->'payload'->'http_action_context');
 INSERT INTO public.http_action_flow_receipts VALUES(p_workspace_id,(review->>'flow_run_id')::uuid,(review->>'flow_id')::uuid,
  review->>'node_key',(answer->>'id')::uuid,(review->>'visit_at')::timestamptz) ON CONFLICT(flow_run_id,flow_id,node_key,visit_at) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.http_action_flow_receipts f WHERE f.flow_run_id=(review->>'flow_run_id')::uuid
 AND f.flow_id=(review->>'flow_id')::uuid AND f.node_key=review->>'node_key' AND f.visit_at=(review->>'visit_at')::timestamptz
 AND f.receipt_id=(answer->>'id')::uuid) THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 RETURN jsonb_build_object('claim',answer,'invocation_key',review->>'invocation_key');
END $$;
REVOKE ALL ON FUNCTION public.claim_http_flow_post(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_http_flow_post(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.finish_http_flow_post(p_workspace_id uuid,p_approval_id uuid,p_vars jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review jsonb;actor uuid;receipt_id uuid;result jsonb;definition jsonb;projected jsonb;field jsonb;output_key text;
BEGIN
 IF p_workspace_id IS NULL OR p_approval_id IS NULL OR p_vars IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT decided_by INTO actor FROM public.approval_requests WHERE id=p_approval_id AND workspace_id=p_workspace_id;
 review=public.review_http_flow_post(p_workspace_id,p_approval_id,actor,true);
 SELECT f.receipt_id INTO receipt_id FROM public.http_action_flow_receipts f WHERE f.flow_run_id=(review->>'flow_run_id')::uuid
 AND f.flow_id=(review->>'flow_id')::uuid AND f.node_key=review->>'node_key' AND f.visit_at=(review->>'visit_at')::timestamptz;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 SELECT a.result INTO result FROM public.http_action_runs a WHERE a.id=receipt_id AND a.state='acknowledged' FOR SHARE;
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

CREATE FUNCTION public.reject_http_flow_post(p_workspace_id uuid,p_approval_id uuid,p_actor_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proposal public.http_action_flow_approvals;approval public.approval_requests;
BEGIN
 IF p_workspace_id IS NULL OR p_approval_id IS NULL OR p_actor_id IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO approval FROM public.approval_requests WHERE id=p_approval_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND OR approval.status<>'rechazada' OR approval.decided_by IS DISTINCT FROM p_actor_id
 OR approval.decided_via IS DISTINCT FROM 'panel' THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 SELECT * INTO proposal FROM public.http_action_flow_approvals WHERE workspace_id=p_workspace_id AND approval_id=p_approval_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 RETURN public.fail_http_action_flow(p_workspace_id,proposal.flow_run_id,proposal.flow_id,proposal.node_key,proposal.node_key,proposal.visit_at,proposal.observed_vars);
END $$;
REVOKE ALL ON FUNCTION public.reject_http_flow_post(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_http_flow_post(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.stop_http_flow_post(p_workspace_id uuid,p_approval_id uuid,p_actor_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proposal public.http_action_flow_approvals;
BEGIN
 IF p_workspace_id IS NULL OR p_approval_id IS NULL OR p_actor_id IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 PERFORM 1 FROM public.approval_requests WHERE id=p_approval_id AND workspace_id=p_workspace_id
 AND status IN ('aprobada','fallida') AND decided_by=p_actor_id AND decided_via='panel' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 SELECT * INTO proposal FROM public.http_action_flow_approvals WHERE workspace_id=p_workspace_id AND approval_id=p_approval_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 RETURN public.fail_http_action_flow(p_workspace_id,proposal.flow_run_id,proposal.flow_id,proposal.node_key,proposal.node_key,proposal.visit_at,proposal.observed_vars);
END $$;
REVOKE ALL ON FUNCTION public.stop_http_flow_post(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stop_http_flow_post(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.manage_http_flow_grant(p_workspace_id uuid,p_actor_id uuid,p_flow_id uuid,p_operation text,
 p_node_key text DEFAULT NULL,p_expected_revision integer DEFAULT NULL,p_reviewed_config jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.flow_nodes;a public.http_actions;g public.http_action_flow_grants;result jsonb;config jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_flow_id IS NULL OR p_operation IS NULL
 OR p_operation NOT IN ('list','save','withdraw') THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 PERFORM public.http_flow_admin(p_workspace_id,p_actor_id);
 PERFORM 1 FROM public.flows WHERE id=p_flow_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 IF p_operation='list' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) INTO result FROM (
   SELECT node_key,action_id,action_revision,node_config,revision,state,granted_by,updated_at
   FROM public.http_action_flow_grants WHERE flow_id=p_flow_id AND workspace_id=p_workspace_id ORDER BY node_key LIMIT 200) rows;
  RETURN jsonb_build_object('grants',result);
 END IF;
 IF p_node_key IS NULL OR length(p_node_key)>120 OR p_expected_revision IS NULL OR p_expected_revision<0
 THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('http-flow-grant:'||p_flow_id::text||':'||p_node_key,0));
 SELECT * INTO g FROM public.http_action_flow_grants WHERE flow_id=p_flow_id AND node_key=p_node_key FOR UPDATE;
 IF coalesce(g.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 IF p_operation='withdraw' THEN
  IF g.flow_id IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
  UPDATE public.http_action_flow_grants SET revision=revision+1,state='withdrawn',granted_by=p_actor_id,updated_at=clock_timestamp()
  WHERE flow_id=p_flow_id AND node_key=p_node_key RETURNING * INTO g;
 ELSE
  SELECT * INTO n FROM public.flow_nodes WHERE flow_id=p_flow_id AND node_key=p_node_key AND node_type='http_action' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
  config=n.config;
  IF p_reviewed_config IS NULL OR config IS DISTINCT FROM p_reviewed_config THEN RAISE EXCEPTION 'http_flow_changed';END IF;
  IF jsonb_typeof(config)<>'object' OR octet_length(config::text)>16384
   OR coalesce(config->>'action_id','') !~ '^[0-9a-fA-F-]{36}$'
   OR coalesce(config->>'action_revision','') !~ '^[1-9][0-9]{0,8}$'
   OR coalesce(config->>'output_prefix','') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,47}$'
   OR jsonb_typeof(config->'input_vars') IS DISTINCT FROM 'object' OR coalesce(config->>'next_node_key','')=''
  THEN RAISE EXCEPTION 'http_flow_invalid';END IF;
  SELECT * INTO a FROM public.http_actions WHERE id=(config->>'action_id')::uuid AND workspace_id=p_workspace_id AND state='active' FOR SHARE;
  IF NOT FOUND OR a.revision<>(config->>'action_revision')::integer THEN RAISE EXCEPTION 'http_flow_changed';END IF;
  IF coalesce(a.definition->>'method','') NOT IN ('GET','POST') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f
   WHERE f->>'source'='contact_id' AND f->>'type'='string' AND f->>'required'='true')
   OR (a.definition->>'method'='POST' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f WHERE f->>'source'='conversation_id' AND f->>'type'='string' AND f->>'required'='true'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f WHERE f->>'source' IN ('phone','email'))
  THEN RAISE EXCEPTION 'http_flow_action_forbidden';END IF;
  INSERT INTO public.http_action_flow_grants(workspace_id,flow_id,node_key,action_id,action_revision,node_config,revision,state,granted_by)
  VALUES(p_workspace_id,p_flow_id,p_node_key,a.id,a.revision,config,1,'active',p_actor_id)
  ON CONFLICT(flow_id,node_key) DO UPDATE SET action_id=EXCLUDED.action_id,action_revision=EXCLUDED.action_revision,
   node_config=EXCLUDED.node_config,revision=public.http_action_flow_grants.revision+1,state='active',granted_by=p_actor_id,updated_at=clock_timestamp()
  RETURNING * INTO g;
 END IF;
 INSERT INTO public.http_action_flow_grant_versions VALUES(g.workspace_id,g.flow_id,g.node_key,g.action_id,g.action_revision,
  g.node_config,g.revision,g.state,g.granted_by,g.updated_at);
 RETURN to_jsonb(g)-'workspace_id'-'flow_id';
END $$;
REVOKE ALL ON FUNCTION public.manage_http_flow_grant(uuid,uuid,uuid,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_http_flow_grant(uuid,uuid,uuid,text,text,integer,jsonb) TO service_role;

-- Catalog-only deployment proof: no action, customer or approval rows are read.
CREATE FUNCTION public.http_flow_post_ready() RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid='public.http_action_flow_approvals'::regclass),false)
 AND NOT has_table_privilege('anon','public.http_action_flow_approvals','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('authenticated','public.http_action_flow_approvals','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('service_role','public.http_action_flow_approvals','INSERT,UPDATE,DELETE')
 AND has_table_privilege('service_role','public.http_action_flow_approvals','SELECT')
 AND (SELECT count(*)=7 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""']
  AND NOT has_function_privilege('anon',p.oid,'execute') AND NOT has_function_privilege('authenticated',p.oid,'execute')
  AND has_function_privilege('service_role',p.oid,'execute')) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('http_flow_post_snapshot','prepare_http_flow_post','review_http_flow_post',
   'claim_http_flow_post','finish_http_flow_post','reject_http_flow_post','stop_http_flow_post'));
$$;
REVOKE ALL ON FUNCTION public.http_flow_post_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.http_flow_post_ready() TO service_role;


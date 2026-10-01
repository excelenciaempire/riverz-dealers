-- Contact-scoped GET nodes use Riverz's executor and require an explicit, versioned human grant.
ALTER TABLE public.flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE public.flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK(node_type IN (
 'start','send_message','send_buttons','send_list','send_image','send_video','send_document','send_cta_url',
 'collect_input','condition','set_tag','handoff','http_fetch','wait','ai_intent','shopify_lookup','customer_reply','subflow','end','http_action'));

CREATE TABLE public.http_action_flow_grants (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
 node_key text NOT NULL, action_id uuid NOT NULL REFERENCES public.http_actions(id) ON DELETE CASCADE,
 action_revision integer NOT NULL CHECK(action_revision>0), node_config jsonb NOT NULL,
 revision integer NOT NULL CHECK(revision>0),state text NOT NULL CHECK(state IN ('active','withdrawn')),
 granted_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(flow_id,node_key)
);
CREATE TABLE public.http_action_flow_grant_versions (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,node_key text NOT NULL,
 action_id uuid NOT NULL REFERENCES public.http_actions(id) ON DELETE CASCADE,
 action_revision integer NOT NULL,node_config jsonb NOT NULL,revision integer NOT NULL,
 state text NOT NULL,granted_by uuid NOT NULL,observed_at timestamptz NOT NULL,
 PRIMARY KEY(flow_id,node_key,revision)
);
CREATE TABLE public.http_action_flow_receipts (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
 flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,node_key text NOT NULL,
 receipt_id uuid NOT NULL REFERENCES public.http_action_runs(id) ON DELETE CASCADE,
 visit_at timestamptz NOT NULL,PRIMARY KEY(flow_run_id,flow_id,node_key,visit_at),UNIQUE(receipt_id)
);
ALTER TABLE public.http_action_flow_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.http_action_flow_grant_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.http_action_flow_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.http_action_flow_grants,public.http_action_flow_grant_versions,public.http_action_flow_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.http_action_flow_grants,public.http_action_flow_grant_versions,public.http_action_flow_receipts TO service_role;

CREATE FUNCTION public.http_flow_admin(p_workspace uuid,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid;role_name text;sections jsonb;
BEGIN
 IF p_workspace IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT w.owner_id INTO owner_id FROM public.workspaces w WHERE w.id=p_workspace AND w.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 IF owner_id IS NOT DISTINCT FROM p_actor THEN RETURN;END IF;
 SELECT m.role,to_jsonb(m.allowed_sections) INTO role_name,sections FROM public.workspace_members m
 WHERE m.workspace_id=p_workspace AND m.user_id=p_actor FOR SHARE;
 IF NOT FOUND OR role_name IS DISTINCT FROM 'admin' OR (sections IS NOT NULL AND
 (jsonb_typeof(sections)<>'array' OR NOT(sections ? '/automatizaciones') OR NOT(sections ? '/bandeja')))
 THEN RAISE EXCEPTION 'http_flow_admin_required';END IF;
END $$;
REVOKE ALL ON FUNCTION public.http_flow_admin(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.http_flow_admin(uuid,uuid) TO service_role;

CREATE FUNCTION public.manage_http_flow_grant(p_workspace_id uuid,p_actor_id uuid,p_flow_id uuid,p_operation text,
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
  IF a.definition->>'method' IS DISTINCT FROM 'GET' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') f
   WHERE f->>'source'='contact_id' AND f->>'type'='string' AND f->>'required'='true')
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

CREATE FUNCTION public.claim_http_action_flow(p_workspace_id uuid,p_run_id uuid,p_flow_id uuid,p_node_key text,p_config jsonb,
 p_grant_revision integer,p_expected_node text,p_expected_advanced_at timestamptz,p_expected_vars jsonb,
 p_invocation_key text,p_input_hash text,p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flow_runs;g public.http_action_flow_grants;n public.flow_nodes;a public.http_actions;active_flow uuid;answer jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_run_id IS NULL OR p_flow_id IS NULL OR p_node_key IS NULL OR p_config IS NULL
 OR p_grant_revision IS NULL OR p_expected_advanced_at IS NULL OR p_expected_vars IS NULL
 THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO r FROM public.flow_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'active' OR r.current_node_key IS DISTINCT FROM p_expected_node
 OR r.last_advanced_at IS DISTINCT FROM p_expected_advanced_at OR r.vars IS DISTINCT FROM p_expected_vars
 THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 active_flow=CASE WHEN jsonb_array_length(coalesce(r.call_stack,'[]'::jsonb))>0
  THEN (r.call_stack->-1->>'flow_id')::uuid ELSE r.flow_id END;
 IF active_flow IS DISTINCT FROM p_flow_id THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 PERFORM 1 FROM public.flows WHERE id=r.flow_id AND workspace_id=p_workspace_id AND status='active' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 PERFORM 1 FROM public.flows WHERE id=p_flow_id AND workspace_id=p_workspace_id AND status='active' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO n FROM public.flow_nodes WHERE flow_id=p_flow_id AND node_key=p_node_key AND node_type='http_action' FOR SHARE;
 IF NOT FOUND OR n.config IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 SELECT * INTO g FROM public.http_action_flow_grants WHERE workspace_id=p_workspace_id AND flow_id=p_flow_id AND node_key=p_node_key FOR SHARE;
 IF NOT FOUND OR g.state<>'active' OR g.revision<>p_grant_revision OR g.node_config IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 PERFORM public.http_flow_admin(p_workspace_id,g.granted_by);
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 PERFORM 1 FROM public.conversations c JOIN public.contacts customer ON customer.id=c.contact_id AND customer.workspace_id=p_workspace_id
 WHERE c.id=r.conversation_id AND c.workspace_id=p_workspace_id AND c.contact_id=r.contact_id AND c.deleted_at IS NULL
 AND (c.channel::text NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc
 WHERE cc.id=c.connection_id AND cc.workspace_id=p_workspace_id AND cc.channel::text=c.channel::text AND cc.created_by=g.granted_by))
 FOR SHARE OF c,customer;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO a FROM public.http_actions WHERE id=g.action_id AND workspace_id=p_workspace_id AND state='active' FOR SHARE;
 IF NOT FOUND OR a.revision<>g.action_revision OR a.definition->>'method' IS DISTINCT FROM 'GET'
 OR g.action_id IS DISTINCT FROM (p_config->>'action_id')::uuid OR g.action_revision<>(p_config->>'action_revision')::integer
 THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 IF r.contact_id IS NULL OR r.conversation_id IS NULL OR p_context->>'contact_id' IS DISTINCT FROM r.contact_id::text
 OR p_context->>'conversation_id' IS DISTINCT FROM r.conversation_id::text THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 answer=public.claim_http_action(p_workspace_id,g.granted_by,g.action_id,g.action_revision,p_invocation_key,p_input_hash,false,r.conversation_id,p_context);
 INSERT INTO public.http_action_flow_receipts VALUES(p_workspace_id,r.id,p_flow_id,p_node_key,(answer->>'id')::uuid,p_expected_advanced_at)
 ON CONFLICT(flow_run_id,flow_id,node_key,visit_at) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.http_action_flow_receipts WHERE flow_run_id=r.id AND flow_id=p_flow_id AND node_key=p_node_key
 AND visit_at=p_expected_advanced_at AND receipt_id=(answer->>'id')::uuid) THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 UPDATE public.flow_runs SET current_node_key=p_node_key WHERE id=r.id;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.claim_http_action_flow(uuid,uuid,uuid,text,jsonb,integer,text,timestamptz,jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_http_action_flow(uuid,uuid,uuid,text,jsonb,integer,text,timestamptz,jsonb,text,text,jsonb) TO service_role;

CREATE FUNCTION public.finish_http_action_flow(p_workspace_id uuid,p_run_id uuid,p_flow_id uuid,p_node_key text,p_config jsonb,
 p_grant_revision integer,p_receipt_id uuid,p_expected_advanced_at timestamptz,p_expected_vars jsonb,p_vars jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flow_runs;g public.http_action_flow_grants;
BEGIN
 IF p_workspace_id IS NULL OR p_run_id IS NULL OR p_flow_id IS NULL OR p_node_key IS NULL OR p_config IS NULL
 OR p_grant_revision IS NULL OR p_receipt_id IS NULL OR p_expected_advanced_at IS NULL OR p_expected_vars IS NULL
 OR p_vars IS NULL OR jsonb_typeof(p_vars)<>'object' OR octet_length(p_vars::text)>131072
 THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO r FROM public.flow_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'active' OR r.current_node_key IS DISTINCT FROM p_node_key OR r.last_advanced_at IS DISTINCT FROM p_expected_advanced_at
 OR r.vars IS DISTINCT FROM p_expected_vars THEN RETURN false;END IF;
 PERFORM 1 FROM public.http_action_flow_receipts f JOIN public.http_action_runs a ON a.id=f.receipt_id
 WHERE f.workspace_id=p_workspace_id AND f.flow_run_id=r.id AND f.flow_id=p_flow_id AND f.node_key=p_node_key
 AND f.visit_at=p_expected_advanced_at AND f.receipt_id=p_receipt_id AND a.state='acknowledged' FOR SHARE OF f,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO g FROM public.http_action_flow_grants WHERE workspace_id=p_workspace_id AND flow_id=p_flow_id AND node_key=p_node_key FOR SHARE;
 IF NOT FOUND OR g.state<>'active' OR g.revision<>p_grant_revision OR g.node_config IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 PERFORM public.http_flow_admin(p_workspace_id,g.granted_by);
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 PERFORM 1 FROM public.flow_nodes n JOIN public.flows f ON f.id=n.flow_id
 WHERE n.flow_id=p_flow_id AND n.node_key=p_node_key AND n.node_type='http_action' AND n.config=p_config
 AND f.workspace_id=p_workspace_id AND f.status='active' AND f.deleted_at IS NULL FOR SHARE OF n,f;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 PERFORM 1 FROM public.conversations c JOIN public.contacts customer ON customer.id=c.contact_id AND customer.workspace_id=p_workspace_id
 WHERE c.id=r.conversation_id AND c.workspace_id=p_workspace_id AND c.contact_id=r.contact_id AND c.deleted_at IS NULL
 AND (c.channel::text NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc
 WHERE cc.id=c.connection_id AND cc.workspace_id=p_workspace_id AND cc.channel::text=c.channel::text AND cc.created_by=g.granted_by))
 FOR SHARE OF c,customer;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 PERFORM 1 FROM public.flows WHERE id=r.flow_id AND workspace_id=p_workspace_id AND status='active' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 PERFORM 1 FROM public.http_actions WHERE id=g.action_id AND workspace_id=p_workspace_id AND state='active' AND revision=g.action_revision FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_changed';END IF;
 UPDATE public.flow_runs SET current_node_key=p_config->>'next_node_key',vars=p_vars WHERE id=r.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_http_action_flow(uuid,uuid,uuid,text,jsonb,integer,uuid,timestamptz,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_http_action_flow(uuid,uuid,uuid,text,jsonb,integer,uuid,timestamptz,jsonb,jsonb) TO service_role;

-- Fail only the observed visit. A superseded worker must never terminate a newer execution.
CREATE FUNCTION public.fail_http_action_flow(p_workspace_id uuid,p_run_id uuid,p_flow_id uuid,p_node_key text,
 p_expected_node text,p_expected_advanced_at timestamptz,p_expected_vars jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flow_runs;active_flow uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_run_id IS NULL OR p_flow_id IS NULL OR p_node_key IS NULL
 OR p_expected_advanced_at IS NULL OR p_expected_vars IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT * INTO r FROM public.flow_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'active' OR r.last_advanced_at IS DISTINCT FROM p_expected_advanced_at
 OR r.vars IS DISTINCT FROM p_expected_vars OR (r.current_node_key IS DISTINCT FROM p_expected_node
 AND r.current_node_key IS DISTINCT FROM p_node_key) THEN RETURN false;END IF;
 active_flow=CASE WHEN jsonb_array_length(coalesce(r.call_stack,'[]'::jsonb))>0
  THEN (r.call_stack->-1->>'flow_id')::uuid ELSE r.flow_id END;
 IF active_flow IS DISTINCT FROM p_flow_id THEN RETURN false;END IF;
 UPDATE public.flow_runs SET status='failed',end_reason='http_flow_review_required',ended_at=clock_timestamp() WHERE id=r.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fail_http_action_flow(uuid,uuid,uuid,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_http_action_flow(uuid,uuid,uuid,text,text,timestamptz,jsonb) TO service_role;

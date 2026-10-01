CREATE TABLE public.http_action_assistant_grants (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 action_id uuid NOT NULL REFERENCES public.http_actions(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 channel text NOT NULL,
 context_scope text NOT NULL CHECK(context_scope IN ('contact','business')),
 action_revision integer NOT NULL CHECK(action_revision>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('active','withdrawn')),
 granted_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,action_id,agent_id,channel)
);
CREATE TABLE public.http_action_assistant_grant_versions (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 action_id uuid NOT NULL REFERENCES public.http_actions(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 channel text NOT NULL,revision integer NOT NULL,action_revision integer NOT NULL,
 context_scope text NOT NULL,state text NOT NULL,granted_by uuid NOT NULL,observed_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,action_id,agent_id,channel,revision)
);
ALTER TABLE public.http_action_assistant_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.http_action_assistant_grant_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.http_action_assistant_grants,public.http_action_assistant_grant_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.http_action_assistant_grants,public.http_action_assistant_grant_versions TO service_role;
CREATE FUNCTION public.audit_http_action_assistant_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.http_action_assistant_grant_versions(workspace_id,action_id,agent_id,channel,revision,action_revision,context_scope,state,granted_by,observed_at)
 VALUES(NEW.workspace_id,NEW.action_id,NEW.agent_id,NEW.channel,NEW.revision,NEW.action_revision,NEW.context_scope,NEW.state,NEW.granted_by,NEW.updated_at);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_http_action_assistant_grant() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER http_action_assistant_grant_audit AFTER INSERT OR UPDATE ON public.http_action_assistant_grants
 FOR EACH ROW EXECUTE FUNCTION public.audit_http_action_assistant_grant();

CREATE FUNCTION public.manage_http_action_assistant_grant(
 p_workspace_id uuid,p_actor_id uuid,p_action_id uuid,p_operation text,
 p_agent_id uuid DEFAULT NULL,p_channel text DEFAULT NULL,p_context_scope text DEFAULT NULL,
 p_action_revision integer DEFAULT NULL,p_grant_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.http_actions;g public.http_action_assistant_grants;owner_id uuid;member_role text;sections jsonb;agent_scope text;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_action_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('list','save','withdraw')
 THEN RAISE EXCEPTION 'invalid_http_grant_context';END IF;
 SELECT w.owner_id INTO owner_id FROM public.workspaces w WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_grant_context';END IF;
 IF owner_id IS DISTINCT FROM p_actor_id THEN
  SELECT m.role,to_jsonb(m.allowed_sections) INTO member_role,sections FROM public.workspace_members m WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
  IF NOT FOUND OR member_role IS DISTINCT FROM 'admin' OR (sections IS NOT NULL AND (jsonb_typeof(sections)<>'array' OR NOT (sections ? '/ajustes') OR NOT (sections ? '/automatizaciones')))
  THEN RAISE EXCEPTION 'http_grant_admin_required';END IF;
 END IF;
 SELECT * INTO a FROM public.http_actions WHERE id=p_action_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_grant_context';END IF;
 IF p_operation='list' THEN
  RETURN jsonb_build_object('grants',COALESCE((SELECT jsonb_agg(to_jsonb(item)) FROM (
   SELECT agent_id,channel,context_scope,action_revision,revision,state,granted_by,updated_at FROM public.http_action_assistant_grants
   WHERE workspace_id=p_workspace_id AND action_id=p_action_id ORDER BY agent_id,channel LIMIT 100
  ) item),'[]'::jsonb));
 END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_agent_id IS NULL OR p_channel IS NULL OR p_channel NOT IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','webchat','voice','ig_comment','fb_comment')
 OR p_grant_revision IS NULL OR p_grant_revision<0 THEN RAISE EXCEPTION 'http_grant_invalid';END IF;
 -- Serialize the per-assistant/channel allowance before checking its budget.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('http-grant:'||p_workspace_id::text||':'||p_agent_id::text||':'||p_channel,0));
 SELECT * INTO g FROM public.http_action_assistant_grants WHERE workspace_id=p_workspace_id AND action_id=p_action_id AND agent_id=p_agent_id AND channel=p_channel FOR UPDATE;
 IF (FOUND AND g.revision<>p_grant_revision) OR (NOT FOUND AND p_grant_revision<>0) THEN RAISE EXCEPTION 'http_grant_changed';END IF;
 IF p_operation='withdraw' THEN
  IF g.agent_id IS NULL THEN RAISE EXCEPTION 'invalid_http_grant_context';END IF;
  IF g.state='active' THEN
   UPDATE public.http_action_assistant_grants SET state='withdrawn',revision=revision+1,granted_by=p_actor_id,updated_at=clock_timestamp()
   WHERE workspace_id=p_workspace_id AND action_id=p_action_id AND agent_id=p_agent_id AND channel=p_channel RETURNING * INTO g;
  END IF;
 ELSE
  IF p_context_scope IS NULL OR p_context_scope NOT IN ('contact','business') OR p_action_revision IS NULL OR p_action_revision<>a.revision
  THEN RAISE EXCEPTION 'http_grant_changed';END IF;
  SELECT scope::text INTO agent_scope FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_grant_context';END IF;
  IF agent_scope IS DISTINCT FROM 'workspace' AND NOT EXISTS(SELECT 1 FROM public.ai_agent_channels WHERE agent_id=p_agent_id AND channel::text=p_channel)
  THEN RAISE EXCEPTION 'http_grant_invalid';END IF;
  IF a.definition->>'method' IS NULL OR a.definition->>'method' NOT IN ('GET','POST') OR jsonb_typeof(a.definition->'parameters') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'http_grant_invalid';END IF;
  IF (p_context_scope='business' AND (a.definition->>'method'<>'GET' OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') field WHERE COALESCE(field->>'source','input')='input'
   ))) OR (p_context_scope='contact' AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(a.definition->'parameters') field WHERE field->>'source' IN ('contact_id','phone','email') AND field->>'required'='true' AND field->>'type'='string'
   )) THEN RAISE EXCEPTION 'http_grant_identity_required';END IF;
  IF (g.agent_id IS NULL OR g.state='withdrawn') AND (SELECT count(*) FROM public.http_action_assistant_grants WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id AND channel=p_channel AND state='active')>=12
  THEN RAISE EXCEPTION 'http_grant_limit';END IF;
  IF g.agent_id IS NULL AND (SELECT count(*) FROM public.http_action_assistant_grants WHERE workspace_id=p_workspace_id AND action_id=p_action_id)>=100
  THEN RAISE EXCEPTION 'http_grant_limit';END IF;
  INSERT INTO public.http_action_assistant_grants(workspace_id,action_id,agent_id,channel,context_scope,action_revision,revision,state,granted_by)
  VALUES(p_workspace_id,p_action_id,p_agent_id,p_channel,p_context_scope,p_action_revision,1,'active',p_actor_id)
  ON CONFLICT(workspace_id,action_id,agent_id,channel) DO UPDATE SET context_scope=EXCLUDED.context_scope,action_revision=EXCLUDED.action_revision,
   revision=public.http_action_assistant_grants.revision+1,state='active',granted_by=p_actor_id,updated_at=clock_timestamp() RETURNING * INTO g;
 END IF;
 RETURN jsonb_build_object('agent_id',g.agent_id,'channel',g.channel,'context_scope',g.context_scope,'action_revision',g.action_revision,
  'revision',g.revision,'state',g.state,'granted_by',g.granted_by,'updated_at',g.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.manage_http_action_assistant_grant(uuid,uuid,uuid,text,uuid,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_http_action_assistant_grant(uuid,uuid,uuid,text,uuid,text,text,integer,integer) TO service_role;

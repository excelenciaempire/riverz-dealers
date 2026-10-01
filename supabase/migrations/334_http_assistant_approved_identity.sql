-- Freeze the identity reviewed by the administrator, including current phone/email.
CREATE OR REPLACE FUNCTION public.claim_http_action_assistant(
 p_workspace_id uuid,p_agent_id uuid,p_action_id uuid,p_revision integer,p_channel text,p_grant_revision integer,
 p_invocation_key text,p_input_hash text,p_conversation_id uuid,p_context jsonb,p_parameters jsonb,
 p_approval_id uuid DEFAULT NULL,p_approval_actor_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.http_actions;g public.http_action_assistant_grants;agent record;c public.conversations;approval public.approval_requests;
 owner_id uuid;member_role text;sections jsonb;principal uuid;answer jsonb;r public.http_action_runs;key text;expected_tool text;
BEGIN
 IF p_context IS NULL THEN RAISE EXCEPTION 'invalid_http_assistant_approval_context';END IF;
 IF p_workspace_id IS NULL OR p_agent_id IS NULL OR p_action_id IS NULL OR p_conversation_id IS NULL
 OR p_revision IS NULL OR p_revision<1 OR p_grant_revision IS NULL OR p_grant_revision<1 OR p_channel IS NULL
 OR p_invocation_key IS NULL OR p_invocation_key !~ '^[0-9a-f]{64}$' OR p_input_hash IS NULL OR p_input_hash !~ '^[0-9a-f]{64}$'
 OR p_parameters IS NULL OR jsonb_typeof(p_parameters)<>'object' OR octet_length(p_parameters::text)>65536
 THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 SELECT w.owner_id INTO owner_id FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 SELECT * INTO a FROM public.http_actions WHERE workspace_id=p_workspace_id AND id=p_action_id AND state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 IF a.revision<>p_revision THEN RAISE EXCEPTION 'http_action_changed';END IF;
 SELECT * INTO g FROM public.http_action_assistant_grants WHERE workspace_id=p_workspace_id AND action_id=p_action_id AND agent_id=p_agent_id AND channel=p_channel AND state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_execution_forbidden';END IF;
 IF g.revision<>p_grant_revision OR g.action_revision<>p_revision THEN RAISE EXCEPTION 'http_action_changed';END IF;
 -- The grantor remains a permission principal, never the claimed performer.
 IF owner_id IS DISTINCT FROM g.granted_by THEN
  SELECT role,to_jsonb(allowed_sections) INTO member_role,sections FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=g.granted_by FOR SHARE;
  IF NOT FOUND OR member_role IS DISTINCT FROM 'admin' OR (sections IS NOT NULL AND (jsonb_typeof(sections)<>'array' OR NOT (sections ? '/ajustes') OR NOT (sections ? '/automatizaciones')))
  THEN RAISE EXCEPTION 'http_execution_forbidden';END IF;
 END IF;
 SELECT id,scope,is_active,assigned_only INTO agent FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT COALESCE(agent.is_active,false) THEN RAISE EXCEPTION 'http_execution_forbidden';END IF;
 IF agent.scope::text IS DISTINCT FROM 'workspace' AND NOT EXISTS(SELECT 1 FROM public.ai_agent_channels WHERE agent_id=p_agent_id AND channel::text=p_channel)
 THEN RAISE EXCEPTION 'http_execution_forbidden';END IF;
 SELECT * INTO c FROM public.conversations WHERE workspace_id=p_workspace_id AND id=p_conversation_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR c.channel::text IS DISTINCT FROM p_channel OR (c.assigned_ai_agent_id IS NOT NULL AND c.assigned_ai_agent_id<>p_agent_id)
 OR (COALESCE(agent.assigned_only,false) AND c.assigned_ai_agent_id IS DISTINCT FROM p_agent_id)
 THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 principal=g.granted_by;key=p_invocation_key;
 IF a.definition->>'method'='POST' THEN
  IF p_approval_id IS NULL OR p_approval_actor_id IS NULL THEN RAISE EXCEPTION 'http_execution_confirmation_required';END IF;
  IF g.context_scope<>'contact' THEN RAISE EXCEPTION 'http_execution_forbidden';END IF;
  SELECT * INTO approval FROM public.approval_requests WHERE id=p_approval_id AND workspace_id=p_workspace_id FOR SHARE;
  expected_tool='http_action_'||replace(p_action_id::text,'-','')||'_v'||p_revision::text;
  IF NOT FOUND OR approval.kind IS DISTINCT FROM 'herramienta' OR approval.status::text IS DISTINCT FROM 'aprobada'
  OR approval.decided_by::text IS DISTINCT FROM p_approval_actor_id::text OR approval.decided_at IS NULL
  OR approval.expires_at IS NULL OR approval.decided_at>=approval.expires_at OR approval.decided_at<clock_timestamp()-interval '5 minutes'
  OR approval.decided_at>clock_timestamp() OR approval.payload->>'tool' IS DISTINCT FROM expected_tool
  OR approval.payload->'input' IS DISTINCT FROM p_parameters
  OR approval.payload->'http_action_context' IS DISTINCT FROM p_context
  OR approval.payload->>'agent_id' IS DISTINCT FROM p_agent_id::text
  OR approval.payload->>'conversation_id' IS DISTINCT FROM p_conversation_id::text
  OR approval.payload->>'contact_id' IS DISTINCT FROM c.contact_id::text
  OR approval.payload->'http_action' IS DISTINCT FROM jsonb_build_object('action_id',p_action_id::text,'action_revision',p_revision,'grant_revision',p_grant_revision,'channel',p_channel)
  THEN RAISE EXCEPTION 'http_execution_confirmation_required';END IF;
  principal=p_approval_actor_id;
  -- One approved proposal cannot be reused under a fresh invocation key.
  SELECT * INTO r FROM public.http_action_runs WHERE workspace_id=p_workspace_id AND action_id=p_action_id AND source_kind='assistant' AND source_approval_id=p_approval_id;
  IF FOUND THEN key=r.invocation_key;END IF;
 ELSE
  IF a.definition->>'method' IS DISTINCT FROM 'GET' OR p_approval_id IS NOT NULL OR p_approval_actor_id IS NOT NULL
  THEN RAISE EXCEPTION 'invalid_http_execution_context';END IF;
 END IF;
 answer=public.claim_http_action(p_workspace_id,principal,p_action_id,p_revision,key,p_input_hash,a.definition->>'method'='POST',p_conversation_id,p_context);
 IF answer->>'claimed'='true' THEN
  UPDATE public.http_action_runs SET source_kind='assistant',source_agent_id=p_agent_id,source_channel=p_channel,
   source_grant_revision=p_grant_revision,source_approval_id=p_approval_id
  WHERE id=(answer->>'id')::uuid AND workspace_id=p_workspace_id AND state='claimed';
 ELSE
  SELECT * INTO r FROM public.http_action_runs WHERE id=(answer->>'id')::uuid AND workspace_id=p_workspace_id;
  IF NOT FOUND OR r.source_kind<>'assistant' OR r.source_agent_id IS DISTINCT FROM p_agent_id OR r.source_channel IS DISTINCT FROM p_channel
  OR r.source_grant_revision IS DISTINCT FROM p_grant_revision OR r.source_approval_id IS DISTINCT FROM p_approval_id
  THEN RAISE EXCEPTION 'http_execution_conflict';END IF;
 END IF;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.claim_http_action_assistant(uuid,uuid,uuid,integer,text,integer,text,text,uuid,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_http_action_assistant(uuid,uuid,uuid,integer,text,integer,text,text,uuid,jsonb,jsonb,uuid,uuid) TO service_role;

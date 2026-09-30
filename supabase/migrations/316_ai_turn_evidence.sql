CREATE TABLE IF NOT EXISTS public.ai_turn_evidence (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 inbound_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
 message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
 message_ids uuid[] NOT NULL DEFAULT '{}',
 agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
 status text NOT NULL CHECK(status IN ('sent','skipped','failed','unknown')),
 reason text,
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_turn_evidence_case ON public.ai_turn_evidence(workspace_id,conversation_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_turn_evidence_message ON public.ai_turn_evidence(workspace_id,message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_turn_evidence_messages ON public.ai_turn_evidence USING gin(message_ids);
ALTER TABLE public.ai_turn_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_turn_evidence FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_turn_evidence TO authenticated;
GRANT ALL ON public.ai_turn_evidence TO service_role;
DROP POLICY IF EXISTS ai_turn_evidence_read ON public.ai_turn_evidence;
CREATE POLICY ai_turn_evidence_read ON public.ai_turn_evidence FOR SELECT TO authenticated USING(
 public.is_workspace_member(workspace_id) AND EXISTS(SELECT 1 FROM public.conversations c
 WHERE c.id=conversation_id AND c.workspace_id=ai_turn_evidence.workspace_id AND c.deleted_at IS NULL
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc
 WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=auth.uid())))
);
CREATE OR REPLACE FUNCTION public.record_ai_turn_evidence(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_inbound_id uuid,p_message_id uuid,p_message_ids uuid[],p_agent_id uuid,p_status text,p_reason text,p_evidence jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.ai_turn_evidence;
BEGIN
 IF p_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND deleted_at IS NULL)
 OR p_status IS NULL OR p_status NOT IN ('sent','skipped','failed','unknown')
 OR p_reason IS NOT NULL AND p_reason!~'^[a-z0-9_]{1,100}$'
 OR p_agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id)
 OR p_inbound_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.messages WHERE id=p_inbound_id AND conversation_id=p_conversation_id AND deleted_at IS NULL)
 OR p_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.messages WHERE id=p_message_id AND conversation_id=p_conversation_id AND sender_type='bot' AND deleted_at IS NULL)
 OR p_message_ids IS NULL OR cardinality(p_message_ids)>100 OR EXISTS(SELECT 1 FROM unnest(p_message_ids) AS mid WHERE NOT EXISTS(SELECT 1 FROM public.messages WHERE id=mid AND conversation_id=p_conversation_id AND sender_type='bot' AND deleted_at IS NULL))
 THEN RAISE EXCEPTION 'invalid_ai_evidence';END IF;
 IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR (p_evidence-'version'-'rules'-'sources'-'tools'-'truncated')<>'{}'::jsonb
 OR p_evidence->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(p_evidence->'truncated') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_evidence->'rules') IS DISTINCT FROM 'array' OR jsonb_typeof(p_evidence->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(p_evidence->'tools') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_evidence->'rules')>50 OR jsonb_array_length(p_evidence->'sources')>100 OR jsonb_array_length(p_evidence->'tools')>100
 OR length(p_evidence::text)>60000 THEN RAISE EXCEPTION 'invalid_ai_evidence';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'rules') AS x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (x-'id'-'revision'-'title')<>'{}'::jsonb
 OR (x ?& array['id','revision','title']) IS DISTINCT FROM true
 OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR (x->>'id')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 OR jsonb_typeof(x->'title') IS DISTINCT FROM 'string' OR length(x->>'title')>120
 OR (x->'revision'<>'null'::jsonb AND (jsonb_typeof(x->'revision') IS DISTINCT FROM 'number' OR (x->>'revision')!~'^[1-9][0-9]*$')))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'sources') AS x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (x-'id'-'kind'-'title')<>'{}'::jsonb
 OR (x ?& array['id','kind']) IS DISTINCT FROM true OR jsonb_typeof(x->'kind') IS DISTINCT FROM 'string'
 OR (x->>'kind') NOT IN ('catalogue','message') OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR (x->>'id')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 OR (x ? 'title' AND (jsonb_typeof(x->'title') IS DISTINCT FROM 'string' OR length(x->>'title')>120)))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'tools') AS x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (x-'name'-'kind'-'status'-'sequence')<>'{}'::jsonb
 OR (x ?& array['name','kind','status','sequence']) IS DISTINCT FROM true OR jsonb_typeof(x->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'status') IS DISTINCT FROM 'string'
 OR jsonb_typeof(x->'name') IS DISTINCT FROM 'string' OR (x->>'name')!~'^[a-zA-Z0-9_]{1,80}$'
 OR (x->>'kind') NOT IN ('local','hosted') OR (x->>'status') NOT IN ('started','returned','reported_error','approval_requested','unverified','blocked','threw')
 OR jsonb_typeof(x->'sequence') IS DISTINCT FROM 'number' OR (x->>'sequence')!~'^[1-9][0-9]*$') THEN RAISE EXCEPTION 'invalid_ai_evidence';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'sources') AS x WHERE x->>'kind'='message' AND NOT EXISTS(SELECT 1 FROM public.messages WHERE id=(x->>'id')::uuid AND conversation_id=p_conversation_id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'sources') AS x WHERE x->>'kind'='catalogue' AND NOT EXISTS(SELECT 1 FROM public.shopify_products WHERE id=(x->>'id')::uuid AND workspace_id=p_workspace_id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'rules') AS x WHERE NOT EXISTS(SELECT 1 FROM public.agent_guidance WHERE id=(x->>'id')::uuid AND workspace_id=p_workspace_id)
 AND NOT EXISTS(SELECT 1 FROM public.guidance_live_versions WHERE rule_id=(x->>'id')::uuid AND workspace_id=p_workspace_id)) THEN RAISE EXCEPTION 'invalid_ai_evidence';END IF;
 SELECT * INTO prior FROM public.ai_turn_evidence WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.conversation_id IS DISTINCT FROM p_conversation_id OR prior.evidence IS DISTINCT FROM p_evidence
  OR prior.status IS DISTINCT FROM p_status OR prior.reason IS DISTINCT FROM p_reason OR prior.inbound_message_id IS DISTINCT FROM p_inbound_id
  OR prior.message_id IS DISTINCT FROM p_message_id OR prior.message_ids IS DISTINCT FROM p_message_ids OR prior.agent_id IS DISTINCT FROM p_agent_id THEN RAISE EXCEPTION 'ai_evidence_conflict';END IF;
  RETURN prior.id;
 END IF;
 INSERT INTO public.ai_turn_evidence(id,workspace_id,conversation_id,inbound_message_id,message_id,message_ids,agent_id,status,reason,evidence)
 VALUES(p_id,p_workspace_id,p_conversation_id,p_inbound_id,p_message_id,p_message_ids,p_agent_id,p_status,p_reason,p_evidence);
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.record_ai_turn_evidence(uuid,uuid,uuid,uuid,uuid,uuid[],uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_turn_evidence(uuid,uuid,uuid,uuid,uuid,uuid[],uuid,text,text,jsonb) TO service_role;

-- Context exposure is observable; application and resolution attribution are not inferred.
CREATE OR REPLACE FUNCTION public.ai_rule_context_metrics(p_workspace_id uuid,p_rule_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id)
 OR NOT EXISTS(SELECT 1 FROM public.agent_guidance WHERE id=p_rule_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'invalid_ai_evidence';END IF;
 SELECT jsonb_build_object('from_at',now()-interval '30 days','through_at',now(),'attribution','context_only',
  'recorded_turns',count(*),'distinct_cases',count(DISTINCT e.conversation_id),'failed_turns',count(*) FILTER(WHERE e.status='failed'),
  'approval_turns',count(*) FILTER(WHERE e.reason='awaiting_approval' OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.evidence->'tools') AS tool WHERE tool->>'status'='approval_requested')))
 INTO result FROM public.ai_turn_evidence e JOIN public.conversations c ON c.id=e.conversation_id AND c.workspace_id=e.workspace_id
 WHERE e.workspace_id=p_workspace_id AND e.created_at>=now()-interval '30 days' AND c.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.evidence->'rules') AS rule WHERE rule->>'id'=p_rule_id::text)
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=p_actor_id));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ai_rule_context_metrics(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_rule_context_metrics(uuid,uuid,uuid) TO service_role;

ALTER TABLE public.case_gap_answers ADD COLUMN IF NOT EXISTS question_snapshot text CHECK(length(question_snapshot) BETWEEN 1 AND 500);
-- No historical backfill: the question at the time of older answers is unknown.
CREATE OR REPLACE FUNCTION public.case_gap_answer_snapshot_before() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT g.question INTO NEW.question_snapshot FROM answer_gaps g WHERE g.id=NEW.gap_id AND g.workspace_id=NEW.workspace_id AND g.conversation_id=NEW.conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 ELSE
  IF (to_jsonb(NEW)-'actor_id') IS DISTINCT FROM (to_jsonb(OLD)-'actor_id') OR (NEW.actor_id IS NOT NULL AND NEW.actor_id IS DISTINCT FROM OLD.actor_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS case_gap_answer_snapshot_before ON public.case_gap_answers;
CREATE TRIGGER case_gap_answer_snapshot_before BEFORE INSERT OR UPDATE ON public.case_gap_answers FOR EACH ROW EXECUTE FUNCTION public.case_gap_answer_snapshot_before();
CREATE OR REPLACE FUNCTION public.case_gap_question_immutable_before() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.question IS DISTINCT FROM OLD.question OR NEW.question_key IS DISTINCT FROM OLD.question_key THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS case_gap_question_immutable_before ON public.answer_gaps;
CREATE TRIGGER case_gap_question_immutable_before BEFORE UPDATE OF question,question_key ON public.answer_gaps FOR EACH ROW EXECUTE FUNCTION public.case_gap_question_immutable_before();
REVOKE ALL ON FUNCTION public.case_gap_answer_snapshot_before(),public.case_gap_question_immutable_before() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_gap_answer_snapshot_before(),public.case_gap_question_immutable_before() TO service_role;

CREATE OR REPLACE FUNCTION public.load_case_gap_model_context(p_workspace_id uuid,p_conversation_id uuid,p_agent_id uuid)
RETURNS TABLE(id uuid,gap_id uuid,question text,answer text,revision integer,created_at timestamptz,actor_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ai_agents WHERE ai_agents.id=p_agent_id AND workspace_id=p_workspace_id AND is_active)
 OR NOT EXISTS(SELECT 1 FROM conversations c WHERE c.id=p_conversation_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM channel_connections cc JOIN workspace_members m ON m.workspace_id=cc.workspace_id AND m.user_id=cc.created_by WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id)))
 THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 RETURN QUERY SELECT a.id,a.gap_id,a.question_snapshot,a.answer,a.revision,a.created_at,a.actor_id FROM answer_gaps g
 JOIN LATERAL (SELECT ca.* FROM case_gap_answers ca WHERE ca.gap_id=g.id AND ca.workspace_id=g.workspace_id AND ca.conversation_id=g.conversation_id ORDER BY ca.revision DESC LIMIT 1) a ON true
 WHERE g.workspace_id=p_workspace_id AND g.conversation_id=p_conversation_id AND a.question_snapshot IS NOT NULL
 ORDER BY a.created_at DESC,a.id LIMIT 11;
END $$;
REVOKE ALL ON FUNCTION public.load_case_gap_model_context(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.load_case_gap_model_context(uuid,uuid,uuid) TO service_role;

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
 OR (x->>'kind') NOT IN ('catalogue','message','case_answer') OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR (x->>'id')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 OR (x ? 'title' AND (jsonb_typeof(x->'title') IS DISTINCT FROM 'string' OR length(x->>'title')>120)))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'tools') AS x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (x-'name'-'kind'-'status'-'sequence')<>'{}'::jsonb
 OR (x ?& array['name','kind','status','sequence']) IS DISTINCT FROM true OR jsonb_typeof(x->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'status') IS DISTINCT FROM 'string'
 OR jsonb_typeof(x->'name') IS DISTINCT FROM 'string' OR (x->>'name')!~'^[a-zA-Z0-9_]{1,80}$'
 OR (x->>'kind') NOT IN ('local','hosted') OR (x->>'status') NOT IN ('started','returned','reported_error','approval_requested','unverified','blocked','threw')
 OR jsonb_typeof(x->'sequence') IS DISTINCT FROM 'number' OR (x->>'sequence')!~'^[1-9][0-9]*$') THEN RAISE EXCEPTION 'invalid_ai_evidence';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'sources') AS x WHERE x->>'kind'='message' AND NOT EXISTS(SELECT 1 FROM public.messages WHERE id=(x->>'id')::uuid AND conversation_id=p_conversation_id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'sources') AS x WHERE x->>'kind'='catalogue' AND NOT EXISTS(SELECT 1 FROM public.shopify_products WHERE id=(x->>'id')::uuid AND workspace_id=p_workspace_id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'sources') AS x WHERE x->>'kind'='case_answer' AND NOT EXISTS(SELECT 1 FROM public.case_gap_answers WHERE id=(x->>'id')::uuid AND workspace_id=p_workspace_id AND conversation_id=p_conversation_id AND question_snapshot IS NOT NULL))
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


NOTIFY pgrst,'reload schema';

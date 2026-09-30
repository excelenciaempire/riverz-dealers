-- Replay records are private case evidence, not global rule knowledge or live replies.
CREATE TABLE IF NOT EXISTS public.guidance_test_runs (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 rule_id uuid REFERENCES public.agent_guidance(id) ON DELETE SET NULL,
 rule_ref uuid NOT NULL,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 live_revision integer NOT NULL,
 draft_revision integer NOT NULL,
 agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
 peer_revisions jsonb NOT NULL,
 source jsonb NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guidance_test_runs_rule ON public.guidance_test_runs(workspace_id,rule_ref,created_at DESC);
ALTER TABLE public.guidance_test_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guidance_test_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.guidance_test_runs TO authenticated;
GRANT ALL ON public.guidance_test_runs TO service_role;
DROP POLICY IF EXISTS guidance_test_runs_read ON public.guidance_test_runs;
CREATE POLICY guidance_test_runs_read ON public.guidance_test_runs FOR SELECT TO authenticated USING(
 public.is_workspace_member(workspace_id) AND EXISTS(SELECT 1 FROM public.conversations c
 WHERE c.id=conversation_id AND c.workspace_id=guidance_test_runs.workspace_id AND c.deleted_at IS NULL
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc
 WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=auth.uid())))
);
CREATE OR REPLACE FUNCTION public.record_guidance_test(p_id uuid,p_workspace_id uuid,p_rule_id uuid,p_conversation_id uuid,p_actor_id uuid,p_live_revision integer,p_draft_revision integer,p_agent_id uuid,p_agent_updated_at timestamptz,p_peer_revisions jsonb,p_source jsonb,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.agent_guidance;d public.guidance_drafts;peers jsonb;record public.guidance_test_runs;
BEGIN
 IF p_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id)
 OR NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=p_conversation_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=p_actor_id)))
 THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 SELECT * INTO r FROM public.agent_guidance WHERE id=p_rule_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 IF r.live_revision IS DISTINCT FROM p_live_revision OR p_draft_revision IS NULL OR p_draft_revision<0 THEN RAISE EXCEPTION 'guidance_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND is_active AND updated_at IS NOT DISTINCT FROM p_agent_updated_at)
 OR (r.agent_id IS NOT NULL AND r.agent_id IS DISTINCT FROM p_agent_id) THEN RAISE EXCEPTION 'guidance_changed';END IF;
 SELECT * INTO d FROM public.guidance_drafts WHERE rule_id=p_rule_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF p_draft_revision>0 AND (d.rule_id IS NULL OR d.base_revision IS DISTINCT FROM p_live_revision OR d.draft_revision IS DISTINCT FROM p_draft_revision) THEN RAISE EXCEPTION 'guidance_changed';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',live_revision) ORDER BY id),'[]'::jsonb) INTO peers
 FROM public.agent_guidance WHERE workspace_id=p_workspace_id AND activa AND id<>p_rule_id AND (agent_id IS NULL OR agent_id=p_agent_id);
 IF peers IS DISTINCT FROM p_peer_revisions OR jsonb_array_length(peers)>=50 THEN RAISE EXCEPTION 'guidance_changed';END IF;
 IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR length(p_result::text)>16000
 OR jsonb_typeof(p_result->'applies') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_result->'reply') IS DISTINCT FROM 'string'
 OR length(p_result->>'reply') NOT BETWEEN 1 AND 4000 OR jsonb_typeof(p_result->'summary') IS DISTINCT FROM 'string'
 OR length(p_result->>'summary') NOT BETWEEN 1 AND 1000 OR jsonb_typeof(p_result->'conflicts') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_result->'conflicts')>10 OR (p_result-'applies'-'reply'-'summary'-'conflicts')<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid_guidance_test';END IF;
 IF (p_source-'count'-'first_at'-'last_at'-'truncated'-'hash'-'observed_at'-'through_customer_turn')<>'{}'::jsonb
 OR jsonb_typeof(p_source->'count') IS DISTINCT FROM 'number' OR (p_source->>'count')!~'^[0-9]+$' OR (p_source->>'count')::integer NOT BETWEEN 1 AND 200
 OR jsonb_typeof(p_source->'hash') IS DISTINCT FROM 'string' OR (p_source->>'hash')!~'^[a-f0-9]{64}$'
 OR jsonb_typeof(p_source->'truncated') IS DISTINCT FROM 'boolean' OR p_source->'through_customer_turn' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(p_source->'observed_at') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_guidance_test';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'conflicts') AS x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
 OR (x-'rule_id'-'reason')<>'{}'::jsonb OR jsonb_typeof(x->'rule_id') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'reason') IS DISTINCT FROM 'string'
 OR length(trim(x->>'reason')) NOT BETWEEN 1 AND 400 OR NOT peers @> jsonb_build_array(jsonb_build_object('id',x->>'rule_id')))
 OR (SELECT count(*) FROM jsonb_array_elements(p_result->'conflicts'))<>(SELECT count(DISTINCT x->>'rule_id') FROM jsonb_array_elements(p_result->'conflicts') AS x)
 THEN RAISE EXCEPTION 'invalid_guidance_test';END IF;
 INSERT INTO public.guidance_test_runs(id,workspace_id,rule_id,rule_ref,conversation_id,actor_id,live_revision,draft_revision,agent_id,peer_revisions,source,result)
 VALUES(p_id,p_workspace_id,p_rule_id,p_rule_id,p_conversation_id,p_actor_id,p_live_revision,p_draft_revision,p_agent_id,peers,p_source,p_result) RETURNING * INTO record;
 IF p_draft_revision>0 THEN UPDATE public.guidance_drafts SET state='test' WHERE rule_id=p_rule_id;END IF;
 RETURN to_jsonb(record);
END $$;
REVOKE ALL ON FUNCTION public.record_guidance_test(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,timestamptz,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_guidance_test(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,timestamptz,jsonb,jsonb,jsonb) TO service_role;

-- Human answers scoped to ONE case. Does not publish FAQ/rules, close a gap,
-- change an AI handoff or send any customer/WhatsApp message.
CREATE TABLE IF NOT EXISTS public.case_gap_answers (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 gap_id uuid NOT NULL REFERENCES public.answer_gaps(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000001),
 answer text NOT NULL CHECK(length(trim(answer)) BETWEEN 2 AND 2000),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(gap_id,revision)
);
CREATE INDEX IF NOT EXISTS case_gap_answers_case ON public.case_gap_answers(workspace_id,conversation_id,created_at DESC);
ALTER TABLE public.case_gap_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_gap_answers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.case_gap_answers TO authenticated;
GRANT ALL ON public.case_gap_answers TO service_role;
DROP POLICY IF EXISTS case_gap_answers_read ON public.case_gap_answers;
CREATE POLICY case_gap_answers_read ON public.case_gap_answers FOR SELECT TO authenticated
 USING(public.gap_visible(workspace_id,auth.uid(),gap_id) AND EXISTS(
 SELECT 1 FROM public.answer_gaps g WHERE g.id=gap_id AND g.workspace_id=case_gap_answers.workspace_id AND g.conversation_id=case_gap_answers.conversation_id));

CREATE OR REPLACE FUNCTION public.list_case_gap_answers(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid)
RETURNS TABLE(gap_id uuid,question text,missing text,created_at timestamptz,answer text,revision integer,answered_at timestamptz,answered_by uuid,resolved_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_conversation_id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id)
 OR NOT EXISTS(SELECT 1 FROM conversations c WHERE c.id=p_conversation_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=p_actor_id)))
 THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 RETURN QUERY SELECT g.id,g.question,g.missing,g.created_at,a.answer,coalesce(a.revision,0),a.created_at,a.actor_id,g.resolved_at
 FROM answer_gaps g LEFT JOIN LATERAL (
 SELECT ca.answer,ca.revision,ca.created_at,ca.actor_id FROM case_gap_answers ca
 WHERE ca.gap_id=g.id AND ca.workspace_id=g.workspace_id AND ca.conversation_id=g.conversation_id ORDER BY ca.revision DESC LIMIT 1
 ) a ON true
 WHERE g.workspace_id=p_workspace_id AND g.conversation_id=p_conversation_id AND public.gap_visible(p_workspace_id,p_actor_id,g.id)
 ORDER BY g.created_at DESC,g.id LIMIT 51;
END $$;

CREATE OR REPLACE FUNCTION public.save_case_gap_answer(p_id uuid,p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_gap_id uuid,p_expected_revision integer,p_answer text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.case_gap_answers;current_revision integer;result public.case_gap_answers;
BEGIN
 IF p_id IS NULL OR p_conversation_id IS NULL OR p_gap_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 1000000
 OR p_answer IS NULL OR length(trim(p_answer)) NOT BETWEEN 2 AND 2000
 OR NOT public.gap_visible(p_workspace_id,p_actor_id,p_gap_id)
 OR NOT EXISTS(SELECT 1 FROM answer_gaps WHERE id=p_gap_id AND workspace_id=p_workspace_id AND conversation_id=p_conversation_id)
 THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 -- Serialize edits for the source. Deletions/reassignments cannot race the CAS.
 PERFORM 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id FOR SHARE;
 PERFORM 1 FROM answer_gaps WHERE id=p_gap_id FOR UPDATE;
 PERFORM 1 FROM conversations WHERE id=p_conversation_id FOR SHARE;
 PERFORM cc.id FROM channel_connections cc JOIN conversations c ON c.connection_id=cc.id WHERE c.id=p_conversation_id FOR SHARE OF cc;
 IF NOT public.gap_visible(p_workspace_id,p_actor_id,p_gap_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 SELECT * INTO prior FROM case_gap_answers WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.conversation_id IS DISTINCT FROM p_conversation_id OR prior.gap_id IS DISTINCT FROM p_gap_id
  OR prior.actor_id IS DISTINCT FROM p_actor_id OR prior.answer IS DISTINCT FROM trim(p_answer) OR prior.revision IS DISTINCT FROM p_expected_revision+1
  THEN RAISE EXCEPTION 'gap_changed';END IF;
  RETURN jsonb_build_object('ok',true,'id',prior.id,'revision',prior.revision,'answered_at',prior.created_at,'scope','case_only','replayed',true);
 END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF EXISTS(SELECT 1 FROM answer_gaps WHERE id=p_gap_id AND resolved_at IS NOT NULL) THEN RAISE EXCEPTION 'gap_changed';END IF;
 SELECT coalesce(max(revision),0) INTO current_revision FROM case_gap_answers WHERE gap_id=p_gap_id;
 IF current_revision<>p_expected_revision THEN RAISE EXCEPTION 'gap_changed';END IF;
 INSERT INTO case_gap_answers(id,workspace_id,conversation_id,gap_id,revision,answer,actor_id)
 VALUES(p_id,p_workspace_id,p_conversation_id,p_gap_id,current_revision+1,trim(p_answer),p_actor_id) RETURNING * INTO result;
 RETURN jsonb_build_object('ok',true,'id',result.id,'revision',result.revision,'answered_at',result.created_at,'scope','case_only','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.list_case_gap_answers(uuid,uuid,uuid),public.save_case_gap_answer(uuid,uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_case_gap_answers(uuid,uuid,uuid),public.save_case_gap_answer(uuid,uuid,uuid,uuid,uuid,integer,text) TO service_role;
NOTIFY pgrst,'reload schema';

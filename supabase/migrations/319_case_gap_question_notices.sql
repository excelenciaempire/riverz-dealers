-- Opt-in internal WhatsApp question notices. The transport stores only recipient
-- hashes and provider receipts, never customer text or recipient phone numbers.
CREATE TABLE IF NOT EXISTS public.case_gap_question_notices (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 gap_id uuid NOT NULL UNIQUE REFERENCES public.answer_gaps(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.case_gap_question_recipients (
 notice_id uuid NOT NULL REFERENCES public.case_gap_question_notices(id) ON DELETE CASCADE,
 recipient_hash text NOT NULL CHECK(recipient_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','rejected','uncertain','cancelled')),
 claim_id uuid,
 provider_message_id text CHECK(length(provider_message_id)<=500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(notice_id,recipient_hash)
);
CREATE INDEX IF NOT EXISTS case_gap_question_notices_workspace_time ON public.case_gap_question_notices(workspace_id,created_at DESC);
ALTER TABLE public.case_gap_question_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_gap_question_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_gap_question_notices,public.case_gap_question_recipients FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.case_gap_question_notices,public.case_gap_question_recipients TO service_role;

CREATE OR REPLACE FUNCTION public.case_gap_notice_status(p_workspace_id uuid,p_actor_id uuid,p_gap_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.case_gap_question_notices;counts jsonb;
BEGIN
 IF NOT public.gap_visible(p_workspace_id,p_actor_id,p_gap_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 SELECT * INTO n FROM case_gap_question_notices WHERE workspace_id=p_workspace_id AND gap_id=p_gap_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('pending',count(*) FILTER(WHERE state='pending'),'unconfirmed',count(*) FILTER(WHERE state IN ('sending','uncertain')),
 'accepted',count(*) FILTER(WHERE state='accepted'),'rejected',count(*) FILTER(WHERE state='rejected'),'cancelled',count(*) FILTER(WHERE state='cancelled'))
 INTO counts FROM case_gap_question_recipients WHERE notice_id=n.id;
 RETURN counts||jsonb_build_object('id',n.id,'created_at',n.created_at);
END $$;
CREATE OR REPLACE FUNCTION public.list_case_gap_notices(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 -- Reuse the case read's current-member, live-case and personal-mailbox checks.
 PERFORM 1 FROM public.list_case_gap_answers(p_workspace_id,p_actor_id,p_conversation_id);
 SELECT coalesce(jsonb_object_agg(n.gap_id::text,public.case_gap_notice_status(p_workspace_id,p_actor_id,n.gap_id)),'{}'::jsonb) INTO result
 FROM (SELECT gap_id FROM case_gap_question_notices WHERE workspace_id=p_workspace_id AND conversation_id=p_conversation_id
 AND public.gap_visible(p_workspace_id,p_actor_id,gap_id) ORDER BY created_at DESC,id LIMIT 51) n;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_case_gap_notice(p_id uuid,p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_gap_id uuid,p_recipient_hashes text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.case_gap_question_notices;
BEGIN
 IF p_id IS NULL OR p_conversation_id IS NULL OR p_gap_id IS NULL OR p_recipient_hashes IS NULL OR cardinality(p_recipient_hashes) NOT BETWEEN 1 AND 10
 OR EXISTS(SELECT 1 FROM unnest(p_recipient_hashes) AS h WHERE h IS NULL OR h !~ '^[a-f0-9]{64}$')
 OR cardinality(p_recipient_hashes)<>(SELECT count(DISTINCT h) FROM unnest(p_recipient_hashes) AS h)
 OR NOT public.gap_visible(p_workspace_id,p_actor_id,p_gap_id)
 OR NOT EXISTS(SELECT 1 FROM answer_gaps WHERE id=p_gap_id AND workspace_id=p_workspace_id AND conversation_id=p_conversation_id)
 THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 PERFORM 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id FOR UPDATE;
 PERFORM 1 FROM answer_gaps WHERE id=p_gap_id FOR UPDATE;
 PERFORM 1 FROM conversations WHERE id=p_conversation_id FOR SHARE;
 PERFORM cc.id FROM channel_connections cc JOIN conversations c ON c.connection_id=cc.id WHERE c.id=p_conversation_id FOR SHARE OF cc;
 IF NOT public.gap_visible(p_workspace_id,p_actor_id,p_gap_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 SELECT * INTO prior FROM case_gap_question_notices WHERE gap_id=p_gap_id;
 IF FOUND THEN
  RETURN jsonb_build_object('id',prior.id,'resumable',prior.id=p_id AND prior.actor_id=p_actor_id);
 END IF;
 IF EXISTS(SELECT 1 FROM case_gap_question_notices WHERE id=p_id) THEN RAISE EXCEPTION 'gap_changed';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF EXISTS(SELECT 1 FROM answer_gaps WHERE id=p_gap_id AND resolved_at IS NOT NULL) OR EXISTS(SELECT 1 FROM case_gap_answers WHERE gap_id=p_gap_id) THEN RAISE EXCEPTION 'gap_changed';END IF;
 IF (SELECT count(*) FROM case_gap_question_notices WHERE workspace_id=p_workspace_id AND created_at>clock_timestamp()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'gap_notice_limit';END IF;
 INSERT INTO case_gap_question_notices(id,workspace_id,conversation_id,gap_id,actor_id) VALUES(p_id,p_workspace_id,p_conversation_id,p_gap_id,p_actor_id);
 INSERT INTO case_gap_question_recipients(notice_id,recipient_hash) SELECT p_id,h FROM unnest(p_recipient_hashes) AS h;
 RETURN jsonb_build_object('id',p_id,'resumable',true);
END $$;

CREATE OR REPLACE FUNCTION public.claim_case_gap_notice(p_id uuid,p_workspace_id uuid,p_actor_id uuid,p_recipient_hash text,p_claim_id uuid,p_destination_current boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.case_gap_question_notices;s text;
BEGIN
 IF p_claim_id IS NULL THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 SELECT * INTO n FROM case_gap_question_notices WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id;
 IF NOT FOUND OR NOT public.gap_visible(p_workspace_id,p_actor_id,n.gap_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 PERFORM 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id FOR SHARE;
 PERFORM 1 FROM answer_gaps WHERE id=n.gap_id FOR UPDATE;
 PERFORM 1 FROM conversations WHERE id=n.conversation_id FOR SHARE;
 PERFORM cc.id FROM channel_connections cc JOIN conversations c ON c.connection_id=cc.id WHERE c.id=n.conversation_id FOR SHARE OF cc;
 IF NOT public.gap_visible(p_workspace_id,p_actor_id,n.gap_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 SELECT state INTO s FROM case_gap_question_recipients WHERE notice_id=p_id AND recipient_hash=p_recipient_hash FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 IF s<>'pending' THEN RETURN false;END IF;
 IF p_destination_current IS DISTINCT FROM true OR public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true
 OR EXISTS(SELECT 1 FROM answer_gaps WHERE id=n.gap_id AND resolved_at IS NOT NULL) OR EXISTS(SELECT 1 FROM case_gap_answers WHERE gap_id=n.gap_id) THEN
  UPDATE case_gap_question_recipients SET state='cancelled',updated_at=now() WHERE notice_id=p_id AND recipient_hash=p_recipient_hash;
  RETURN false;
 END IF;
 UPDATE case_gap_question_recipients SET state='sending',claim_id=p_claim_id,updated_at=now() WHERE notice_id=p_id AND recipient_hash=p_recipient_hash;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.finish_case_gap_notice(p_id uuid,p_recipient_hash text,p_claim_id uuid,p_state text,p_provider_message_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('accepted','rejected','uncertain') OR (p_state='accepted' AND coalesce(length(trim(p_provider_message_id)),0)=0)
 OR length(p_provider_message_id)>500 THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 UPDATE case_gap_question_recipients SET state=p_state,provider_message_id=CASE WHEN p_state='accepted' THEN p_provider_message_id ELSE NULL END,updated_at=now()
 WHERE notice_id=p_id AND recipient_hash=p_recipient_hash AND claim_id=p_claim_id AND state='sending';
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.case_gap_notice_status(uuid,uuid,uuid),public.list_case_gap_notices(uuid,uuid,uuid),public.reserve_case_gap_notice(uuid,uuid,uuid,uuid,uuid,text[]),public.claim_case_gap_notice(uuid,uuid,uuid,text,uuid,boolean),public.finish_case_gap_notice(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_gap_notice_status(uuid,uuid,uuid),public.list_case_gap_notices(uuid,uuid,uuid),public.reserve_case_gap_notice(uuid,uuid,uuid,uuid,uuid,text[]),public.claim_case_gap_notice(uuid,uuid,uuid,text,uuid,boolean),public.finish_case_gap_notice(uuid,text,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';

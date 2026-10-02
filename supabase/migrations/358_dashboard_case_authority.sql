-- Current report scope, including personal mailbox ownership, and atomic reviews.
CREATE FUNCTION public.dashboard_actor_allowed(p_workspace_id uuid,p_actor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_workspace_id IS NOT NULL AND p_actor_id IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND
 (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id
 AND m.role IN ('admin','agent') AND (m.allowed_sections IS NULL OR
 (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/panel' AND to_jsonb(m.allowed_sections) ? '/bandeja')))));
$$;
CREATE FUNCTION public.dashboard_case_allowed(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.dashboard_actor_allowed(p_workspace_id,p_actor_id) AND EXISTS(
 SELECT 1 FROM public.conversations c JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
 LEFT JOIN public.channel_connections cc ON cc.id=c.connection_id
 WHERE c.id=p_conversation_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL
 AND c.channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','webchat','voice','fb_comment','ig_comment','tiktok_comment','mercadolibre')
 AND (c.connection_id IS NULL OR cc.workspace_id=c.workspace_id AND cc.channel=c.channel)
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR cc.created_by=p_actor_id));
$$;
REVOKE ALL ON FUNCTION public.dashboard_actor_allowed(uuid,uuid),public.dashboard_case_allowed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_actor_allowed(uuid,uuid),public.dashboard_case_allowed(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.visible_dashboard_cases(p_workspace_id uuid,p_actor_id uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.dashboard_actor_allowed(p_workspace_id,p_actor_id) THEN RAISE EXCEPTION 'dashboard_forbidden';END IF;
 RETURN (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM (
 SELECT c.id FROM public.conversations c WHERE c.workspace_id=p_workspace_id AND (p_after IS NULL OR c.id>p_after)
 AND public.dashboard_case_allowed(p_workspace_id,p_actor_id,c.id) ORDER BY c.id LIMIT 1000) visible);
END $$;
REVOKE ALL ON FUNCTION public.visible_dashboard_cases(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visible_dashboard_cases(uuid,uuid,uuid) TO service_role;

-- Authenticated table reads use the signed-in identity, never a supplied actor.
CREATE FUNCTION public.can_read_dashboard_outcome(p_workspace_id uuid,p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.dashboard_case_allowed(p_workspace_id,auth.uid(),p_conversation_id);
$$;
REVOKE ALL ON FUNCTION public.can_read_dashboard_outcome(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_dashboard_outcome(uuid,uuid) TO authenticated,service_role;
DROP POLICY conversation_outcomes_read ON public.conversation_outcomes;
CREATE POLICY conversation_outcomes_read ON public.conversation_outcomes FOR SELECT TO authenticated
 USING (public.can_read_dashboard_outcome(workspace_id,conversation_id));

CREATE TABLE public.conversation_outcome_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 observed_message_id uuid NOT NULL,
 category text CHECK(category IN ('tracking','product','confirmation','address','return','other')),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_outcome_events_case ON public.conversation_outcome_events(workspace_id,conversation_id,created_at DESC,id DESC);
ALTER TABLE public.conversation_outcome_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_outcome_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.conversation_outcome_events TO service_role;

CREATE FUNCTION public.write_dashboard_outcome(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_last_message_id uuid,p_category text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_last uuid;current_case public.conversations;previous public.conversation_outcomes;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_conversation_id IS NULL OR p_last_message_id IS NULL
 OR p_category IS NOT NULL AND p_category NOT IN ('tracking','product','confirmation','address','return','other') THEN RAISE EXCEPTION 'invalid_dashboard_outcome';END IF;
 -- Locks also serialize case changes and new messages through the parent FK.
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR SHARE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 SELECT * INTO current_case FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR NOT public.dashboard_case_allowed(p_workspace_id,p_actor_id,p_conversation_id) THEN RAISE EXCEPTION 'dashboard_outcome_not_found';END IF;
 PERFORM 1 FROM public.contacts WHERE id=current_case.contact_id FOR SHARE;
 PERFORM 1 FROM public.channel_connections WHERE id=current_case.connection_id FOR SHARE;
 IF NOT public.dashboard_case_allowed(p_workspace_id,p_actor_id,p_conversation_id) THEN RAISE EXCEPTION 'dashboard_outcome_not_found';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 PERFORM 1 FROM public.messages WHERE conversation_id=p_conversation_id ORDER BY id FOR SHARE;
 SELECT id INTO current_last FROM public.messages WHERE conversation_id=p_conversation_id AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1;
 IF current_last IS DISTINCT FROM p_last_message_id THEN RAISE EXCEPTION 'dashboard_outcome_changed';END IF;
 IF p_category IS NOT NULL AND (current_case.needs_human_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=p_conversation_id AND deleted_at IS NULL AND sender_type='agent' AND status IS DISTINCT FROM 'failed')
 OR NOT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=p_conversation_id AND deleted_at IS NULL AND sender_type='customer')
 OR NOT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=p_conversation_id AND deleted_at IS NULL AND sender_type='bot'
 AND origin IN ('ai_agent','ai_followup','comment_ai','voice_agent') AND status IN ('sent','delivered','read'))) THEN RAISE EXCEPTION 'dashboard_outcome_changed';END IF;
 SELECT * INTO previous FROM public.conversation_outcomes WHERE conversation_id=p_conversation_id;
 IF p_category IS NULL AND previous.conversation_id IS NULL OR p_category IS NOT NULL AND previous.workspace_id=p_workspace_id
 AND previous.last_message_id=p_last_message_id AND previous.category=p_category AND previous.verified_by=p_actor_id THEN RETURN jsonb_build_object('ok',true);END IF;
 IF p_category IS NULL THEN
 DELETE FROM public.conversation_outcomes WHERE workspace_id=p_workspace_id AND conversation_id=p_conversation_id;
 ELSE
 INSERT INTO public.conversation_outcomes(conversation_id,workspace_id,last_message_id,category,verified_by,verified_at)
 VALUES(p_conversation_id,p_workspace_id,p_last_message_id,p_category,p_actor_id,now()) ON CONFLICT(conversation_id) DO UPDATE SET
 workspace_id=excluded.workspace_id,last_message_id=excluded.last_message_id,category=excluded.category,verified_by=excluded.verified_by,verified_at=excluded.verified_at;
 END IF;
 INSERT INTO public.conversation_outcome_events(workspace_id,conversation_id,observed_message_id,category,actor_id)
 VALUES(p_workspace_id,p_conversation_id,p_last_message_id,p_category,p_actor_id);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.write_dashboard_outcome(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_dashboard_outcome(uuid,uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.dashboard_case_authority_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT count(*)=4 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""']
 AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute'))
 FROM pg_catalog.pg_proc WHERE oid IN ('public.dashboard_actor_allowed(uuid,uuid)'::regprocedure,'public.dashboard_case_allowed(uuid,uuid,uuid)'::regprocedure,
 'public.visible_dashboard_cases(uuid,uuid,uuid)'::regprocedure,'public.write_dashboard_outcome(uuid,uuid,uuid,uuid,text)'::regprocedure))
 AND to_regclass('public.conversation_outcome_events_case') IS NOT NULL
 AND NOT has_table_privilege('authenticated','public.conversation_outcome_events','SELECT')
 AND NOT has_table_privilege('service_role','public.conversation_outcome_events','INSERT');
$$;
REVOKE ALL ON FUNCTION public.dashboard_case_authority_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_case_authority_ready() TO service_role;

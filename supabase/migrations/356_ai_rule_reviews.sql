-- Human assessments are distinct from context exposure, execution and business resolution.
CREATE TABLE public.ai_rule_reviews (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 turn_id uuid NOT NULL REFERENCES public.ai_turn_evidence(id) ON DELETE CASCADE,
 rule_id uuid NOT NULL, rule_revision integer NOT NULL CHECK(rule_revision>0),
 revision integer NOT NULL CHECK(revision>0),
 application text NOT NULL CHECK(application IN ('applied','missed','not_applicable','unverified')),
 transfer text NOT NULL CHECK(transfer IN ('related','unrelated','not_assessed')),
 note text NOT NULL CHECK(length(note)<=600),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 actor_name text CHECK(length(actor_name)<=120), changed_at timestamptz NOT NULL,
 PRIMARY KEY(turn_id,rule_id)
);
CREATE TABLE public.ai_rule_review_events (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 turn_id uuid NOT NULL REFERENCES public.ai_turn_evidence(id) ON DELETE CASCADE,
 rule_id uuid NOT NULL, rule_revision integer NOT NULL, revision integer NOT NULL,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 actor_name text, expected_revision integer NOT NULL, decision jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(turn_id,rule_id,revision)
);
CREATE INDEX ai_rule_reviews_rule ON public.ai_rule_reviews(workspace_id,rule_id,turn_id);
ALTER TABLE public.ai_rule_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_rule_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_rule_reviews,public.ai_rule_review_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ai_rule_review_actor_access(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_write boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspaces w JOIN public.conversations c ON c.workspace_id=w.id
 JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND c.id=p_conversation_id AND c.deleted_at IS NULL
 AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id
 AND m.role IN ('admin','agent') AND (NOT p_write OR m.role='admin') AND (m.allowed_sections IS NULL OR
 (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/bandeja' AND to_jsonb(m.allowed_sections) ? '/asistente'))))
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id
 AND cc.workspace_id=w.id AND cc.channel=c.channel AND cc.created_by=p_actor_id)));
$$;
CREATE FUNCTION public.read_ai_rule_review(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_turn_id uuid,p_rule_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ai_turn_evidence;v public.guidance_live_versions;r public.ai_rule_reviews;rule_rev integer;review jsonb;observed_count integer;history jsonb;truncated boolean;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_conversation_id IS NULL OR p_turn_id IS NULL OR p_rule_id IS NULL THEN RAISE EXCEPTION 'invalid_rule_review';END IF;
 IF NOT public.ai_rule_review_actor_access(p_workspace_id,p_actor_id,p_conversation_id,false) THEN RAISE EXCEPTION 'rule_review_not_found';END IF;
 SELECT * INTO e FROM public.ai_turn_evidence WHERE id=p_turn_id AND workspace_id=p_workspace_id AND conversation_id=p_conversation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rule_review_not_found';END IF;
 SELECT count(*),min(CASE WHEN (observed->>'revision') ~ '^[1-9][0-9]{0,9}$' THEN
 CASE WHEN (observed->>'revision')::numeric<=2147483647 THEN (observed->>'revision')::integer END END)
 INTO observed_count,rule_rev FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.evidence->'rules')='array' THEN e.evidence->'rules' ELSE '[]'::jsonb END) observed
 WHERE observed->>'id'=p_rule_id::text;
 IF observed_count<>1 OR rule_rev IS NULL THEN RAISE EXCEPTION 'rule_review_unavailable';END IF;
 SELECT * INTO v FROM public.guidance_live_versions WHERE workspace_id=p_workspace_id AND rule_id=p_rule_id AND revision=rule_rev
 AND snapshot->'activa'='true'::jsonb AND coalesce(snapshot->'deleted','false'::jsonb)='false'::jsonb;
 IF NOT FOUND THEN RAISE EXCEPTION 'rule_review_unavailable';END IF;
 -- At least one actual source/output message must remain inspectable in this case.
 IF NOT EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
 AND (m.id=e.inbound_message_id OR m.id=e.message_id OR m.id=ANY(e.message_ids))) THEN RAISE EXCEPTION 'rule_review_unavailable';END IF;
 SELECT * INTO r FROM public.ai_rule_reviews WHERE turn_id=p_turn_id AND rule_id=p_rule_id AND workspace_id=p_workspace_id;
 IF FOUND THEN review=jsonb_build_object('revision',r.revision,'application',r.application,'transfer',r.transfer,'note',r.note,
 'actor_id',r.actor_id,'actor_name',r.actor_name,'changed_at',r.changed_at);END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'revision',h.revision,'application',h.decision->>'application','transfer',h.decision->>'transfer',
 'note',h.decision->>'note','actor_id',h.actor_id,'actor_name',h.actor_name,'changed_at',h.created_at) ORDER BY h.revision DESC),'[]'::jsonb)
 INTO history FROM (SELECT * FROM public.ai_rule_review_events WHERE workspace_id=p_workspace_id AND turn_id=p_turn_id AND rule_id=p_rule_id ORDER BY revision DESC LIMIT 20) h;
 SELECT count(*)>20 INTO truncated FROM public.ai_rule_review_events WHERE workspace_id=p_workspace_id AND turn_id=p_turn_id AND rule_id=p_rule_id;
 RETURN jsonb_build_object('turn_id',e.id,'rule_id',p_rule_id,'rule_revision',rule_rev,
 'rule',jsonb_build_object('titulo',v.snapshot->>'titulo','cuando',v.snapshot->>'cuando','hacer',v.snapshot->>'hacer'),
 'review',review,'history',history,'history_truncated',truncated,'can_edit',public.ai_rule_review_actor_access(p_workspace_id,p_actor_id,p_conversation_id,true)
 AND public.workspace_billing_write_allowed(p_workspace_id) IS TRUE,'attribution','team_assessment');
END $$;
CREATE FUNCTION public.write_ai_rule_review(p_id uuid,p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_turn_id uuid,p_rule_id uuid,p_expected_revision integer,p_decision jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;prior public.ai_rule_review_events;current_review public.ai_rule_reviews;saved public.ai_rule_review_events;revision_now integer;who text;answer jsonb;
BEGIN
 IF p_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 2147483646 OR p_decision IS NULL
 OR jsonb_typeof(p_decision)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_decision) key) IS DISTINCT FROM ARRAY['application','confirmed','note','transfer']::text[]
 OR p_decision->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p_decision->>'application' IS NULL OR p_decision->>'application' NOT IN ('applied','missed','not_applicable','unverified')
 OR p_decision->>'transfer' IS NULL OR p_decision->>'transfer' NOT IN ('related','unrelated','not_assessed') OR jsonb_typeof(p_decision->'note') IS DISTINCT FROM 'string'
 OR length(p_decision->>'note')>600 OR (p_decision->>'note') IS DISTINCT FROM btrim(p_decision->>'note')
 OR ((p_decision->>'application'='missed' OR p_decision->>'transfer'='related') AND length(p_decision->>'note')<10)
 OR (p_decision->>'application'='not_applicable' AND p_decision->>'transfer'='related') THEN RAISE EXCEPTION 'invalid_rule_review';END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 PERFORM 1 FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id FOR SHARE;
 PERFORM 1 FROM public.channel_connections cc JOIN public.conversations c ON c.connection_id=cc.id WHERE c.id=p_conversation_id AND cc.workspace_id=p_workspace_id FOR SHARE OF cc;
 PERFORM 1 FROM public.contacts ct JOIN public.conversations c ON c.contact_id=ct.id WHERE c.id=p_conversation_id AND ct.workspace_id=p_workspace_id FOR SHARE OF ct;
 PERFORM 1 FROM public.ai_turn_evidence WHERE id=p_turn_id AND workspace_id=p_workspace_id FOR UPDATE;
 PERFORM 1 FROM public.messages m JOIN public.ai_turn_evidence e ON e.id=p_turn_id AND e.workspace_id=p_workspace_id
 WHERE m.conversation_id=p_conversation_id AND (m.id=e.inbound_message_id OR m.id=e.message_id OR m.id=ANY(e.message_ids)) FOR SHARE OF m;
 ctx=public.read_ai_rule_review(p_workspace_id,p_actor_id,p_conversation_id,p_turn_id,p_rule_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 SELECT * INTO prior FROM public.ai_rule_review_events WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.conversation_id IS DISTINCT FROM p_conversation_id OR prior.turn_id IS DISTINCT FROM p_turn_id
  OR prior.rule_id IS DISTINCT FROM p_rule_id OR prior.actor_id IS DISTINCT FROM p_actor_id OR prior.expected_revision IS DISTINCT FROM p_expected_revision
  OR prior.decision IS DISTINCT FROM p_decision THEN RAISE EXCEPTION 'rule_review_changed';END IF;
  saved=prior;
 ELSE
  IF NOT public.ai_rule_review_actor_access(p_workspace_id,p_actor_id,p_conversation_id,true) THEN RAISE EXCEPTION 'rule_review_forbidden';END IF;
  IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
  SELECT * INTO current_review FROM public.ai_rule_reviews WHERE workspace_id=p_workspace_id AND turn_id=p_turn_id AND rule_id=p_rule_id FOR UPDATE;
  revision_now=coalesce(current_review.revision,0);
  IF revision_now<>p_expected_revision THEN RAISE EXCEPTION 'rule_review_changed';END IF;
  IF revision_now>=500 THEN RAISE EXCEPTION 'rule_review_limit';END IF;
  SELECT left(full_name,120) INTO who FROM public.profiles WHERE user_id=p_actor_id;
  INSERT INTO public.ai_rule_review_events(id,workspace_id,conversation_id,turn_id,rule_id,rule_revision,revision,actor_id,actor_name,expected_revision,decision)
  VALUES(p_id,p_workspace_id,p_conversation_id,p_turn_id,p_rule_id,(ctx->>'rule_revision')::integer,revision_now+1,p_actor_id,who,p_expected_revision,p_decision) RETURNING * INTO saved;
  INSERT INTO public.ai_rule_reviews(workspace_id,conversation_id,turn_id,rule_id,rule_revision,revision,application,transfer,note,actor_id,actor_name,changed_at)
  VALUES(p_workspace_id,p_conversation_id,p_turn_id,p_rule_id,saved.rule_revision,saved.revision,p_decision->>'application',p_decision->>'transfer',p_decision->>'note',p_actor_id,who,saved.created_at)
  ON CONFLICT(turn_id,rule_id) DO UPDATE SET revision=EXCLUDED.revision,application=EXCLUDED.application,transfer=EXCLUDED.transfer,note=EXCLUDED.note,
  actor_id=EXCLUDED.actor_id,actor_name=EXCLUDED.actor_name,changed_at=EXCLUDED.changed_at;
 END IF;
 answer=jsonb_build_object('revision',saved.revision,'application',saved.decision->>'application','transfer',saved.decision->>'transfer','note',saved.decision->>'note',
 'actor_id',saved.actor_id,'actor_name',saved.actor_name,'changed_at',saved.created_at);
 RETURN jsonb_build_object('id',saved.id,'turn_id',saved.turn_id,'rule_id',saved.rule_id,'review',answer,'attribution','team_assessment');
END $$;
CREATE FUNCTION public.ai_rule_review_metrics(p_workspace_id uuid,p_rule_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_rule_id IS NULL OR p_actor_id IS NULL THEN RAISE EXCEPTION 'invalid_rule_review';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND (w.owner_id=p_actor_id OR EXISTS(
 SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent')
 AND (m.allowed_sections IS NULL OR (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/asistente' AND to_jsonb(m.allowed_sections) ? '/bandeja')))))
 OR NOT EXISTS(SELECT 1 FROM public.guidance_live_versions WHERE workspace_id=p_workspace_id AND rule_id=p_rule_id) THEN RAISE EXCEPTION 'rule_review_not_found';END IF;
 SELECT jsonb_build_object('attribution','team_assessment','reviewed_turns',count(*),'applied_turns',count(*) FILTER(WHERE r.application='applied'),
 'missed_turns',count(*) FILTER(WHERE r.application='missed'),'not_applicable_turns',count(*) FILTER(WHERE r.application='not_applicable'),
 'unverified_turns',count(*) FILTER(WHERE r.application='unverified'),'eligible_turns',count(*) FILTER(WHERE r.application IN ('applied','missed')),
 'related_transfer_turns',count(*) FILTER(WHERE r.transfer='related'),'assessed_transfer_turns',count(*) FILTER(WHERE r.transfer<>'not_assessed'),
 'distinct_reviewed_cases',count(DISTINCT r.conversation_id),'application_rate',round(100.0*(count(*) FILTER(WHERE r.application='applied'))/
 nullif(count(*) FILTER(WHERE r.application IN ('applied','missed')),0),1)) INTO result
 FROM public.ai_rule_reviews r JOIN public.ai_turn_evidence e ON e.id=r.turn_id AND e.workspace_id=r.workspace_id AND e.conversation_id=r.conversation_id
 WHERE r.workspace_id=p_workspace_id AND r.rule_id=p_rule_id AND e.created_at>=statement_timestamp()-interval '30 days'
 AND public.ai_rule_review_actor_access(p_workspace_id,p_actor_id,r.conversation_id,false)
 AND EXISTS(SELECT 1 FROM public.guidance_live_versions v WHERE v.workspace_id=r.workspace_id AND v.rule_id=r.rule_id AND v.revision=r.rule_revision
 AND v.snapshot->'activa'='true'::jsonb AND coalesce(v.snapshot->'deleted','false'::jsonb)='false'::jsonb)
 AND EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=r.conversation_id AND m.deleted_at IS NULL
 AND (m.id=e.inbound_message_id OR m.id=e.message_id OR m.id=ANY(e.message_ids)));
 RETURN result;
END $$;
-- Preserve the existing exposure counters, enforcing the same current source privacy.
CREATE OR REPLACE FUNCTION public.ai_rule_context_metrics(p_workspace_id uuid,p_rule_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_rule_id IS NULL OR p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspaces w
 WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m
 WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent') AND (m.allowed_sections IS NULL OR
 (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/asistente' AND to_jsonb(m.allowed_sections) ? '/bandeja')))))
 OR NOT EXISTS(SELECT 1 FROM public.agent_guidance g WHERE g.id=p_rule_id AND g.workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'invalid_ai_evidence';END IF;
 SELECT jsonb_build_object('from_at',statement_timestamp()-interval '30 days','through_at',statement_timestamp(),'attribution','context_only',
 'recorded_turns',count(*),'distinct_cases',count(DISTINCT e.conversation_id),'failed_turns',count(*) FILTER(WHERE e.status='failed'),
 'approval_turns',count(*) FILTER(WHERE e.reason='awaiting_approval' OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.evidence->'tools') tool WHERE tool->>'status'='approval_requested')))
 INTO result FROM public.ai_turn_evidence e WHERE e.workspace_id=p_workspace_id AND e.created_at>=statement_timestamp()-interval '30 days'
 AND public.ai_rule_review_actor_access(p_workspace_id,p_actor_id,e.conversation_id,false)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.evidence->'rules') rule WHERE rule->>'id'=p_rule_id::text)
 AND EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=e.conversation_id AND m.deleted_at IS NULL
 AND (m.id=e.inbound_message_id OR m.id=e.message_id OR m.id=ANY(e.message_ids)));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ai_rule_context_metrics(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_rule_context_metrics(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ai_rule_review_actor_access(uuid,uuid,uuid,boolean),public.read_ai_rule_review(uuid,uuid,uuid,uuid,uuid),
 public.write_ai_rule_review(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb),public.ai_rule_review_metrics(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_rule_review_actor_access(uuid,uuid,uuid,boolean),public.read_ai_rule_review(uuid,uuid,uuid,uuid,uuid),
 public.write_ai_rule_review(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb),public.ai_rule_review_metrics(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.ai_rule_review_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT count(*)=2 AND bool_and(relrowsecurity AND NOT has_table_privilege('anon',oid,'select,insert,update,delete')
 AND NOT has_table_privilege('authenticated',oid,'select,insert,update,delete') AND NOT has_table_privilege('service_role',oid,'select,insert,update,delete'))
 FROM pg_catalog.pg_class WHERE oid IN ('public.ai_rule_reviews'::regclass,'public.ai_rule_review_events'::regclass))
 AND (SELECT count(*)=5 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute')
 AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute'))
 FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('ai_rule_review_actor_access','read_ai_rule_review','write_ai_rule_review','ai_rule_review_metrics','ai_rule_context_metrics'));
$$;
REVOKE ALL ON FUNCTION public.ai_rule_review_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_rule_review_ready() TO service_role;

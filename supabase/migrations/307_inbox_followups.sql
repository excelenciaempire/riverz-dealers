-- Human follow-up stays inside Riverz. No outbound customer messages or money.
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS snoozed_at timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS snoozed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS snooze_id uuid;
CREATE INDEX IF NOT EXISTS conversations_due_snooze ON public.conversations(snoozed_until) WHERE snoozed_until IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.workspace_notifications ALTER COLUMN note_id DROP NOT NULL;
ALTER TABLE public.workspace_notifications ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'mention' CHECK (kind IN ('mention','reminder','snooze'));
ALTER TABLE public.workspace_notifications ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE public.workspace_notifications ADD COLUMN IF NOT EXISTS body text;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_notifications_source ON public.workspace_notifications(workspace_id,user_id,kind,source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inbox_reminders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS inbox_reminders_due ON public.inbox_reminders(due_at) WHERE status='pending';
ALTER TABLE public.inbox_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_reminders FROM anon, authenticated;
GRANT SELECT ON public.inbox_reminders TO authenticated;
GRANT ALL ON public.inbox_reminders TO service_role;
DROP POLICY IF EXISTS inbox_reminders_read ON public.inbox_reminders;
CREATE POLICY inbox_reminders_read ON public.inbox_reminders FOR SELECT TO authenticated USING (
  user_id=auth.uid() AND public.is_workspace_member(workspace_id)
  AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND c.deleted_at IS NULL
    AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=auth.uid()))));

CREATE TABLE IF NOT EXISTS public.inbox_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.inbox_team_members (
  team_id uuid NOT NULL REFERENCES public.inbox_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.inbox_agent_state (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  available boolean NOT NULL DEFAULT true,
  capacity integer NOT NULL DEFAULT 20 CHECK (capacity BETWEEN 1 AND 500),
  last_assigned_at timestamptz,
  PRIMARY KEY(workspace_id,user_id)
);
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS assigned_team_id uuid REFERENCES public.inbox_teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_inbox_agent_load ON public.conversations(workspace_id,assigned_agent_id) WHERE deleted_at IS NULL AND status<>'closed';
CREATE INDEX IF NOT EXISTS conversations_inbox_team_queue ON public.conversations(workspace_id,id) WHERE deleted_at IS NULL AND status<>'closed' AND assigned_agent_id IS NULL AND assigned_team_id IS NOT NULL;
ALTER TABLE public.inbox_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_agent_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_teams, public.inbox_team_members, public.inbox_agent_state FROM anon, authenticated;
GRANT SELECT ON public.inbox_teams, public.inbox_team_members, public.inbox_agent_state TO authenticated;
GRANT ALL ON public.inbox_teams, public.inbox_team_members, public.inbox_agent_state TO service_role;
DROP POLICY IF EXISTS inbox_teams_read ON public.inbox_teams;
CREATE POLICY inbox_teams_read ON public.inbox_teams FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS inbox_team_members_read ON public.inbox_team_members;
CREATE POLICY inbox_team_members_read ON public.inbox_team_members FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.inbox_teams t WHERE t.id=team_id AND public.is_workspace_member(t.workspace_id)));
DROP POLICY IF EXISTS inbox_agent_state_read ON public.inbox_agent_state;
CREATE POLICY inbox_agent_state_read ON public.inbox_agent_state FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));

CREATE TABLE IF NOT EXISTS public.inbox_macros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
  actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array' AND jsonb_array_length(actions) BETWEEN 1 AND 10),
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inbox_macros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_macros FROM anon, authenticated;
GRANT SELECT ON public.inbox_macros TO authenticated;
GRANT ALL ON public.inbox_macros TO service_role;
DROP POLICY IF EXISTS inbox_macros_read ON public.inbox_macros;
CREATE POLICY inbox_macros_read ON public.inbox_macros FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));

CREATE TABLE IF NOT EXISTS public.inbox_action_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  macro_id uuid REFERENCES public.inbox_macros(id) ON DELETE SET NULL,
  macro_version integer,
  actions jsonb NOT NULL,
  result jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inbox_action_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_action_runs FROM anon, authenticated;
GRANT SELECT ON public.inbox_action_runs TO authenticated;
GRANT ALL ON public.inbox_action_runs TO service_role;
DROP POLICY IF EXISTS inbox_action_runs_read ON public.inbox_action_runs;
CREATE POLICY inbox_action_runs_read ON public.inbox_action_runs FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id)
  -- Original reminder bodies are saved for idempotency. They stay private even
  -- if a client requests this table directly instead of the redacted API.
  AND (actor_id=auth.uid() OR NOT actions @> '[{"type":"reminder"}]'::jsonb)
  AND EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND c.deleted_at IS NULL
    AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=auth.uid()))));

-- Same lock for manual, rule-based and macro assignment. A capacity check and
-- its update are one transaction, so competing requests cannot overbook.
CREATE OR REPLACE FUNCTION public.assign_inbox_case(p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid,p_candidates uuid[],p_team_id uuid DEFAULT NULL,p_replace boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.conversations; chosen uuid; candidates uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inbox-assignment:'||p_workspace_id::text,0));
  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR (p_actor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id))
    OR (p_replace AND p_actor_id IS NULL)
    OR (p_actor_id IS NOT NULL AND c.channel IN ('gmail','outlook','zoho') AND NOT EXISTS(SELECT 1 FROM public.channel_connections WHERE id=c.connection_id AND created_by=p_actor_id))
  THEN RAISE EXCEPTION 'invalid_case_context'; END IF;
  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.inbox_teams WHERE id=p_team_id AND workspace_id=p_workspace_id AND enabled) THEN RAISE EXCEPTION 'invalid_inbox_team'; END IF;
    SELECT coalesce(array_agg(user_id),'{}'::uuid[]) INTO candidates FROM public.inbox_team_members WHERE team_id=p_team_id;
  ELSE candidates:=p_candidates; END IF;
  IF c.assigned_agent_id IS NOT NULL AND NOT p_replace AND EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=c.assigned_agent_id) THEN
    RETURN jsonb_build_object('agent_id',c.assigned_agent_id,'outcome','already_assigned');
  END IF;
  SELECT m.user_id INTO chosen FROM public.workspace_members m
    LEFT JOIN public.inbox_agent_state s ON s.workspace_id=m.workspace_id AND s.user_id=m.user_id
    CROSS JOIN LATERAL(SELECT count(*) AS active FROM public.conversations a WHERE a.workspace_id=p_workspace_id AND a.assigned_agent_id=m.user_id
      AND a.id<>p_conversation_id AND a.deleted_at IS NULL AND a.status<>'closed' AND (a.snoozed_until IS NULL OR a.snoozed_until<=now())) load
    WHERE m.workspace_id=p_workspace_id AND (candidates IS NULL OR m.user_id=ANY(candidates)) AND coalesce(s.enabled,true) AND coalesce(s.available,true)
      AND load.active<coalesce(s.capacity,20)
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections WHERE id=c.connection_id AND created_by=m.user_id))
    ORDER BY load.active,s.last_assigned_at NULLS FIRST,m.user_id LIMIT 1;
  IF chosen IS NULL THEN
    -- Keep a valid existing owner; otherwise retain an explicit team queue.
    IF p_team_id IS NOT NULL THEN UPDATE public.conversations SET assigned_team_id=p_team_id WHERE id=c.id; END IF;
    RETURN jsonb_build_object('agent_id',c.assigned_agent_id,'outcome','waiting');
  END IF;
  INSERT INTO public.inbox_agent_state(workspace_id,user_id,last_assigned_at) VALUES(p_workspace_id,chosen,now())
    ON CONFLICT(workspace_id,user_id) DO UPDATE SET last_assigned_at=EXCLUDED.last_assigned_at;
  UPDATE public.conversations SET assigned_agent_id=chosen,assigned_team_id=p_team_id WHERE id=c.id;
  RETURN jsonb_build_object('agent_id',chosen,'outcome','assigned');
END $$;
REVOKE ALL ON FUNCTION public.assign_inbox_case(uuid,uuid,uuid,uuid[],uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_inbox_case(uuid,uuid,uuid,uuid[],uuid,boolean) TO service_role;

-- Read candidates without holding a row lock, then acquire locks in the same
-- workspace-before-case order as manual assignment. Rechecks inside the RPC.
CREATE OR REPLACE FUNCTION public.dispatch_waiting_inbox_cases(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; current_case public.conversations; outcome jsonb; assigned integer:=0;
BEGIN
  FOR c IN SELECT id,workspace_id,assigned_team_id FROM public.conversations
    WHERE deleted_at IS NULL AND status<>'closed' AND assigned_agent_id IS NULL AND assigned_team_id IS NOT NULL
      AND (snoozed_until IS NULL OR snoozed_until<=now())
    ORDER BY workspace_id,id LIMIT greatest(1,least(p_limit,500)) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('inbox-assignment:'||c.workspace_id::text,0));
    SELECT * INTO current_case FROM public.conversations WHERE id=c.id AND workspace_id=c.workspace_id
      AND deleted_at IS NULL AND status<>'closed' AND assigned_agent_id IS NULL AND assigned_team_id IS NOT NULL
      AND (snoozed_until IS NULL OR snoozed_until<=now()) FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    -- A disabled team remains visible in the queue; it must not break the worker.
    IF EXISTS(SELECT 1 FROM public.inbox_teams WHERE id=current_case.assigned_team_id AND workspace_id=c.workspace_id AND enabled) THEN
      outcome:=public.assign_inbox_case(c.workspace_id,c.id,NULL,NULL,current_case.assigned_team_id,false);
      IF outcome->>'outcome'='assigned' THEN assigned:=assigned+1; END IF;
    END IF;
  END LOOP;
  RETURN assigned;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_waiting_inbox_cases(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_waiting_inbox_cases(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.configure_inbox_team(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_name text,p_enabled boolean,p_members uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('admin','owner'))
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_members IS NULL OR cardinality(p_members)>100
    OR EXISTS(SELECT 1 FROM unnest(p_members) u WHERE NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=u))
    OR EXISTS(SELECT 1 FROM public.inbox_teams WHERE id=p_id AND workspace_id<>p_workspace_id)
  THEN RAISE EXCEPTION 'invalid_inbox_team'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inbox-assignment:'||p_workspace_id::text,0));
  INSERT INTO public.inbox_teams(id,workspace_id,name,enabled) VALUES(p_id,p_workspace_id,btrim(p_name),p_enabled)
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,enabled=EXCLUDED.enabled;
  DELETE FROM public.inbox_team_members WHERE team_id=p_id;
  INSERT INTO public.inbox_team_members(team_id,user_id) SELECT p_id,u FROM (SELECT DISTINCT unnest(p_members) AS u) members;
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.configure_inbox_team(uuid,uuid,uuid,text,boolean,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_inbox_team(uuid,uuid,uuid,text,boolean,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.update_inbox_agent_state(p_workspace_id uuid,p_actor_id uuid,p_user_id uuid,p_available boolean,p_enabled boolean DEFAULT NULL,p_capacity integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE is_admin boolean;
BEGIN
  SELECT role IN ('admin','owner') INTO is_admin FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id;
  IF is_admin IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_user_id)
    OR (NOT is_admin AND (p_actor_id<>p_user_id OR p_enabled IS NOT NULL OR p_capacity IS NOT NULL))
    OR (p_capacity IS NOT NULL AND p_capacity NOT BETWEEN 1 AND 500) OR (p_available IS NULL AND NOT is_admin)
  THEN RAISE EXCEPTION 'invalid_agent_state'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inbox-assignment:'||p_workspace_id::text,0));
  INSERT INTO public.inbox_agent_state(workspace_id,user_id,available,enabled,capacity)
    VALUES(p_workspace_id,p_user_id,coalesce(p_available,true),coalesce(p_enabled,true),coalesce(p_capacity,20))
    ON CONFLICT(workspace_id,user_id) DO UPDATE SET available=coalesce(p_available,inbox_agent_state.available),
      enabled=coalesce(p_enabled,inbox_agent_state.enabled),capacity=coalesce(p_capacity,inbox_agent_state.capacity);
END $$;
REVOKE ALL ON FUNCTION public.update_inbox_agent_state(uuid,uuid,uuid,boolean,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_inbox_agent_state(uuid,uuid,uuid,boolean,boolean,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.inbox_member_load(p_workspace_id uuid,p_actor_id uuid)
RETURNS TABLE(user_id uuid,active bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND workspace_members.user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_case_context'; END IF;
  RETURN QUERY SELECT m.user_id,(SELECT count(*) FROM public.conversations c WHERE c.workspace_id=p_workspace_id AND c.assigned_agent_id=m.user_id
    AND c.deleted_at IS NULL AND c.status<>'closed' AND (c.snoozed_until IS NULL OR c.snoozed_until<=now()))
    FROM public.workspace_members m WHERE m.workspace_id=p_workspace_id;
END $$;
REVOKE ALL ON FUNCTION public.inbox_member_load(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_member_load(uuid,uuid) TO service_role;

-- Allowed action types are internal and explicitly bounded. Any failure rolls
-- back the whole macro, its notes, tag events, reminders and audit record.
CREATE OR REPLACE FUNCTION public.apply_inbox_actions(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid,p_actions jsonb,p_macro_id uuid DEFAULT NULL,p_macro_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.conversations; prior public.inbox_action_runs; a jsonb; actions jsonb:=p_actions; v_result jsonb:='[]'; idx integer:=0; event_id uuid; deadline timestamptz; assignment jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inbox-assignment:'||p_workspace_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_case_context'; END IF;
  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR (c.channel IN ('gmail','outlook','zoho') AND NOT EXISTS(SELECT 1 FROM public.channel_connections WHERE id=c.connection_id AND created_by=p_actor_id)) THEN RAISE EXCEPTION 'invalid_case_context'; END IF;
  SELECT * INTO prior FROM public.inbox_action_runs WHERE id=p_id;
  IF FOUND THEN
    IF prior.workspace_id<>p_workspace_id OR prior.conversation_id<>p_conversation_id OR prior.actor_id IS DISTINCT FROM p_actor_id
      OR prior.macro_id IS DISTINCT FROM p_macro_id OR prior.macro_version IS DISTINCT FROM p_macro_version
      OR (p_macro_id IS NULL AND prior.actions IS DISTINCT FROM p_actions) THEN RAISE EXCEPTION 'inbox_operation_conflict'; END IF;
    RETURN prior.result;
  END IF;
  IF p_macro_id IS NOT NULL THEN
    SELECT m.actions INTO actions FROM public.inbox_macros m WHERE m.id=p_macro_id AND m.workspace_id=p_workspace_id AND m.is_active AND m.version=p_macro_version FOR SHARE;
    IF NOT FOUND OR p_actions IS NOT NULL THEN RAISE EXCEPTION 'inbox_macro_changed'; END IF;
  END IF;
  IF actions IS NULL OR jsonb_typeof(actions)<>'array' OR jsonb_array_length(actions) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid_inbox_actions'; END IF;
  INSERT INTO public.inbox_action_runs(id,workspace_id,conversation_id,actor_id,macro_id,macro_version,actions)
    VALUES(p_id,p_workspace_id,p_conversation_id,p_actor_id,p_macro_id,p_macro_version,actions);
  FOR a IN SELECT value FROM jsonb_array_elements(actions) LOOP
    idx:=idx+1; event_id:=md5(p_id::text||':'||idx::text)::uuid;
    CASE a->>'type'
      WHEN 'snooze' THEN
        deadline:=CASE WHEN a ? 'minutes' THEN now()+make_interval(mins=>(a->>'minutes')::integer) ELSE (a->>'until')::timestamptz END;
        IF deadline IS NULL OR deadline<=now() OR deadline>now()+interval '365 days' THEN RAISE EXCEPTION 'invalid_followup_date'; END IF;
        UPDATE public.conversations SET snoozed_until=deadline,snoozed_at=now(),snoozed_by=p_actor_id,snooze_id=event_id WHERE id=c.id;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','snooze','until',deadline));
      WHEN 'resume' THEN
        UPDATE public.conversations SET snoozed_until=NULL,snoozed_at=NULL,snoozed_by=NULL,snooze_id=NULL,status='open' WHERE id=c.id;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','resume'));
      WHEN 'reminder' THEN
        deadline:=CASE WHEN a ? 'minutes' THEN now()+make_interval(mins=>(a->>'minutes')::integer) ELSE (a->>'due_at')::timestamptz END;
        IF deadline IS NULL OR deadline<=now() OR deadline>now()+interval '365 days' OR a->>'body' IS NULL THEN RAISE EXCEPTION 'invalid_followup_date'; END IF;
        INSERT INTO public.inbox_reminders(id,workspace_id,conversation_id,user_id,body,due_at) VALUES(event_id,p_workspace_id,c.id,p_actor_id,a->>'body',deadline);
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','reminder','id',event_id,'due_at',deadline));
      WHEN 'cancel_reminder' THEN
        UPDATE public.inbox_reminders SET status='cancelled' WHERE id=(a->>'id')::uuid AND workspace_id=p_workspace_id AND conversation_id=c.id AND user_id=p_actor_id AND status='pending';
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid_reminder_context'; END IF;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','cancel_reminder','id',a->>'id'));
      WHEN 'note' THEN
        PERFORM public.add_conversation_note(event_id,p_workspace_id,c.id,p_actor_id,a->>'body',ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'mentions','[]'::jsonb)))::uuid[]);
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','note','id',event_id));
      WHEN 'case' THEN
        IF a->>'priority' IS NULL OR NOT a ? 'reason' THEN RAISE EXCEPTION 'invalid_inbox_actions'; END IF;
        UPDATE public.conversations SET case_priority=a->>'priority',case_reason=a->>'reason' WHERE id=c.id;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','case','priority',a->>'priority','reason',a->'reason'));
      WHEN 'tag' THEN
        IF NOT EXISTS(SELECT 1 FROM public.tags WHERE id=(a->>'tag_id')::uuid AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'invalid_inbox_tag'; END IF;
        INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(c.contact_id,(a->>'tag_id')::uuid) ON CONFLICT DO NOTHING;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','tag','tag_id',a->>'tag_id'));
      WHEN 'assign' THEN
        assignment:=public.assign_inbox_case(p_workspace_id,c.id,p_actor_id,ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'agent_ids','[]'::jsonb)))::uuid[],(a->>'team_id')::uuid,true);
        IF assignment->>'outcome'='waiting' THEN RAISE EXCEPTION 'inbox_team_unavailable'; END IF;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('type','assign','agent_id',assignment->'agent_id'));
      ELSE RAISE EXCEPTION 'invalid_inbox_actions';
    END CASE;
  END LOOP;
  UPDATE public.inbox_action_runs SET result=v_result WHERE id=p_id;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.apply_inbox_actions(uuid,uuid,uuid,uuid,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_inbox_actions(uuid,uuid,uuid,uuid,jsonb,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.process_due_inbox_followups(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.conversations; r public.inbox_reminders; snoozes integer:=0; reminders integer:=0;
BEGIN
  FOR c IN SELECT * FROM public.conversations WHERE deleted_at IS NULL AND snoozed_until<=now() ORDER BY snoozed_until LIMIT greatest(1,least(p_limit,500)) FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.conversations SET snoozed_until=NULL,snoozed_at=NULL,snoozed_by=NULL,snooze_id=NULL,status='open' WHERE id=c.id;
    IF c.snoozed_by IS NOT NULL AND EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=c.workspace_id AND user_id=c.snoozed_by)
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections WHERE id=c.connection_id AND created_by=c.snoozed_by)) THEN
      INSERT INTO public.workspace_notifications(workspace_id,user_id,conversation_id,kind,source_id) VALUES(c.workspace_id,c.snoozed_by,c.id,'snooze',c.snooze_id) ON CONFLICT DO NOTHING;
    END IF;
    snoozes:=snoozes+1;
  END LOOP;
  FOR r IN SELECT * FROM public.inbox_reminders WHERE status='pending' AND due_at<=now() ORDER BY due_at LIMIT greatest(1,least(p_limit,500)) FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO c FROM public.conversations WHERE id=r.conversation_id AND workspace_id=r.workspace_id AND deleted_at IS NULL;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=r.user_id)
      OR (c.channel IN ('gmail','outlook','zoho') AND NOT EXISTS(SELECT 1 FROM public.channel_connections WHERE id=c.connection_id AND created_by=r.user_id)) THEN
      UPDATE public.inbox_reminders SET status='cancelled' WHERE id=r.id; CONTINUE;
    END IF;
    INSERT INTO public.workspace_notifications(workspace_id,user_id,conversation_id,kind,source_id,body) VALUES(r.workspace_id,r.user_id,r.conversation_id,'reminder',r.id,r.body) ON CONFLICT DO NOTHING;
    UPDATE public.inbox_reminders SET status='completed',completed_at=now() WHERE id=r.id;
    reminders:=reminders+1;
  END LOOP;
  RETURN jsonb_build_object('snoozes',snoozes,'reminders',reminders);
END $$;
REVOKE ALL ON FUNCTION public.process_due_inbox_followups(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_inbox_followups(integer) TO service_role;

-- A new customer message must bring a waiting case back immediately. This is
-- database-level so it covers every channel and is independent of a web tab.
CREATE OR REPLACE FUNCTION public.wake_inbox_on_customer_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.sender_type='customer' THEN
    UPDATE public.conversations SET snoozed_until=NULL,snoozed_at=NULL,snoozed_by=NULL,snooze_id=NULL,status='open'
      WHERE id=NEW.conversation_id AND snoozed_until IS NOT NULL AND deleted_at IS NULL
        AND NEW.created_at>=coalesce(snoozed_at,'-infinity'::timestamptz);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wake_inbox_on_customer_message ON public.messages;
CREATE TRIGGER wake_inbox_on_customer_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.wake_inbox_on_customer_message();
REVOKE ALL ON FUNCTION public.wake_inbox_on_customer_message() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';

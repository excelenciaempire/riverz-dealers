-- Current human return permissions and private case access; never execute a refund or provider operation.
CREATE FUNCTION public.return_actor_access(p_workspace_id uuid,p_actor_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL
 AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id
  AND m.role IN ('admin','agent') AND (m.allowed_sections IS NULL OR (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/devoluciones')))));
$$;
CREATE FUNCTION public.return_case_actor_access(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.return_actor_access(p_workspace_id,p_actor_id) AND EXISTS(SELECT 1 FROM public.returns r WHERE r.id=p_case_id AND r.workspace_id=p_workspace_id
  AND (r.contact_id IS NULL OR EXISTS(SELECT 1 FROM public.contacts customer WHERE customer.id=r.contact_id AND customer.workspace_id=r.workspace_id))
  AND (r.conversation_id IS NULL OR EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=r.conversation_id AND c.workspace_id=r.workspace_id AND c.deleted_at IS NULL
   AND (r.contact_id IS NULL OR c.contact_id=r.contact_id)
   AND EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=r.workspace_id AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id=r.workspace_id AND m.user_id=p_actor_id AND (m.allowed_sections IS NULL OR to_jsonb(m.allowed_sections) ? '/bandeja'))))
   AND (c.channel::text NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc
    WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=p_actor_id AND cc.channel=c.channel)))));
$$;
CREATE FUNCTION public.visible_return_case_ids(p_workspace_id uuid,p_actor_id uuid,p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_ids IS NULL OR cardinality(p_ids)>200 OR array_position(p_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'invalid_return_context';END IF;
 IF NOT public.return_actor_access(p_workspace_id,p_actor_id) THEN RAISE EXCEPTION 'return_access_forbidden';END IF;
 RETURN (SELECT COALESCE(jsonb_agg(r.id ORDER BY r.id),'[]'::jsonb) FROM public.returns r WHERE r.workspace_id=p_workspace_id AND r.id=ANY(p_ids) AND public.return_case_actor_access(p_workspace_id,p_actor_id,r.id));
END $$;
REVOKE ALL ON FUNCTION public.return_actor_access(uuid,uuid),public.return_case_actor_access(uuid,uuid,uuid),public.visible_return_case_ids(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.return_actor_access(uuid,uuid),public.return_case_actor_access(uuid,uuid,uuid),public.visible_return_case_ids(uuid,uuid,uuid[]) TO service_role;

CREATE FUNCTION public.can_read_return_case(p_workspace_id uuid,p_case_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.return_case_actor_access(p_workspace_id,auth.uid(),p_case_id);
$$;
REVOKE ALL ON FUNCTION public.can_read_return_case(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_return_case(uuid,uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS returns_miembros ON public.returns;
CREATE POLICY returns_current_case_read ON public.returns FOR SELECT TO authenticated USING(public.can_read_return_case(workspace_id,id));
REVOKE INSERT,UPDATE,DELETE ON public.returns FROM authenticated;
REVOKE ALL ON public.returns FROM anon;
GRANT SELECT ON public.returns TO authenticated;
DROP POLICY IF EXISTS return_case_events_read ON public.return_case_events;
CREATE POLICY return_case_events_read ON public.return_case_events FOR SELECT TO authenticated USING(public.can_read_return_case(workspace_id,case_id));

CREATE FUNCTION public.read_return_case_decision(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.returns;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL THEN RAISE EXCEPTION 'invalid_return_context';END IF;
 IF NOT public.return_case_actor_access(p_workspace_id,p_actor_id,p_case_id) THEN RAISE EXCEPTION 'return_not_found';END IF;
 SELECT * INTO r FROM public.returns WHERE id=p_case_id AND workspace_id=p_workspace_id;
 RETURN jsonb_build_object('id',r.id,'order_number',r.order_number,'kind',r.kind,'reason',r.reason,'status',r.status,'resolution',r.resolution,'updated_at',r.updated_at,'platform',r.platform);
END $$;
REVOKE ALL ON FUNCTION public.read_return_case_decision(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_return_case_decision(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.read_return_case_history(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid,p_cursor_sequence bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE events jsonb;next_cursor text;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL OR (p_cursor_sequence IS NOT NULL AND (p_cursor_sequence<1 OR p_cursor_sequence>9007199254740991)) THEN RAISE EXCEPTION 'invalid_return_context';END IF;
 IF NOT public.return_case_actor_access(p_workspace_id,p_actor_id,p_case_id) THEN RAISE EXCEPTION 'return_not_found';END IF;
 WITH page AS(SELECT *,row_number() OVER(ORDER BY event_sequence DESC) AS n FROM public.return_case_events
  WHERE workspace_id=p_workspace_id AND case_id=p_case_id AND (p_cursor_sequence IS NULL OR event_sequence<p_cursor_sequence) ORDER BY event_sequence DESC LIMIT 21)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'event_sequence',event_sequence,'event_type',event_type,'occurred_at',occurred_at,'actor_id',actor_id,
  'status',snapshot->>'status','previous_status',previous_snapshot->>'status','resolution',snapshot->>'resolution','previous_resolution',previous_snapshot->>'resolution',
  'photo_count',jsonb_array_length(snapshot->'photos')) ORDER BY event_sequence DESC) FILTER(WHERE n<=20),'[]'::jsonb),
  CASE WHEN count(*)>20 THEN jsonb_build_object('event_sequence',min(event_sequence) FILTER(WHERE n<=20))::text ELSE NULL END INTO events,next_cursor FROM page;
 RETURN jsonb_build_object('events',events,'next_cursor',next_cursor);
END $$;
REVOKE ALL ON FUNCTION public.read_return_case_history(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_return_case_history(uuid,uuid,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.record_return_case_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_snapshot jsonb; prior_snapshot jsonb; event_kind text; actor uuid;
BEGIN
  current_snapshot := jsonb_build_object('status',NEW.status,'resolution',NEW.resolution,
    'kind',NEW.kind,'reason',NEW.reason,'customer_note',NEW.customer_note,'photos',NEW.photos,
    'order_number',NEW.order_number,'platform',NEW.platform,
    'decided_by',NEW.decided_by,'decided_at',NEW.decided_at);
  IF TG_OP = 'INSERT' THEN event_kind := 'opened';
  ELSE
    IF OLD.workspace_id = NEW.workspace_id THEN
      prior_snapshot := jsonb_build_object('status',OLD.status,'resolution',OLD.resolution,
        'kind',OLD.kind,'reason',OLD.reason,'customer_note',OLD.customer_note,'photos',OLD.photos,
        'order_number',OLD.order_number,'platform',OLD.platform,
        'decided_by',OLD.decided_by,'decided_at',OLD.decided_at);
    END IF;
    IF current_snapshot IS NOT DISTINCT FROM prior_snapshot THEN RETURN NEW; END IF;
    event_kind := CASE WHEN prior_snapshot IS NULL THEN 'baseline'
      WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'state_changed'
      WHEN OLD.photos IS DISTINCT FROM NEW.photos THEN 'evidence_changed' ELSE 'updated' END;
  END IF;
  -- A signed DB actor takes precedence over editable attribution columns.
  actor := auth.uid();
  IF actor IS NULL AND TG_OP = 'UPDATE' AND OLD.workspace_id = NEW.workspace_id
    AND (NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decided_by IS DISTINCT FROM OLD.decided_by)
    AND public.return_actor_access(NEW.workspace_id,NEW.decided_by)
  THEN actor := NEW.decided_by; END IF;
  IF actor IS NOT NULL AND NOT public.return_actor_access(NEW.workspace_id,actor)
  THEN actor := NULL; END IF;
  INSERT INTO public.return_case_events(workspace_id,case_id,event_type,actor_id,snapshot,previous_snapshot)
    VALUES(NEW.workspace_id,NEW.id,event_kind,actor,current_snapshot,prior_snapshot);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_return_case_event() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.decide_return_case(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid,p_status text,p_resolution text DEFAULT NULL,p_replace_resolution boolean DEFAULT false,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.returns;note text;unchanged boolean;result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL OR p_status IS NULL OR p_status NOT IN ('abierta','aprobada','rechazada','recibida','resuelta')
  OR p_replace_resolution IS NULL OR (p_resolution IS NOT NULL AND length(p_resolution)>500) THEN RAISE EXCEPTION 'invalid_return_context';END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'return_not_found';END IF;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT public.return_actor_access(p_workspace_id,p_actor_id) THEN RAISE EXCEPTION 'return_access_forbidden';END IF;
 SELECT * INTO r FROM public.returns WHERE id=p_case_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'return_not_found';END IF;
 IF r.conversation_id IS NOT NULL THEN
  PERFORM 1 FROM public.conversations WHERE id=r.conversation_id AND workspace_id=p_workspace_id FOR SHARE;
  PERFORM 1 FROM public.channel_connections cc JOIN public.conversations c ON c.connection_id=cc.id WHERE c.id=r.conversation_id AND cc.workspace_id=p_workspace_id FOR SHARE OF cc;
 END IF;
 IF r.contact_id IS NOT NULL THEN PERFORM 1 FROM public.contacts WHERE id=r.contact_id AND workspace_id=p_workspace_id FOR SHARE;END IF;
 IF NOT public.return_case_actor_access(p_workspace_id,p_actor_id,p_case_id) THEN RAISE EXCEPTION 'return_not_found';END IF;
 IF r.platform IS NOT NULL THEN RAISE EXCEPTION 'return_platform_managed';END IF;
 note=CASE WHEN p_replace_resolution THEN NULLIF(btrim(p_resolution),'') ELSE r.resolution END;
 unchanged=r.status=p_status AND r.resolution IS NOT DISTINCT FROM note;
 IF NOT unchanged THEN
  IF p_expected_updated_at IS NOT NULL AND r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'return_decision_changed';END IF;
  IF r.status IS DISTINCT FROM p_status AND NOT ((r.status='abierta' AND p_status IN ('aprobada','rechazada')) OR (r.status='aprobada' AND p_status IN ('recibida','rechazada')) OR (r.status='recibida' AND p_status='resuelta')) THEN RAISE EXCEPTION 'invalid_return_transition';END IF;
  IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'return_subscription_read_only';END IF;
  UPDATE public.returns SET status=p_status,resolution=note,decided_by=p_actor_id,decided_at=clock_timestamp() WHERE id=p_case_id AND workspace_id=p_workspace_id;
 END IF;
 result=public.read_return_case_decision(p_workspace_id,p_actor_id,p_case_id);
 RETURN result||jsonb_build_object('unchanged',unchanged);
END $$;
REVOKE ALL ON FUNCTION public.decide_return_case(uuid,uuid,uuid,text,text,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decide_return_case(uuid,uuid,uuid,text,text,boolean,timestamptz) TO service_role;

CREATE FUNCTION public.return_case_authority_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT count(*)=6 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute')) FROM pg_catalog.pg_proc WHERE oid IN
 ('public.return_actor_access(uuid,uuid)'::regprocedure,'public.return_case_actor_access(uuid,uuid,uuid)'::regprocedure,'public.visible_return_case_ids(uuid,uuid,uuid[])'::regprocedure,'public.read_return_case_decision(uuid,uuid,uuid)'::regprocedure,'public.read_return_case_history(uuid,uuid,uuid,bigint)'::regprocedure,'public.decide_return_case(uuid,uuid,uuid,text,text,boolean,timestamptz)'::regprocedure))
 AND NOT has_table_privilege('authenticated','public.returns','insert,update,delete')
 AND NOT has_table_privilege('anon','public.returns','select')
 AND (SELECT bool_and(relrowsecurity) FROM pg_catalog.pg_class WHERE oid IN ('public.returns'::regclass,'public.return_case_events'::regclass))
 AND (SELECT count(*)=1 AND bool_and(qual LIKE '%can_read_return_case%') FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='return_case_events' AND cmd IN ('SELECT','ALL'))
 AND (SELECT count(*)=1 AND bool_and(qual LIKE '%can_read_return_case%') FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='returns' AND cmd IN ('SELECT','ALL'));
$$;
REVOKE ALL ON FUNCTION public.return_case_authority_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.return_case_authority_ready() TO service_role;

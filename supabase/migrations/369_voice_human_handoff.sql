-- X3: private browser-human control, worker acknowledgement and tool barrier.
-- No LiveKit calls, microphone activation, model calls or customer writes in SQL.
CREATE TABLE public.voice_human_runtimes(
 call_id uuid PRIMARY KEY REFERENCES public.voice_calls(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 worker_id uuid NOT NULL,room_name text NOT NULL CHECK(length(room_name)<=128 AND room_name ~ '^[A-Za-z0-9_.-]+$'),
 customer_identity text NOT NULL CHECK(length(customer_identity)<=128 AND customer_identity ~ '^[A-Za-z0-9_+.:@-]+$'),
 ai_stopped_at timestamptz,seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.voice_human_handoffs(
 id uuid PRIMARY KEY,call_id uuid NOT NULL REFERENCES public.voice_calls(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN ('requested','ready','connected','ended','failed','expired')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 joined_at timestamptz,ended_at timestamptz,reason text CHECK(reason IN ('access_revoked','runtime_stale','call_ended','handshake_timeout','ended_by_human','worker_failed')),
 CHECK(expires_at>created_at),CHECK((state IN ('ended','failed','expired'))=(ended_at IS NOT NULL)),
 CHECK(state<>'connected' OR joined_at IS NOT NULL),CHECK(state NOT IN ('requested','ready') OR joined_at IS NULL)
);
CREATE UNIQUE INDEX voice_human_one_controller ON public.voice_human_handoffs(call_id) WHERE state IN ('requested','ready','connected');
CREATE INDEX voice_human_actor_history ON public.voice_human_handoffs(workspace_id,actor_id,call_id,created_at DESC,id DESC);
CREATE TABLE public.voice_human_tool_slots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),call_id uuid NOT NULL REFERENCES public.voice_calls(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- A timed-out tool is NOT considered finished. No automatic slot expiry can
-- open the human microphone while the backend might still execute a tool.
ALTER TABLE public.voice_human_runtimes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_human_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_human_tool_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_human_runtimes,public.voice_human_handoffs,public.voice_human_tool_slots FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.voice_human_access(p_workspace_id uuid,p_actor_id uuid,p_call_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_workspace_id IS NOT NULL AND p_actor_id IS NOT NULL AND p_call_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.voice_calls vc JOIN public.workspaces w ON w.id=vc.workspace_id AND w.deleted_at IS NULL
 JOIN public.contacts ct ON ct.id=vc.contact_id AND ct.workspace_id=vc.workspace_id
 WHERE vc.id=p_call_id AND vc.workspace_id=p_workspace_id
 AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id
 AND m.role IN ('admin','agent') AND (m.allowed_sections IS NULL OR (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/voz'))))
 AND (vc.conversation_id IS NULL OR EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=vc.conversation_id AND c.workspace_id=w.id AND c.deleted_at IS NULL
 AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=w.id AND cc.channel=c.channel AND cc.created_by=p_actor_id)))));
$$;
CREATE FUNCTION public.voice_human_current(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.voice_human_handoffs h JOIN public.voice_calls c ON c.id=h.call_id AND c.workspace_id=h.workspace_id
 JOIN public.voice_human_runtimes r ON r.call_id=c.id AND r.workspace_id=h.workspace_id
 WHERE h.id=p_id AND h.state IN ('requested','ready','connected') AND h.expires_at>clock_timestamp()
 AND r.seen_at>clock_timestamp()-interval '15 seconds' AND c.status IN ('dialing','in_progress')
 AND public.voice_human_access(h.workspace_id,h.actor_id,h.call_id) AND public.workspace_billing_write_allowed(h.workspace_id));
$$;
CREATE FUNCTION public.voice_human_snapshot(p_workspace_id uuid,p_actor_id uuid,p_call_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.voice_human_handoffs;available boolean;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_call_id IS NULL THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 IF NOT public.voice_human_access(p_workspace_id,p_actor_id,p_call_id) THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 SELECT EXISTS(SELECT 1 FROM public.voice_human_runtimes r JOIN public.voice_calls c ON c.id=r.call_id AND c.workspace_id=r.workspace_id
 WHERE r.call_id=p_call_id AND r.workspace_id=p_workspace_id AND r.seen_at>clock_timestamp()-interval '15 seconds'
 AND c.status IN ('dialing','in_progress')) INTO available;
 SELECT * INTO job FROM public.voice_human_handoffs WHERE call_id=p_call_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF FOUND AND job.state IN ('requested','ready','connected') AND NOT public.voice_human_current(job.id) THEN
  UPDATE public.voice_human_handoffs SET state='expired',reason=CASE WHEN expires_at<=clock_timestamp() THEN 'handshake_timeout' WHEN NOT available THEN 'runtime_stale' ELSE 'access_revoked' END,
  ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 END IF;
 RETURN jsonb_build_object('call_id',p_call_id,'workspace_id',p_workspace_id,'actor_id',p_actor_id,'runtime_available',available,'job',
 CASE WHEN job.id IS NULL THEN NULL ELSE to_jsonb(job) END);
END $$;
CREATE FUNCTION public.register_voice_human_runtime(p_call_id uuid,p_worker_id uuid,p_room text,p_customer_identity text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE call public.voice_calls;runtime public.voice_human_runtimes;
BEGIN
 IF p_call_id IS NULL OR p_worker_id IS NULL OR p_room IS NULL OR length(p_room)>128 OR p_room !~ '^[A-Za-z0-9_.-]+$'
 OR p_customer_identity IS NULL OR length(p_customer_identity)>128 OR p_customer_identity !~ '^[A-Za-z0-9_+.:@-]+$' THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-call:'||p_call_id::text,0));
 SELECT * INTO call FROM public.voice_calls WHERE id=p_call_id FOR UPDATE;
 IF NOT FOUND OR call.status NOT IN ('dialing','in_progress') THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 IF (call.direction='outbound' AND (p_room IS DISTINCT FROM 'voice_'||call.id::text OR p_customer_identity IS DISTINCT FROM 'caller-'||call.id::text))
 OR (call.direction='inbound' AND call.external_call_id IS DISTINCT FROM p_room||':'||p_customer_identity)
 OR (call.room_name IS NOT NULL AND call.room_name IS DISTINCT FROM p_room) THEN RAISE EXCEPTION 'voice_handoff_changed';END IF;
 SELECT * INTO runtime FROM public.voice_human_runtimes WHERE call_id=p_call_id;
 IF FOUND AND (runtime.worker_id IS DISTINCT FROM p_worker_id OR runtime.room_name IS DISTINCT FROM p_room OR runtime.customer_identity IS DISTINCT FROM p_customer_identity) THEN RAISE EXCEPTION 'voice_handoff_changed';END IF;
 INSERT INTO public.voice_human_runtimes(call_id,workspace_id,worker_id,room_name,customer_identity) VALUES(call.id,call.workspace_id,p_worker_id,p_room,p_customer_identity)
 ON CONFLICT(call_id) DO UPDATE SET seen_at=clock_timestamp();
 UPDATE public.voice_calls SET room_name=p_room,status='in_progress',answered_at=COALESCE(answered_at,clock_timestamp()) WHERE id=call.id;
 RETURN true;
END $$;
CREATE FUNCTION public.request_voice_human_handoff(p_workspace_id uuid,p_actor_id uuid,p_call_id uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.voice_human_handoffs;
BEGIN
 IF p_id IS NULL OR p_call_id IS NULL OR p_actor_id IS NULL OR p_workspace_id IS NULL THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 IF NOT public.voice_human_access(p_workspace_id,p_actor_id,p_call_id) THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'voice_handoff_read_only';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-call:'||p_call_id::text,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-job:'||p_id::text,0));
 SELECT * INTO job FROM public.voice_human_handoffs WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF job.call_id IS DISTINCT FROM p_call_id OR job.workspace_id IS DISTINCT FROM p_workspace_id OR job.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
  RETURN public.voice_human_snapshot(p_workspace_id,p_actor_id,p_call_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.voice_human_runtimes r JOIN public.voice_calls c ON c.id=r.call_id AND c.workspace_id=r.workspace_id
 WHERE r.call_id=p_call_id AND r.workspace_id=p_workspace_id AND r.seen_at>clock_timestamp()-interval '15 seconds' AND c.status='in_progress') THEN RAISE EXCEPTION 'voice_handoff_unavailable';END IF;
 -- An expired/uncertain controller is cleaned up by its worker before another
 -- request can replace it. No browser can erase its state to acquire the room.
 IF EXISTS(SELECT 1 FROM public.voice_human_handoffs WHERE call_id=p_call_id) THEN RAISE EXCEPTION 'voice_handoff_changed';END IF;
 INSERT INTO public.voice_human_handoffs(id,call_id,workspace_id,actor_id,state,expires_at)
 VALUES(p_id,p_call_id,p_workspace_id,p_actor_id,'requested',clock_timestamp()+interval '45 seconds');
 RETURN public.voice_human_snapshot(p_workspace_id,p_actor_id,p_call_id);
END $$;
CREATE FUNCTION public.poll_voice_human_runtime(p_call_id uuid,p_worker_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE runtime public.voice_human_runtimes;job public.voice_human_handoffs;
BEGIN
 IF p_call_id IS NULL OR p_worker_id IS NULL THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-call:'||p_call_id::text,0));
 SELECT * INTO runtime FROM public.voice_human_runtimes WHERE call_id=p_call_id AND worker_id=p_worker_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 UPDATE public.voice_human_runtimes SET seen_at=clock_timestamp() WHERE call_id=p_call_id;
 SELECT * INTO job FROM public.voice_human_handoffs WHERE call_id=p_call_id ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF FOUND AND job.state IN ('requested','ready','connected') AND NOT public.voice_human_current(job.id) THEN
  UPDATE public.voice_human_handoffs SET state='expired',reason=CASE WHEN expires_at<=clock_timestamp() THEN 'handshake_timeout' ELSE 'access_revoked' END,ended_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=job.id RETURNING * INTO job;
 END IF;
 RETURN jsonb_build_object('call_id',p_call_id,'worker_id',p_worker_id,'id',job.id,'state',job.state,'actor_id',job.actor_id,'expires_at',job.expires_at,
 'room',runtime.room_name,'customer_identity',runtime.customer_identity,'tools_pending',EXISTS(SELECT 1 FROM public.voice_human_tool_slots WHERE call_id=p_call_id));
END $$;
CREATE FUNCTION public.ack_voice_human_handoff(p_call_id uuid,p_worker_id uuid,p_id uuid,p_phase text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.voice_human_handoffs;
BEGIN
 IF p_call_id IS NULL OR p_worker_id IS NULL OR p_id IS NULL OR p_phase IS NULL OR p_phase NOT IN ('ready','connected','ended','failed') THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-call:'||p_call_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.voice_human_runtimes WHERE call_id=p_call_id AND worker_id=p_worker_id AND seen_at>clock_timestamp()-interval '15 seconds') THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 SELECT * INTO job FROM public.voice_human_handoffs WHERE id=p_id AND call_id=p_call_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 IF p_phase IN ('ready','connected') AND NOT public.voice_human_current(p_id) THEN RETURN false;END IF;
 IF p_phase='ready' THEN
  IF job.state='ready' THEN RETURN true;END IF;
  IF job.state<>'requested' OR EXISTS(SELECT 1 FROM public.voice_human_tool_slots WHERE call_id=p_call_id) THEN RETURN false;END IF;
  UPDATE public.voice_human_handoffs SET state='ready',updated_at=clock_timestamp() WHERE id=p_id;
  UPDATE public.voice_human_runtimes SET ai_stopped_at=COALESCE(ai_stopped_at,clock_timestamp()) WHERE call_id=p_call_id;
 ELSIF p_phase='connected' THEN
  IF job.state='connected' THEN RETURN true;END IF;
  IF job.state<>'ready' THEN RETURN false;END IF;
  UPDATE public.voice_human_handoffs SET state='connected',joined_at=clock_timestamp(),expires_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=p_id;
 ELSE
  IF job.state IN ('ended','failed','expired') THEN RETURN true;END IF;
  UPDATE public.voice_human_handoffs SET state=p_phase,reason=CASE WHEN p_phase='failed' THEN 'worker_failed' ELSE 'call_ended' END,ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.voice_human_grant_context(p_workspace_id uuid,p_actor_id uuid,p_call_id uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.voice_human_handoffs;runtime public.voice_human_runtimes;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_call_id IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 IF NOT public.voice_human_access(p_workspace_id,p_actor_id,p_call_id) THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-call:'||p_call_id::text,0));
 SELECT * INTO job FROM public.voice_human_handoffs WHERE id=p_id AND call_id=p_call_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 IF job.state<>'ready' OR NOT public.voice_human_current(p_id) OR EXISTS(SELECT 1 FROM public.voice_human_tool_slots WHERE call_id=p_call_id) THEN RAISE EXCEPTION 'voice_handoff_changed';END IF;
 SELECT * INTO runtime FROM public.voice_human_runtimes WHERE call_id=p_call_id;
 RETURN jsonb_build_object('id',p_id,'call_id',p_call_id,'workspace_id',p_workspace_id,'actor_id',p_actor_id,'room',runtime.room_name,'customer_identity',runtime.customer_identity,'expires_at',job.expires_at);
END $$;
CREATE FUNCTION public.manage_voice_human_handoff(p_workspace_id uuid,p_actor_id uuid,p_call_id uuid,p_id uuid,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.voice_human_handoffs;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_call_id IS NULL OR p_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('renew','end') THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-call:'||p_call_id::text,0));
 SELECT * INTO job FROM public.voice_human_handoffs WHERE id=p_id AND call_id=p_call_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 IF p_operation='renew' THEN
  IF NOT public.voice_human_access(p_workspace_id,p_actor_id,p_call_id) THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
  IF job.state<>'connected' OR NOT public.voice_human_current(p_id) THEN RAISE EXCEPTION 'voice_handoff_changed';END IF;
  UPDATE public.voice_human_handoffs SET expires_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=p_id;
 ELSE
  -- The same actor can release their own claim after permission revocation.
  UPDATE public.voice_human_handoffs SET state='ended',reason='ended_by_human',ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id AND state IN ('requested','ready','connected');
 END IF;
 IF NOT public.voice_human_access(p_workspace_id,p_actor_id,p_call_id) THEN RETURN jsonb_build_object('released',true);END IF;
 RETURN public.voice_human_snapshot(p_workspace_id,p_actor_id,p_call_id);
END $$;
CREATE FUNCTION public.begin_controlled_voice_tool(p_call_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slot uuid;
BEGIN
 IF p_call_id IS NULL THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-human-call:'||p_call_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.voice_calls WHERE id=p_call_id AND status IN ('dialing','in_progress')) THEN RAISE EXCEPTION 'voice_handoff_not_found';END IF;
 IF EXISTS(SELECT 1 FROM public.voice_human_handoffs WHERE call_id=p_call_id) THEN RAISE EXCEPTION 'voice_handoff_changed';END IF;
 IF (SELECT count(*) FROM public.voice_human_tool_slots WHERE call_id=p_call_id)>=16 THEN RAISE EXCEPTION 'voice_handoff_unavailable';END IF;
 INSERT INTO public.voice_human_tool_slots(call_id) VALUES(p_call_id) RETURNING id INTO slot;RETURN slot;
END $$;
CREATE FUNCTION public.finish_controlled_voice_tool(p_call_id uuid,p_slot_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_call_id IS NULL OR p_slot_id IS NULL THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 DELETE FROM public.voice_human_tool_slots WHERE id=p_slot_id AND call_id=p_call_id;RETURN FOUND;
END $$;
CREATE FUNCTION public.voice_human_media_boundary(p_call_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_call_id IS NULL THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 RETURN (SELECT jsonb_build_object('call_id',c.id,'answered_at',c.answered_at,'ai_stopped_at',r.ai_stopped_at)
 FROM public.voice_human_runtimes r JOIN public.voice_calls c ON c.id=r.call_id AND c.workspace_id=r.workspace_id
 WHERE c.id=p_call_id AND r.ai_stopped_at IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION public.voice_human_access(uuid,uuid,uuid),public.voice_human_current(uuid),public.voice_human_snapshot(uuid,uuid,uuid),
 public.register_voice_human_runtime(uuid,uuid,text,text),public.request_voice_human_handoff(uuid,uuid,uuid,uuid),public.poll_voice_human_runtime(uuid,uuid),
 public.ack_voice_human_handoff(uuid,uuid,uuid,text),public.voice_human_grant_context(uuid,uuid,uuid,uuid),public.manage_voice_human_handoff(uuid,uuid,uuid,uuid,text),
 public.begin_controlled_voice_tool(uuid),public.finish_controlled_voice_tool(uuid,uuid),public.voice_human_media_boundary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_human_access(uuid,uuid,uuid),public.voice_human_current(uuid),public.voice_human_snapshot(uuid,uuid,uuid),
 public.register_voice_human_runtime(uuid,uuid,text,text),public.request_voice_human_handoff(uuid,uuid,uuid,uuid),public.poll_voice_human_runtime(uuid,uuid),
 public.ack_voice_human_handoff(uuid,uuid,uuid,text),public.voice_human_grant_context(uuid,uuid,uuid,uuid),public.manage_voice_human_handoff(uuid,uuid,uuid,uuid,text),
 public.begin_controlled_voice_tool(uuid),public.finish_controlled_voice_tool(uuid,uuid),public.voice_human_media_boundary(uuid) TO service_role;

-- Metadata-only deployment guard: no room, call, customer or microphone action.
CREATE FUNCTION public.voice_human_handoff_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT count(*)=3 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('voice_human_runtimes','voice_human_handoffs','voice_human_tool_slots') AND c.relrowsecurity
 AND NOT pg_catalog.has_table_privilege('anon',c.oid,'SELECT') AND NOT pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
 AND NOT pg_catalog.has_table_privilege('service_role',c.oid,'SELECT'))
 AND (SELECT count(*)=12 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('voice_human_access','voice_human_current','voice_human_snapshot','register_voice_human_runtime','request_voice_human_handoff',
 'poll_voice_human_runtime','ack_voice_human_handoff','voice_human_grant_context','manage_voice_human_handoff','begin_controlled_voice_tool','finish_controlled_voice_tool','voice_human_media_boundary')
 AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[]
 AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'));
$$;
CREATE FUNCTION public.purge_voice_human_handoffs(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'invalid_voice_handoff';END IF;
 -- Purge only terminal calls and handoffs older than 30 days. Never time out a
 -- tool slot on an active call to clear the barrier.
 WITH targets AS (SELECT r.call_id FROM public.voice_human_runtimes r JOIN public.voice_calls c ON c.id=r.call_id
 WHERE c.status NOT IN ('queued','dialing','in_progress') AND r.seen_at<clock_timestamp()-interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM public.voice_human_handoffs h WHERE h.call_id=r.call_id AND
 (h.state IN ('requested','ready','connected') OR h.ended_at>=clock_timestamp()-interval '30 days'))
 ORDER BY r.seen_at,r.call_id LIMIT p_limit FOR UPDATE OF r SKIP LOCKED),
 slots AS (DELETE FROM public.voice_human_tool_slots WHERE call_id IN (SELECT call_id FROM targets) RETURNING id),
 handoffs AS (DELETE FROM public.voice_human_handoffs WHERE call_id IN (SELECT call_id FROM targets) RETURNING id)
 DELETE FROM public.voice_human_runtimes WHERE call_id IN (SELECT call_id FROM targets);
 GET DIAGNOSTICS removed=ROW_COUNT;RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.voice_human_handoff_ready(),public.purge_voice_human_handoffs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_human_handoff_ready(),public.purge_voice_human_handoffs(integer) TO service_role;

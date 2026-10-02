-- X3: opt-in policy and durable one-attempt connector legs. No Meta/LiveKit
-- operations, permission requests, messages or customer writes happen at install.
CREATE TABLE public.voice_whatsapp_settings(
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
 inbound_enabled boolean NOT NULL DEFAULT false,outbound_enabled boolean NOT NULL DEFAULT false,
 api_version text NOT NULL CHECK(api_version IN ('23.0','24.0','25.0','26.0')),
 updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.voice_whatsapp_sessions(
 call_id uuid PRIMARY KEY REFERENCES public.voice_calls(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
 phone_number_id text NOT NULL CHECK(phone_number_id ~ '^[0-9]{1,32}$'),waba_id text NOT NULL CHECK(waba_id ~ '^[0-9]{1,32}$'),
 peer text NOT NULL CHECK(peer ~ '^[1-9][0-9]{6,14}$'),direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
 provider_call_id text CHECK(length(provider_call_id)<=256 AND length(provider_call_id)>0 AND provider_call_id !~ '[[:space:][:cntrl:]]'),
 state text NOT NULL CHECK(state IN ('starting','initiated','accepted','connecting','connected','terminated','uncertain')),
 nonce uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 cleanup_state text NOT NULL DEFAULT 'not_requested' CHECK(cleanup_state IN ('not_requested','pending','acknowledged','uncertain')),
 cleanup_finished_at timestamptz,
 CHECK(direction='outbound' OR provider_call_id IS NOT NULL)
);
CREATE UNIQUE INDEX voice_whatsapp_physical_leg ON public.voice_whatsapp_sessions(connection_id,provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE TABLE public.voice_whatsapp_terminations(
 connection_id uuid NOT NULL REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
 provider_call_id text NOT NULL CHECK(length(provider_call_id)<=256 AND length(provider_call_id)>0 AND provider_call_id !~ '[[:space:][:cntrl:]]'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(connection_id,provider_call_id)
);
CREATE INDEX voice_whatsapp_tombstone_age ON public.voice_whatsapp_terminations(received_at);
ALTER TABLE public.voice_whatsapp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_whatsapp_terminations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_whatsapp_settings,public.voice_whatsapp_sessions,public.voice_whatsapp_terminations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.voice_whatsapp_admin(p_workspace_id uuid,p_actor_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_workspace_id IS NOT NULL AND p_actor_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND(w.owner_id=p_actor_id OR EXISTS(
 SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role='admin'
 AND(m.allowed_sections IS NULL OR(jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/voz')))));
$$;
CREATE FUNCTION public.voice_whatsapp_settings_read(p_workspace_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy public.voice_whatsapp_settings;
BEGIN
 IF NOT public.voice_whatsapp_admin(p_workspace_id,p_actor_id) THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 SELECT * INTO policy FROM public.voice_whatsapp_settings WHERE workspace_id=p_workspace_id;
 RETURN CASE WHEN policy.workspace_id IS NULL THEN jsonb_build_object('inbound_enabled',false,'outbound_enabled',false,'api_version','26.0')
 ELSE jsonb_build_object('inbound_enabled',policy.inbound_enabled,'outbound_enabled',policy.outbound_enabled,'api_version',policy.api_version,'connection_id',policy.connection_id) END;
END $$;
CREATE FUNCTION public.voice_whatsapp_connection_policy(p_connection_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('workspace_id',p.workspace_id,'connection_id',p.connection_id,'inbound_enabled',p.inbound_enabled,'outbound_enabled',p.outbound_enabled,'api_version',p.api_version)
 FROM public.voice_whatsapp_settings p JOIN public.whatsapp_config c ON c.id=p.connection_id AND c.workspace_id=p.workspace_id
 JOIN public.workspaces w ON w.id=p.workspace_id AND w.deleted_at IS NULL
 WHERE p_connection_id IS NOT NULL AND p.connection_id=p_connection_id AND c.status='connected'
 AND NOT EXISTS(SELECT 1 FROM public.whatsapp_config duplicate WHERE duplicate.id<>c.id AND duplicate.status='connected' AND duplicate.phone_number_id=c.phone_number_id);
$$;
CREATE FUNCTION public.set_voice_whatsapp_settings(p_workspace_id uuid,p_actor_id uuid,p_inbound boolean,p_outbound boolean,p_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE config public.whatsapp_config;policy public.voice_whatsapp_settings;matches integer;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_inbound IS NULL OR p_outbound IS NULL OR p_version IS NULL OR p_version NOT IN ('23.0','24.0','25.0','26.0') THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 IF NOT public.voice_whatsapp_admin(p_workspace_id,p_actor_id) THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'whatsapp_voice_read_only';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('whatsapp-voice-workspace:'||p_workspace_id::text,0));
 SELECT count(*) INTO matches FROM public.whatsapp_config WHERE workspace_id=p_workspace_id AND status='connected';
 IF matches<>1 THEN RAISE EXCEPTION 'whatsapp_voice_connection_unavailable';END IF;
 SELECT * INTO config FROM public.whatsapp_config WHERE workspace_id=p_workspace_id AND status='connected' FOR UPDATE;
 IF config.phone_number_id IS NULL OR config.phone_number_id !~ '^[0-9]{1,32}$' OR config.waba_id IS NULL OR config.waba_id !~ '^[0-9]{1,32}$'
 OR EXISTS(SELECT 1 FROM public.whatsapp_config c WHERE c.id<>config.id AND c.status='connected' AND c.phone_number_id=config.phone_number_id) THEN RAISE EXCEPTION 'whatsapp_voice_connection_unavailable';END IF;
 SELECT * INTO policy FROM public.voice_whatsapp_settings WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF policy.connection_id IS NOT NULL AND policy.connection_id<>config.id AND EXISTS(SELECT 1 FROM public.voice_whatsapp_sessions s JOIN public.voice_calls v ON v.id=s.call_id
 WHERE s.workspace_id=p_workspace_id AND s.state<>'terminated' AND v.ended_at IS NULL) THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 INSERT INTO public.voice_whatsapp_settings(workspace_id,connection_id,inbound_enabled,outbound_enabled,api_version,updated_by)
 VALUES(p_workspace_id,config.id,p_inbound,p_outbound,p_version,p_actor_id) ON CONFLICT(workspace_id) DO UPDATE SET
 connection_id=EXCLUDED.connection_id,inbound_enabled=EXCLUDED.inbound_enabled,outbound_enabled=EXCLUDED.outbound_enabled,api_version=EXCLUDED.api_version,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 RETURN public.voice_whatsapp_settings_read(p_workspace_id,p_actor_id);
END $$;

CREATE FUNCTION public.reserve_voice_whatsapp_call(p_workspace_id uuid,p_connection_id uuid,p_call_id uuid,p_agent_id uuid,p_contact_id uuid,p_nonce uuid,p_direction text,p_provider_call_id text,p_peer text,p_event_at timestamptz,p_actor_id uuid DEFAULT NULL,p_global_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy public.voice_whatsapp_settings;config public.whatsapp_config;existing public.voice_whatsapp_sessions;profile public.ai_agents;call public.voice_calls;binding jsonb;voice_config jsonb;workspace_max integer:=3;reserved_slots integer:=0;workspace_active integer;outbound_active integer;month_start timestamptz;
BEGIN
 IF p_workspace_id IS NULL OR p_connection_id IS NULL OR p_call_id IS NULL OR p_agent_id IS NULL OR p_contact_id IS NULL OR p_nonce IS NULL OR p_direction IS NULL OR p_global_limit IS NULL OR p_global_limit<1 OR p_global_limit>250
 OR p_direction NOT IN ('inbound','outbound') OR p_peer IS NULL OR p_peer !~ '^[1-9][0-9]{6,14}$' THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 IF(p_direction='inbound' AND(p_provider_call_id IS NULL OR p_event_at IS NULL)) OR(p_direction='outbound' AND(p_provider_call_id IS NOT NULL OR p_actor_id IS NULL))
 OR(p_provider_call_id IS NOT NULL AND(length(p_provider_call_id)>256 OR length(p_provider_call_id)=0 OR p_provider_call_id ~ '[[:space:][:cntrl:]]')) THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 -- Share the existing PSTN dispatch capacity lock before the private lock.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('riverz_voice_capacity'));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('whatsapp-voice-workspace:'||p_workspace_id::text,0));
 SELECT * INTO config FROM public.whatsapp_config WHERE id=p_connection_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'whatsapp_voice_connection_unavailable';END IF;
 SELECT * INTO existing FROM public.voice_whatsapp_sessions WHERE call_id=p_call_id OR(connection_id=p_connection_id AND provider_call_id=p_provider_call_id) LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF existing.workspace_id<>p_workspace_id OR existing.connection_id<>p_connection_id OR existing.peer<>p_peer OR existing.direction<>p_direction
  OR(p_direction='inbound' AND existing.provider_call_id IS DISTINCT FROM p_provider_call_id) OR existing.actor_id IS DISTINCT FROM p_actor_id
  OR NOT EXISTS(SELECT 1 FROM public.voice_calls v WHERE v.id=existing.call_id AND v.contact_id=p_contact_id) THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
  RETURN jsonb_build_object('claimed',false,'call_id',existing.call_id,'state',existing.state);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL) OR NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'whatsapp_voice_read_only';END IF;
 SELECT * INTO policy FROM public.voice_whatsapp_settings WHERE workspace_id=p_workspace_id AND connection_id=p_connection_id FOR UPDATE;
 IF NOT FOUND OR config.status<>'connected' OR config.phone_number_id IS NULL OR config.waba_id IS NULL
 OR EXISTS(SELECT 1 FROM public.whatsapp_config c WHERE c.id<>config.id AND c.status='connected' AND c.phone_number_id=config.phone_number_id)
 OR(p_direction='inbound' AND NOT policy.inbound_enabled) OR(p_direction='outbound' AND(NOT policy.outbound_enabled OR NOT public.voice_whatsapp_admin(p_workspace_id,p_actor_id))) THEN RAISE EXCEPTION 'whatsapp_voice_not_allowed';END IF;
 IF p_direction='inbound' AND(p_event_at<clock_timestamp()-interval '90 seconds' OR p_event_at>clock_timestamp()+interval '15 seconds'
 OR EXISTS(SELECT 1 FROM public.voice_whatsapp_terminations WHERE connection_id=p_connection_id AND provider_call_id=p_provider_call_id)) THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=p_contact_id AND c.workspace_id=p_workspace_id AND(c.phone IN(p_peer,'+'||p_peer) OR(c.channel='whatsapp' AND c.external_id=p_peer))
 AND(p_direction='inbound' OR c.voice_opt_out IS NOT TRUE)) THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 IF p_direction='outbound' AND(EXISTS(SELECT 1 FROM public.voice_calls v WHERE v.workspace_id=p_workspace_id AND v.contact_id=p_contact_id AND v.status IN ('dialing','in_progress') AND v.ended_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.voice_whatsapp_sessions s WHERE s.workspace_id=p_workspace_id AND s.peer=p_peer
 AND(s.state<>'terminated' OR s.cleanup_state IN ('pending','uncertain'))
 AND NOT EXISTS(SELECT 1 FROM public.voice_whatsapp_terminations t WHERE t.connection_id=s.connection_id AND t.provider_call_id=s.provider_call_id))) THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 SELECT * INTO profile FROM public.ai_agents a WHERE a.id=p_agent_id AND a.workspace_id=p_workspace_id AND a.is_active=true AND a.voice_enabled=true AND a.deleted_at IS NULL
 AND(a.scope='workspace' OR EXISTS(SELECT 1 FROM public.ai_agent_channels c WHERE c.agent_id=a.id AND c.channel='voice'))
 AND(p_direction='outbound' OR a.voice_accepts_inbound=true) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'whatsapp_voice_not_allowed';END IF;
 IF(SELECT count(*) FROM public.voice_calls WHERE agent_id=p_agent_id AND status IN ('dialing','in_progress') AND ended_at IS NULL)>=COALESCE(profile.voice_max_concurrent_calls,3) THEN RAISE EXCEPTION 'whatsapp_voice_capacity_unavailable';END IF;
 SELECT COALESCE(c.config,'{}'::jsonb) INTO voice_config FROM public.channel_connections c WHERE c.workspace_id=p_workspace_id AND c.channel='voice' LIMIT 1;
 IF voice_config->>'kill_switch'='true' THEN RAISE EXCEPTION 'whatsapp_voice_not_allowed';END IF;
 IF COALESCE(voice_config->>'max_concurrent_calls','') ~ '^[0-9]+$' THEN workspace_max=LEAST(50,GREATEST(1,(voice_config->>'max_concurrent_calls')::integer));END IF;
 IF COALESCE(voice_config->>'reserved_inbound_slots','') ~ '^[0-9]+$' THEN reserved_slots=LEAST(workspace_max-1,GREATEST(0,(voice_config->>'reserved_inbound_slots')::integer));END IF;
 SELECT count(*),count(*) FILTER(WHERE direction='outbound') INTO workspace_active,outbound_active FROM public.voice_calls WHERE workspace_id=p_workspace_id AND status IN ('dialing','in_progress') AND ended_at IS NULL;
 IF workspace_active>=workspace_max OR(p_direction='outbound' AND outbound_active>=workspace_max-reserved_slots)
 OR(SELECT count(*) FROM public.voice_calls WHERE status IN ('dialing','in_progress') AND ended_at IS NULL)>=p_global_limit THEN RAISE EXCEPTION 'whatsapp_voice_capacity_unavailable';END IF;
 IF profile.voice_monthly_minutes_limit>0 THEN
  SELECT date_trunc('month',clock_timestamp() AT TIME ZONE COALESCE(NULLIF(w.timezone,''),'America/Bogota')) AT TIME ZONE COALESCE(NULLIF(w.timezone,''),'America/Bogota') INTO month_start FROM public.workspaces w WHERE w.id=p_workspace_id;
  IF(SELECT COALESCE(sum(duration_seconds),0)/60.0 FROM public.voice_calls WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id AND created_at>=month_start)>=profile.voice_monthly_minutes_limit THEN RAISE EXCEPTION 'whatsapp_voice_not_allowed';END IF;
 END IF;
 binding=jsonb_build_object('version',1,'callId',p_call_id,'workspaceId',p_workspace_id,'connectionId',p_connection_id,'phoneNumberId',config.phone_number_id,'wabaId',config.waba_id,'peer',p_peer,'direction',p_direction,'apiVersion',policy.api_version,'providerCallId',p_provider_call_id);
 INSERT INTO public.voice_calls(id,workspace_id,agent_id,contact_id,direction,call_type,phone,language,status,context,dispatch_priority,external_call_id,attempt,max_attempts,started_at,room_name)
 VALUES(p_call_id,p_workspace_id,p_agent_id,p_contact_id,p_direction,CASE WHEN p_direction='inbound' THEN 'inbound' ELSE 'manual' END,'+'||p_peer,COALESCE(profile.language,'es'),'dialing',
 jsonb_build_object('__whatsapp_call',binding,'__riverz',jsonb_build_object('origin',CASE WHEN p_direction='inbound' THEN 'inbound' ELSE 'manual' END)),500,
 CASE WHEN p_provider_call_id IS NULL THEN NULL ELSE 'whatsapp:'||p_connection_id::text||':'||p_provider_call_id END,1,1,clock_timestamp(),'voice_'||p_call_id::text) RETURNING * INTO call;
 INSERT INTO public.voice_whatsapp_sessions(call_id,workspace_id,connection_id,phone_number_id,waba_id,peer,direction,provider_call_id,state,nonce,actor_id)
 VALUES(p_call_id,p_workspace_id,p_connection_id,config.phone_number_id,config.waba_id,p_peer,p_direction,p_provider_call_id,'starting',p_nonce,p_actor_id);
 RETURN jsonb_build_object('claimed',true,'call',to_jsonb(call),'binding',binding,'nonce',p_nonce);
END $$;

CREATE FUNCTION public.finish_voice_whatsapp_operation(p_call_id uuid,p_nonce uuid,p_result text,p_provider_call_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE leg public.voice_whatsapp_sessions;
BEGIN
 IF p_call_id IS NULL OR p_nonce IS NULL OR p_result IS NULL OR p_result NOT IN ('accepted','initiated','answer_accepted','uncertain')
 OR(p_provider_call_id IS NOT NULL AND(length(p_provider_call_id)>256 OR length(p_provider_call_id)=0 OR p_provider_call_id ~ '[[:space:][:cntrl:]]')) THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 SELECT * INTO leg FROM public.voice_whatsapp_sessions WHERE call_id=p_call_id AND nonce=p_nonce FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 IF leg.state='terminated' THEN RETURN false;END IF;
 IF p_provider_call_id IS NOT NULL AND leg.provider_call_id IS NOT NULL AND leg.provider_call_id<>p_provider_call_id THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 IF p_result='initiated' AND(leg.direction<>'outbound' OR p_provider_call_id IS NULL) THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 IF p_result='accepted' AND leg.direction<>'inbound' THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 IF p_result='answer_accepted' AND(leg.direction<>'outbound' OR leg.state<>'connecting') THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 IF leg.state='connected' THEN RETURN true;END IF;
 IF leg.state NOT IN ('starting','connecting','uncertain') THEN RETURN leg.state=p_result;END IF;
 UPDATE public.voice_whatsapp_sessions SET state=CASE WHEN p_result='answer_accepted' THEN 'accepted' WHEN state='connecting' AND p_result='initiated' THEN 'connecting' ELSE p_result END,
 provider_call_id=COALESCE(provider_call_id,p_provider_call_id),updated_at=clock_timestamp() WHERE call_id=p_call_id;
 IF p_provider_call_id IS NOT NULL THEN UPDATE public.voice_calls SET context=jsonb_set(context,'{__whatsapp_call,providerCallId}',to_jsonb(p_provider_call_id)),external_call_id='whatsapp:'||leg.connection_id::text||':'||p_provider_call_id WHERE id=p_call_id;END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.claim_voice_whatsapp_answer(p_waba_id text,p_phone_number_id text,p_provider_call_id text,p_peer text,p_callback_call_id uuid,p_nonce uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE leg public.voice_whatsapp_sessions;call public.voice_calls;policy public.voice_whatsapp_settings;
BEGIN
 IF p_waba_id IS NULL OR p_waba_id !~ '^[0-9]{1,32}$' OR p_phone_number_id IS NULL OR p_phone_number_id !~ '^[0-9]{1,32}$'
 OR p_provider_call_id IS NULL OR length(p_provider_call_id)>256 OR length(p_provider_call_id)=0 OR p_provider_call_id ~ '[[:space:][:cntrl:]]' OR p_peer IS NULL OR p_peer !~ '^[1-9][0-9]{6,14}$' OR p_nonce IS NULL THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 SELECT * INTO leg FROM public.voice_whatsapp_sessions s WHERE s.phone_number_id=p_phone_number_id AND s.waba_id=p_waba_id AND s.direction='outbound'
 AND(s.provider_call_id=p_provider_call_id OR(s.provider_call_id IS NULL AND s.call_id=p_callback_call_id)) LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR leg.peer<>p_peer THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 IF leg.state IN ('accepted','connected','connecting','terminated') THEN RETURN jsonb_build_object('claimed',false,'call_id',leg.call_id,'state',leg.state);END IF;
 IF leg.state NOT IN ('starting','initiated','uncertain') OR leg.created_at<clock_timestamp()-interval '2 minutes' THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 IF EXISTS(SELECT 1 FROM public.voice_whatsapp_terminations WHERE connection_id=leg.connection_id AND provider_call_id=p_provider_call_id) THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 SELECT * INTO call FROM public.voice_calls WHERE id=leg.call_id AND workspace_id=leg.workspace_id FOR UPDATE;
 SELECT * INTO policy FROM public.voice_whatsapp_settings WHERE workspace_id=leg.workspace_id AND connection_id=leg.connection_id;
 IF call.id IS NULL OR call.ended_at IS NOT NULL OR policy.workspace_id IS NULL OR NOT policy.outbound_enabled OR NOT public.workspace_billing_write_allowed(leg.workspace_id)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_config c WHERE c.id=leg.connection_id AND c.workspace_id=leg.workspace_id AND c.status='connected' AND c.phone_number_id=p_phone_number_id AND c.waba_id=p_waba_id)
 THEN RAISE EXCEPTION 'whatsapp_voice_not_allowed';END IF;
 UPDATE public.voice_whatsapp_sessions SET provider_call_id=p_provider_call_id,state='connecting',nonce=p_nonce,updated_at=clock_timestamp() WHERE call_id=leg.call_id;
 UPDATE public.voice_calls SET context=jsonb_set(context,'{__whatsapp_call,providerCallId}',to_jsonb(p_provider_call_id)),external_call_id='whatsapp:'||leg.connection_id::text||':'||p_provider_call_id WHERE id=leg.call_id RETURNING * INTO call;
 RETURN jsonb_build_object('claimed',true,'call',to_jsonb(call),'binding',call.context->'__whatsapp_call','nonce',p_nonce);
END $$;

CREATE FUNCTION public.claim_voice_whatsapp_termination(p_waba_id text,p_phone_number_id text,p_provider_call_id text,p_peer text,p_direction text,p_nonce uuid,p_callback_call_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE leg public.voice_whatsapp_sessions;connection uuid;workspace uuid;matches integer;call public.voice_calls;
BEGIN
 IF p_waba_id IS NULL OR p_waba_id !~ '^[0-9]{1,32}$' OR p_phone_number_id IS NULL OR p_phone_number_id !~ '^[0-9]{1,32}$'
 OR p_provider_call_id IS NULL OR length(p_provider_call_id)>256 OR length(p_provider_call_id)=0 OR p_provider_call_id ~ '[[:space:][:cntrl:]]' OR p_peer IS NULL OR p_peer !~ '^[1-9][0-9]{6,14}$'
 OR p_direction IS NULL OR p_direction NOT IN ('inbound','outbound') OR p_nonce IS NULL THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 SELECT * INTO leg FROM public.voice_whatsapp_sessions s WHERE s.phone_number_id=p_phone_number_id AND s.waba_id=p_waba_id
 AND(s.provider_call_id=p_provider_call_id OR(s.provider_call_id IS NULL AND s.direction='outbound' AND s.call_id=p_callback_call_id)) LIMIT 1;
 IF FOUND THEN
  IF leg.peer<>p_peer OR leg.direction<>p_direction THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
  connection=leg.connection_id;workspace=leg.workspace_id;
 ELSE
  SELECT count(*) INTO matches FROM public.whatsapp_config c WHERE c.phone_number_id=p_phone_number_id AND c.waba_id=p_waba_id AND c.status='connected' AND c.workspace_id IS NOT NULL;
  IF matches<>1 THEN RAISE EXCEPTION 'whatsapp_voice_connection_unavailable';END IF;
  SELECT c.id,c.workspace_id INTO connection,workspace FROM public.whatsapp_config c WHERE c.phone_number_id=p_phone_number_id AND c.waba_id=p_waba_id AND c.status='connected' AND c.workspace_id IS NOT NULL;
 END IF;
 -- Same lock order as reservation, including an unknown terminate that races
 -- the first connect. Read again only after owning the workspace lock.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('whatsapp-voice-workspace:'||workspace::text,0));
 SELECT * INTO leg FROM public.voice_whatsapp_sessions s WHERE s.connection_id=connection
 AND(s.provider_call_id=p_provider_call_id OR(s.provider_call_id IS NULL AND s.direction='outbound' AND s.call_id=p_callback_call_id)) FOR UPDATE;
 IF FOUND AND(leg.peer<>p_peer OR leg.direction<>p_direction OR leg.phone_number_id<>p_phone_number_id OR leg.waba_id<>p_waba_id) THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 INSERT INTO public.voice_whatsapp_terminations(connection_id,provider_call_id) VALUES(connection,p_provider_call_id) ON CONFLICT(connection_id,provider_call_id) DO NOTHING;
 IF leg.call_id IS NULL OR leg.state='terminated' THEN RETURN jsonb_build_object('claimed',false);END IF;
 UPDATE public.voice_whatsapp_sessions SET provider_call_id=p_provider_call_id,state='terminated',cleanup_state='pending',nonce=p_nonce,updated_at=clock_timestamp() WHERE call_id=leg.call_id;
 UPDATE public.voice_calls SET context=jsonb_set(context,'{__whatsapp_call,providerCallId}',to_jsonb(p_provider_call_id)),external_call_id='whatsapp:'||connection::text||':'||p_provider_call_id WHERE id=leg.call_id;
 SELECT * INTO call FROM public.voice_calls WHERE id=leg.call_id;
 -- A signed terminate proves the physical leg ended. It does not prove
 -- LiveKit cleanup, media usage settlement or finalization succeeded.
 RETURN jsonb_build_object('claimed',true,'call_id',leg.call_id,'binding',call.context->'__whatsapp_call','nonce',p_nonce);
END $$;

CREATE FUNCTION public.mark_voice_whatsapp_connected(p_call_id uuid,p_room text,p_customer_identity text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE leg public.voice_whatsapp_sessions;call public.voice_calls;
BEGIN
 IF p_call_id IS NULL OR p_room IS NULL OR p_room<>'voice_'||p_call_id::text OR p_customer_identity IS NULL OR p_customer_identity<>'whatsapp-'||p_call_id::text THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 SELECT * INTO leg FROM public.voice_whatsapp_sessions WHERE call_id=p_call_id FOR UPDATE;
 SELECT * INTO call FROM public.voice_calls WHERE id=p_call_id FOR UPDATE;
 IF leg.call_id IS NULL OR call.id IS NULL OR leg.state NOT IN ('starting','initiated','accepted','connecting','connected','uncertain') OR call.ended_at IS NOT NULL
 OR public.voice_whatsapp_call_context(p_call_id) IS NULL THEN RAISE EXCEPTION 'whatsapp_voice_changed';END IF;
 UPDATE public.voice_whatsapp_sessions SET state='connected',updated_at=clock_timestamp() WHERE call_id=p_call_id;
 UPDATE public.voice_calls SET status='in_progress',answered_at=COALESCE(answered_at,clock_timestamp()) WHERE id=p_call_id;
 RETURN true;
END $$;
CREATE FUNCTION public.claim_voice_whatsapp_business_end(p_call_id uuid,p_room text,p_customer_identity text,p_nonce uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE leg public.voice_whatsapp_sessions;call public.voice_calls;workspace uuid;
BEGIN
 IF p_call_id IS NULL OR p_nonce IS NULL OR p_room IS NULL OR p_room<>'voice_'||p_call_id::text OR p_customer_identity IS NULL OR p_customer_identity<>'whatsapp-'||p_call_id::text THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 SELECT workspace_id INTO workspace FROM public.voice_whatsapp_sessions WHERE call_id=p_call_id;
 IF workspace IS NULL THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('whatsapp-voice-workspace:'||workspace::text,0));
 SELECT * INTO leg FROM public.voice_whatsapp_sessions WHERE call_id=p_call_id FOR UPDATE;
 IF leg.state='terminated' OR leg.provider_call_id IS NULL THEN RETURN jsonb_build_object('claimed',false);END IF;
 SELECT * INTO call FROM public.voice_calls WHERE id=p_call_id AND workspace_id=workspace;
 IF call.id IS NULL THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 UPDATE public.voice_whatsapp_sessions SET state='terminated',cleanup_state='pending',nonce=p_nonce,updated_at=clock_timestamp() WHERE call_id=p_call_id;
 RETURN jsonb_build_object('claimed',true,'call_id',p_call_id,'binding',call.context->'__whatsapp_call','nonce',p_nonce);
END $$;

CREATE FUNCTION public.voice_whatsapp_call_context(p_call_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('call',to_jsonb(v),'binding',v.context->'__whatsapp_call','state',s.state,'nonce',s.nonce)
 FROM public.voice_whatsapp_sessions s JOIN public.voice_calls v ON v.id=s.call_id AND v.workspace_id=s.workspace_id
 JOIN public.whatsapp_config c ON c.id=s.connection_id AND c.workspace_id=s.workspace_id
 JOIN public.voice_whatsapp_settings p ON p.workspace_id=s.workspace_id AND p.connection_id=s.connection_id
 JOIN public.workspaces w ON w.id=s.workspace_id AND w.deleted_at IS NULL
 WHERE p_call_id IS NOT NULL AND s.call_id=p_call_id AND s.state IN ('starting','initiated','accepted','connecting','connected','uncertain') AND v.ended_at IS NULL
 AND c.status='connected' AND c.phone_number_id=s.phone_number_id AND c.waba_id=s.waba_id AND public.workspace_billing_write_allowed(s.workspace_id)
 AND NOT EXISTS(SELECT 1 FROM public.voice_whatsapp_terminations t WHERE t.connection_id=s.connection_id AND t.provider_call_id=s.provider_call_id)
 AND NOT EXISTS(SELECT 1 FROM public.whatsapp_config duplicate WHERE duplicate.id<>c.id AND duplicate.status='connected' AND duplicate.phone_number_id=c.phone_number_id)
 AND NOT EXISTS(SELECT 1 FROM public.channel_connections voice WHERE voice.workspace_id=s.workspace_id AND voice.channel='voice' AND voice.config->>'kill_switch'='true')
 AND EXISTS(SELECT 1 FROM public.ai_agents a WHERE a.id=v.agent_id AND a.workspace_id=s.workspace_id AND a.is_active=true AND a.voice_enabled=true AND a.deleted_at IS NULL
 AND(a.scope='workspace' OR EXISTS(SELECT 1 FROM public.ai_agent_channels ac WHERE ac.agent_id=a.id AND ac.channel='voice')))
 AND(s.direction='inbound' OR(public.voice_whatsapp_admin(s.workspace_id,s.actor_id) AND EXISTS(SELECT 1 FROM public.contacts contact WHERE contact.id=v.contact_id AND contact.workspace_id=s.workspace_id AND contact.voice_opt_out IS NOT TRUE AND contact.phone IN(s.peer,'+'||s.peer))))
 AND((s.direction='inbound' AND p.inbound_enabled) OR(s.direction='outbound' AND p.outbound_enabled));
$$;
CREATE FUNCTION public.whatsapp_calling_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM(VALUES('voice_whatsapp_sessions'),('voice_whatsapp_settings'),('voice_whatsapp_terminations')) expected(name)
 WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=expected.name AND c.relrowsecurity
 AND NOT pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
 AND NOT pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
 AND NOT EXISTS(SELECT 1 FROM(VALUES('voice_whatsapp_sessions','actor_id'),('voice_whatsapp_sessions','cleanup_state'),('voice_whatsapp_sessions','cleanup_finished_at')) expected(table_name,column_name)
 WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=expected.table_name AND a.attname=expected.column_name AND NOT a.attisdropped AND a.attnum>0))
 AND NOT EXISTS(SELECT 1 FROM(VALUES('voice_whatsapp_settings_read'),('set_voice_whatsapp_settings'),('voice_whatsapp_connection_policy'),('reserve_voice_whatsapp_call'),('finish_voice_whatsapp_operation'),('voice_whatsapp_call_context'),('voice_whatsapp_operation_current'),('claim_voice_whatsapp_answer'),('claim_voice_whatsapp_termination'),('mark_voice_whatsapp_connected'),('claim_voice_whatsapp_business_end'),('voice_whatsapp_outbound_receipt'),('finish_voice_whatsapp_cleanup'),('cancel_voice_whatsapp_preflight'),('purge_voice_whatsapp_control')) expected(name)
 WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=expected.name AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[]
 AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')));
$$;
CREATE FUNCTION public.voice_whatsapp_outbound_receipt(p_workspace_id uuid,p_actor_id uuid,p_call_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb;
BEGIN
 IF p_call_id IS NULL OR NOT public.voice_whatsapp_admin(p_workspace_id,p_actor_id) THEN RAISE EXCEPTION 'whatsapp_voice_not_found';END IF;
 SELECT jsonb_build_object('callId',s.call_id,'contactId',v.contact_id,'state',s.state,'status',v.status,'cleanupState',s.cleanup_state,
 'providerEnded',EXISTS(SELECT 1 FROM public.voice_whatsapp_terminations t WHERE t.connection_id=s.connection_id AND t.provider_call_id=s.provider_call_id)) INTO receipt
 FROM public.voice_whatsapp_sessions s JOIN public.voice_calls v ON v.id=s.call_id AND v.workspace_id=s.workspace_id
 WHERE s.call_id=p_call_id AND s.workspace_id=p_workspace_id AND s.actor_id=p_actor_id AND s.direction='outbound';
 RETURN receipt;
END $$;

CREATE FUNCTION public.finish_voice_whatsapp_cleanup(p_call_id uuid,p_nonce uuid,p_acknowledged boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_call_id IS NULL OR p_nonce IS NULL OR p_acknowledged IS NULL THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 UPDATE public.voice_whatsapp_sessions SET cleanup_state=CASE WHEN p_acknowledged THEN 'acknowledged' ELSE 'uncertain' END,cleanup_finished_at=clock_timestamp()
 WHERE call_id=p_call_id AND nonce=p_nonce AND state='terminated' AND cleanup_state='pending';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.cancel_voice_whatsapp_preflight(p_call_id uuid,p_nonce uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE leg public.voice_whatsapp_sessions;
BEGIN
 IF p_call_id IS NULL OR p_nonce IS NULL THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 SELECT * INTO leg FROM public.voice_whatsapp_sessions WHERE call_id=p_call_id AND nonce=p_nonce AND state='starting' FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE public.voice_whatsapp_sessions SET state='terminated',updated_at=clock_timestamp() WHERE call_id=p_call_id;
 UPDATE public.voice_calls SET status='canceled',ended_at=clock_timestamp() WHERE id=p_call_id AND ended_at IS NULL;
 RETURN true;
END $$;
CREATE FUNCTION public.purge_voice_whatsapp_control(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tombstones integer;sessions integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'invalid_whatsapp_voice';END IF;
 WITH targets AS(SELECT connection_id,provider_call_id FROM public.voice_whatsapp_terminations WHERE received_at<clock_timestamp()-interval '1 day'
 ORDER BY received_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM public.voice_whatsapp_terminations t USING targets WHERE t.connection_id=targets.connection_id AND t.provider_call_id=targets.provider_call_id;
 GET DIAGNOSTICS tombstones=ROW_COUNT;
 WITH targets AS(SELECT s.call_id FROM public.voice_whatsapp_sessions s JOIN public.voice_calls v ON v.id=s.call_id
 WHERE v.ended_at<clock_timestamp()-interval '30 days' AND v.status NOT IN ('queued','dialing','in_progress')
 AND s.updated_at<clock_timestamp()-interval '30 days' ORDER BY s.updated_at LIMIT p_limit FOR UPDATE OF s SKIP LOCKED)
 DELETE FROM public.voice_whatsapp_sessions WHERE call_id IN(SELECT call_id FROM targets);
 GET DIAGNOSTICS sessions=ROW_COUNT;RETURN jsonb_build_object('tombstones',tombstones,'sessions',sessions);
END $$;

-- Termination cleanup remains authorized on the immutable physical leg even
-- when a merchant turned off new calls. No current-policy check can strand it.
CREATE OR REPLACE FUNCTION public.voice_whatsapp_operation_current(p_call_id uuid,p_nonce uuid,p_operation text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(p_call_id IS NOT NULL AND p_nonce IS NOT NULL AND p_operation IN ('accept','dial','connect','disconnect') AND EXISTS(
 SELECT 1 FROM public.voice_whatsapp_sessions s JOIN public.voice_calls v ON v.id=s.call_id AND v.workspace_id=s.workspace_id
 WHERE s.call_id=p_call_id AND s.nonce=p_nonce AND((p_operation='disconnect' AND s.provider_call_id IS NOT NULL AND s.state='terminated' AND s.updated_at>clock_timestamp()-interval '30 seconds')
 OR(v.ended_at IS NULL AND public.voice_whatsapp_call_context(p_call_id) IS NOT NULL
 AND((p_operation='accept' AND s.direction='inbound' AND s.state='starting')
 OR(p_operation='dial' AND s.direction='outbound' AND s.state='starting' AND s.provider_call_id IS NULL)
 OR(p_operation='connect' AND s.direction='outbound' AND s.state='connecting' AND s.provider_call_id IS NOT NULL))
 AND s.updated_at>clock_timestamp()-interval '30 seconds'))),false);
$$;

REVOKE ALL ON FUNCTION public.voice_whatsapp_admin(uuid,uuid),public.voice_whatsapp_settings_read(uuid,uuid),public.voice_whatsapp_connection_policy(uuid),public.set_voice_whatsapp_settings(uuid,uuid,boolean,boolean,text),
public.reserve_voice_whatsapp_call(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer),public.voice_whatsapp_operation_current(uuid,uuid,text),
public.finish_voice_whatsapp_operation(uuid,uuid,text,text),public.voice_whatsapp_call_context(uuid),public.whatsapp_calling_ready() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_voice_whatsapp_answer(text,text,text,text,uuid,uuid),public.claim_voice_whatsapp_termination(text,text,text,text,text,uuid,uuid),public.mark_voice_whatsapp_connected(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_voice_whatsapp_business_end(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.voice_whatsapp_outbound_receipt(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_whatsapp_settings_read(uuid,uuid),public.voice_whatsapp_connection_policy(uuid),public.set_voice_whatsapp_settings(uuid,uuid,boolean,boolean,text),
public.reserve_voice_whatsapp_call(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer),public.voice_whatsapp_operation_current(uuid,uuid,text),
public.finish_voice_whatsapp_operation(uuid,uuid,text,text),public.voice_whatsapp_call_context(uuid),public.whatsapp_calling_ready() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_voice_whatsapp_answer(text,text,text,text,uuid,uuid),public.claim_voice_whatsapp_termination(text,text,text,text,text,uuid,uuid),public.mark_voice_whatsapp_connected(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_voice_whatsapp_business_end(uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.voice_whatsapp_outbound_receipt(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finish_voice_whatsapp_cleanup(uuid,uuid,boolean),public.purge_voice_whatsapp_control(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_voice_whatsapp_cleanup(uuid,uuid,boolean),public.purge_voice_whatsapp_control(integer) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_voice_whatsapp_preflight(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_voice_whatsapp_preflight(uuid,uuid) TO service_role;

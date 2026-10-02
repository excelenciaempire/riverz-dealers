-- X4 native merchant-owned Telnyx SMS. No provisioning, provider requests,
-- customer changes, sends or wallet charges occur when this schema is installed.
-- All new rows are private. Service-role RPCs must receive a server-authenticated
-- actor; browser roles cannot grant consent, claim sends or read credentials.
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_channel_check CHECK(channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat','sms'));
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_channel_check CHECK(channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat','sms'));
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_channel_check CHECK(channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat','sms'));
ALTER TABLE public.channel_connections DROP CONSTRAINT IF EXISTS channel_connections_channel_check;
ALTER TABLE public.channel_connections ADD CONSTRAINT channel_connections_channel_check CHECK(channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat','sms'));

CREATE TABLE public.native_sms_settings(
 connection_id uuid PRIMARY KEY REFERENCES public.channel_connections(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 phone_number_id text NOT NULL CHECK(length(phone_number_id) BETWEEN 1 AND 128 AND phone_number_id !~ '[[:space:][:cntrl:]]'),
 phone text NOT NULL CHECK(phone ~ '^\+[1-9][0-9]{6,14}$'),profile_id uuid NOT NULL,organization_id text NOT NULL CHECK(length(organization_id) BETWEEN 1 AND 128 AND organization_id !~ '[[:space:][:cntrl:]]'),
 encrypted_key text NOT NULL CHECK(length(encrypted_key) BETWEEN 60 AND 9000),
 public_key text NOT NULL CHECK(public_key ~ '^[A-Za-z0-9+/]{43}=$'),
 revision uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 max_segments integer NOT NULL DEFAULT 3 CHECK(max_segments BETWEEN 1 AND 10),
 daily_segments integer NOT NULL DEFAULT 100 CHECK(daily_segments BETWEEN 1 AND 10000),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,profile_id),UNIQUE(workspace_id),UNIQUE(organization_id,phone)
);
CREATE TABLE public.native_sms_consents(
 connection_id uuid NOT NULL REFERENCES public.native_sms_settings(connection_id) ON DELETE CASCADE,
 peer text NOT NULL CHECK(peer ~ '^\+[1-9][0-9]{6,14}$'),allowed boolean NOT NULL,
 evidence text NOT NULL CHECK(length(evidence) BETWEEN 1 AND 1000),source text NOT NULL CHECK(source IN ('human','START','STOP')),
 occurred_at timestamptz NOT NULL,actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 PRIMARY KEY(connection_id,peer)
);
CREATE TABLE public.native_sms_attempts(
 id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES public.native_sms_settings(connection_id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 revision uuid NOT NULL,peer text NOT NULL CHECK(peer ~ '^\+[1-9][0-9]{6,14}$'),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 6700),
 segments integer NOT NULL CHECK(segments BETWEEN 1 AND 10),nonce uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('reviewed','dispatching','accepted','uncertain','canceled')),
 provider_id uuid,provider_status text CHECK(provider_status IN ('queued','sending','sent','expired','sending_failed','delivery_unconfirmed','delivered','delivery_failed','read')),
 provider_parts integer CHECK(provider_parts BETWEEN 1 AND 10),provider_cost jsonb,
 final_event boolean NOT NULL DEFAULT false,status_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),claimed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(connection_id,provider_id)
);
CREATE INDEX native_sms_peer_attempts ON public.native_sms_attempts(connection_id,peer,created_at DESC);
CREATE TABLE public.native_sms_events(
 event_id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES public.native_sms_settings(connection_id) ON DELETE CASCADE,
 message_id uuid NOT NULL,event_type text NOT NULL CHECK(event_type IN ('message.received','message.sent','message.finalized')),
 event_at timestamptz NOT NULL,payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done','failed')),
 nonce uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz
);
CREATE INDEX native_sms_queue ON public.native_sms_events(state,lease_until,created_at);
ALTER TABLE public.native_sms_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_sms_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_sms_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_sms_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.native_sms_settings,public.native_sms_consents,public.native_sms_attempts,public.native_sms_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.native_expansion_actor(p_workspace_id uuid,p_actor_id uuid,p_section text,p_admin boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_workspace_id IS NOT NULL AND p_actor_id IS NOT NULL AND p_section IN ('/ajustes','/bandeja') AND p_admin IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND(w.owner_id=p_actor_id OR EXISTS(
 SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent') AND(NOT p_admin OR m.role='admin')
 AND(m.allowed_sections IS NULL OR(jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? p_section)))));
$$;
CREATE FUNCTION public.native_sms_settings_read(p_workspace_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE settings public.native_sms_settings;
BEGIN
 IF NOT public.native_expansion_actor(p_workspace_id,p_actor_id,'/ajustes',true) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO settings FROM public.native_sms_settings WHERE workspace_id=p_workspace_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('configured',false,'enabled',false);END IF;
 RETURN jsonb_build_object('configured',true,'connectionId',settings.connection_id,'revision',settings.revision,'phoneNumberId',settings.phone_number_id,'phone',settings.phone,'profileId',settings.profile_id,'organizationId',settings.organization_id,
 'enabled',settings.enabled AND EXISTS(SELECT 1 FROM public.channel_connections WHERE id=settings.connection_id AND workspace_id=p_workspace_id AND channel='sms' AND status='connected'),
 'maxSegments',settings.max_segments,'dailySegments',settings.daily_segments,'inboundQueue',jsonb_build_object(
 'pending',(SELECT count(*) FROM public.native_sms_events WHERE connection_id=settings.connection_id AND state IN ('pending','processing')),
 'failed',(SELECT count(*) FROM public.native_sms_events WHERE connection_id=settings.connection_id AND state='failed')));
END $$;
CREATE FUNCTION public.retry_native_sms_inbox(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_limit integer DEFAULT 20) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_expansion_actor(p_workspace_id,p_actor_id,'/ajustes',true)
 OR NOT EXISTS(SELECT 1 FROM public.native_sms_settings WHERE workspace_id=p_workspace_id AND connection_id=p_connection_id AND enabled)
 OR NOT EXISTS(SELECT 1 FROM public.channel_connections WHERE id=p_connection_id AND workspace_id=p_workspace_id AND channel='sms' AND status='connected') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 WITH selected AS(SELECT event_id FROM public.native_sms_events WHERE connection_id=p_connection_id AND state='failed' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT p_limit)
 UPDATE public.native_sms_events e SET state='pending',attempts=0,nonce=NULL,lease_until=NULL,finished_at=NULL FROM selected s WHERE s.event_id=e.event_id;
 GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed;
END $$;
CREATE FUNCTION public.purge_native_sms_control(p_grace_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed_events integer;removed_connections integer;
BEGIN
 IF p_grace_days IS NULL OR p_grace_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 -- Match the existing soft-workspace purge grace; no active merchant keys
 -- or unresolved inbound queue items are expired by a normal event sweep.
 DELETE FROM public.native_sms_settings s USING public.workspaces w WHERE s.workspace_id=w.id AND w.deleted_at<clock_timestamp()-p_grace_days*interval '1 day';
 GET DIAGNOSTICS removed_connections=ROW_COUNT;
 DELETE FROM public.native_sms_events WHERE event_id IN(SELECT event_id FROM public.native_sms_events WHERE state='done' AND created_at<clock_timestamp()-interval '30 days' ORDER BY created_at LIMIT 5000);
 GET DIAGNOSTICS removed_events=ROW_COUNT;
 RETURN jsonb_build_object('connections',removed_connections,'events',removed_events);
END $$;
CREATE FUNCTION public.set_native_sms_settings(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_revision uuid,p_identity jsonb,p_encrypted_key text,p_public_key text,p_enabled boolean,p_max_segments integer,p_daily_segments integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.native_sms_settings;connection_row public.channel_connections;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_connection_id IS NULL OR p_revision IS NULL OR p_enabled IS NULL OR p_max_segments IS NULL OR p_max_segments NOT BETWEEN 1 AND 10 OR p_daily_segments IS NULL OR p_daily_segments NOT BETWEEN 1 AND 10000
 OR p_identity IS NULL OR jsonb_typeof(p_identity)<>'object' OR(p_identity-'phoneNumberId'-'phone'-'profileId'-'organizationId')<>'{}'::jsonb
 OR COALESCE(p_identity->>'phone','') !~ '^\+[1-9][0-9]{6,14}$' OR COALESCE(p_identity->>'profileId','') !~ '^[0-9a-fA-F-]{36}$'
 OR length(COALESCE(p_identity->>'phoneNumberId','')) NOT BETWEEN 1 AND 128 OR COALESCE(p_identity->>'phoneNumberId','') ~ '[[:space:][:cntrl:]]'
 OR length(COALESCE(p_identity->>'organizationId','')) NOT BETWEEN 1 AND 128 OR COALESCE(p_identity->>'organizationId','') ~ '[[:space:][:cntrl:]]'
 OR p_encrypted_key IS NULL OR length(p_encrypted_key) NOT BETWEEN 60 AND 9000 OR p_public_key IS NULL OR p_public_key !~ '^[A-Za-z0-9+/]{43}=$' THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_expansion_actor(p_workspace_id,p_actor_id,'/ajustes',true) OR(p_enabled AND NOT public.workspace_billing_write_allowed(p_workspace_id)) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-profile:'||(p_identity->>'organizationId')||':'||(p_identity->>'profileId'),0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-workspace:'||p_workspace_id::text,0));
 SELECT * INTO previous FROM public.native_sms_settings WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF FOUND AND(previous.connection_id<>p_connection_id OR previous.phone_number_id<>p_identity->>'phoneNumberId' OR previous.phone<>p_identity->>'phone' OR previous.profile_id<>(p_identity->>'profileId')::uuid OR previous.organization_id<>p_identity->>'organizationId') THEN RAISE EXCEPTION 'expansion_changed';END IF;
 IF EXISTS(SELECT 1 FROM public.native_sms_settings WHERE workspace_id<>p_workspace_id AND(organization_id=p_identity->>'organizationId' AND(profile_id=(p_identity->>'profileId')::uuid OR phone=p_identity->>'phone'))) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO connection_row FROM public.channel_connections WHERE id=p_connection_id FOR UPDATE;
 IF FOUND AND(connection_row.workspace_id<>p_workspace_id OR connection_row.channel<>'sms') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 IF NOT FOUND THEN
  INSERT INTO public.channel_connections(id,workspace_id,channel,label,status,external_account_id,config,secrets,created_by)
  VALUES(p_connection_id,p_workspace_id,'sms','SMS','disconnected',p_identity->>'phone','{}'::jsonb,'{}'::jsonb,p_actor_id);
 END IF;
 INSERT INTO public.native_sms_settings(connection_id,workspace_id,phone_number_id,phone,profile_id,organization_id,encrypted_key,public_key,revision,enabled,max_segments,daily_segments,updated_by)
 VALUES(p_connection_id,p_workspace_id,p_identity->>'phoneNumberId',p_identity->>'phone',(p_identity->>'profileId')::uuid,p_identity->>'organizationId',p_encrypted_key,p_public_key,p_revision,p_enabled,p_max_segments,p_daily_segments,p_actor_id)
 ON CONFLICT(connection_id) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,public_key=EXCLUDED.public_key,revision=EXCLUDED.revision,enabled=EXCLUDED.enabled,max_segments=EXCLUDED.max_segments,daily_segments=EXCLUDED.daily_segments,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 UPDATE public.channel_connections SET status=CASE WHEN p_enabled THEN 'connected' ELSE 'disconnected' END,external_account_id=p_identity->>'phone',config=jsonb_build_object('phone',p_identity->>'phone','native_sms',true),secrets='{}'::jsonb,updated_at=clock_timestamp() WHERE id=p_connection_id AND workspace_id=p_workspace_id AND channel='sms';
 RETURN public.native_sms_settings_read(p_workspace_id,p_actor_id);
END $$;
CREATE FUNCTION public.native_sms_private_connection(p_connection_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(s) FROM public.native_sms_settings s JOIN public.channel_connections c ON c.id=s.connection_id AND c.workspace_id=s.workspace_id AND c.channel='sms'
 JOIN public.workspaces w ON w.id=s.workspace_id AND w.deleted_at IS NULL WHERE s.connection_id=p_connection_id;
$$;
CREATE FUNCTION public.native_sms_consent(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_peer text,p_allowed boolean,p_evidence text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_peer IS NULL OR p_peer !~ '^\+[1-9][0-9]{6,14}$' OR p_allowed IS NULL OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_expansion_actor(p_workspace_id,p_actor_id,'/bandeja') OR NOT public.workspace_billing_write_allowed(p_workspace_id)
 OR NOT EXISTS(SELECT 1 FROM public.native_sms_settings WHERE connection_id=p_connection_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 IF p_allowed AND EXISTS(SELECT 1 FROM public.native_sms_consents WHERE connection_id=p_connection_id AND peer=p_peer AND source='STOP' AND NOT allowed) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 INSERT INTO public.native_sms_consents(connection_id,peer,allowed,evidence,source,occurred_at,actor_id) VALUES(p_connection_id,p_peer,p_allowed,p_evidence,'human',clock_timestamp(),p_actor_id)
 ON CONFLICT(connection_id,peer) DO UPDATE SET allowed=EXCLUDED.allowed,evidence=EXCLUDED.evidence,source=EXCLUDED.source,occurred_at=EXCLUDED.occurred_at,actor_id=EXCLUDED.actor_id;
 RETURN true;
END $$;
CREATE FUNCTION public.native_sms_peer_policy(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_peer text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_sms_settings;consent public.native_sms_consents;
BEGIN
 IF p_peer IS NULL OR p_peer !~ '^\+[1-9][0-9]{6,14}$' THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_expansion_actor(p_workspace_id,p_actor_id,'/bandeja') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO setting FROM public.native_sms_settings WHERE workspace_id=p_workspace_id AND connection_id=p_connection_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO consent FROM public.native_sms_consents WHERE connection_id=p_connection_id AND peer=p_peer;
 RETURN jsonb_build_object('connectionId',setting.connection_id,'phone',setting.phone,'revision',setting.revision,'enabled',setting.enabled AND EXISTS(SELECT 1 FROM public.channel_connections WHERE id=setting.connection_id AND workspace_id=p_workspace_id AND channel='sms' AND status='connected'),'maxSegments',setting.max_segments,'dailySegments',setting.daily_segments,'consent',COALESCE(consent.allowed,false),'consentSource',consent.source,'consentAt',consent.occurred_at);
END $$;
CREATE FUNCTION public.native_sms_receipt(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_sms_attempts;
BEGIN
 IF NOT public.native_expansion_actor(p_workspace_id,p_actor_id,'/bandeja') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO attempt FROM public.native_sms_attempts WHERE id=p_attempt_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('attemptId',attempt.id,'conversationId',attempt.conversation_id,'contactId',attempt.contact_id,'peer',attempt.peer,'text',attempt.body,'segments',attempt.segments,'state',attempt.state,'providerStatus',attempt.provider_status,'providerParts',attempt.provider_parts,'cost',attempt.provider_cost,'deliveryConfirmed',COALESCE(attempt.provider_status IN ('delivered','read'),false),'createdAt',attempt.created_at,'updatedAt',attempt.updated_at);
END $$;
CREATE FUNCTION public.review_native_sms_send(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid,p_connection_id uuid,p_conversation_id uuid,p_contact_id uuid,p_revision uuid,p_peer text,p_body text,p_segments integer,p_nonce uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.native_sms_attempts;setting public.native_sms_settings;conversation public.conversations;
BEGIN
 IF p_attempt_id IS NULL OR p_nonce IS NULL OR p_revision IS NULL OR p_peer IS NULL OR p_peer !~ '^\+[1-9][0-9]{6,14}$' OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 6700 OR p_segments IS NULL OR p_segments NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_expansion_actor(p_workspace_id,p_actor_id,'/bandeja') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-workspace:'||p_workspace_id::text,0));
 SELECT * INTO previous FROM public.native_sms_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF FOUND THEN
  IF previous.workspace_id<>p_workspace_id OR previous.actor_id<>p_actor_id OR previous.connection_id<>p_connection_id OR previous.conversation_id<>p_conversation_id OR previous.contact_id<>p_contact_id OR previous.peer<>p_peer OR previous.body<>p_body OR previous.segments<>p_segments THEN RAISE EXCEPTION 'expansion_changed';END IF;
  RETURN jsonb_build_object('claimed',false,'receipt',public.native_sms_receipt(p_workspace_id,p_actor_id,p_attempt_id));
 END IF;
 SELECT * INTO setting FROM public.native_sms_settings WHERE connection_id=p_connection_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR setting.revision<>p_revision OR NOT setting.enabled OR p_segments>setting.max_segments THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO conversation FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND contact_id=p_contact_id AND connection_id=p_connection_id AND channel='sms' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR conversation.is_spam IS DISTINCT FROM false OR NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=p_contact_id AND workspace_id=p_workspace_id AND channel='sms' AND external_id=p_peer)
 OR NOT EXISTS(SELECT 1 FROM public.channel_connections WHERE id=p_connection_id AND workspace_id=p_workspace_id AND channel='sms' AND status='connected')
 OR NOT EXISTS(SELECT 1 FROM public.native_sms_consents WHERE connection_id=p_connection_id AND peer=p_peer AND allowed=true)
 OR NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 IF EXISTS(SELECT 1 FROM public.native_sms_attempts WHERE connection_id=p_connection_id AND peer=p_peer AND(state IN ('dispatching','uncertain') OR(state IN ('reviewed','accepted') AND body=p_body AND created_at>clock_timestamp()-interval '10 minutes'))) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 IF(SELECT COALESCE(sum(GREATEST(segments,COALESCE(provider_parts,0))),0) FROM public.native_sms_attempts WHERE connection_id=p_connection_id AND state<>'canceled' AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+p_segments>setting.daily_segments THEN RAISE EXCEPTION 'expansion_limit';END IF;
 INSERT INTO public.native_sms_attempts(id,connection_id,workspace_id,actor_id,contact_id,conversation_id,revision,peer,body,segments,nonce,state)
 VALUES(p_attempt_id,p_connection_id,p_workspace_id,p_actor_id,p_contact_id,p_conversation_id,p_revision,p_peer,p_body,p_segments,p_nonce,'reviewed');
 RETURN jsonb_build_object('claimed',true,'attemptId',p_attempt_id,'nonce',p_nonce);
END $$;
CREATE FUNCTION public.claim_native_sms_send(p_attempt_id uuid,p_nonce uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_sms_attempts;
BEGIN
 SELECT * INTO attempt FROM public.native_sms_attempts WHERE id=p_attempt_id AND nonce=p_nonce FOR UPDATE;
 IF NOT FOUND OR attempt.state<>'reviewed' OR attempt.created_at<clock_timestamp()-interval '3 minutes' THEN RETURN false;END IF;
 IF NOT public.native_expansion_actor(attempt.workspace_id,attempt.actor_id,'/bandeja') OR NOT public.workspace_billing_write_allowed(attempt.workspace_id)
 OR NOT EXISTS(SELECT 1 FROM public.native_sms_settings s JOIN public.channel_connections c ON c.id=s.connection_id AND c.workspace_id=s.workspace_id AND c.channel='sms' AND c.status='connected'
 WHERE s.connection_id=attempt.connection_id AND s.workspace_id=attempt.workspace_id AND s.enabled AND s.revision=attempt.revision AND s.max_segments>=attempt.segments)
 OR NOT EXISTS(SELECT 1 FROM public.native_sms_consents WHERE connection_id=attempt.connection_id AND peer=attempt.peer AND allowed)
 OR NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=attempt.conversation_id AND workspace_id=attempt.workspace_id AND contact_id=attempt.contact_id AND connection_id=attempt.connection_id AND channel='sms' AND deleted_at IS NULL AND is_spam=false)
 OR NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=attempt.contact_id AND workspace_id=attempt.workspace_id AND channel='sms' AND external_id=attempt.peer)
 OR(SELECT COALESCE(sum(GREATEST(a.segments,COALESCE(a.provider_parts,0))),0) FROM public.native_sms_attempts a WHERE a.connection_id=attempt.connection_id AND a.state<>'canceled' AND a.created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>(SELECT daily_segments FROM public.native_sms_settings WHERE connection_id=attempt.connection_id) THEN RETURN false;END IF;
 UPDATE public.native_sms_attempts SET state='dispatching',claimed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=attempt.id;
 RETURN true;
END $$;
CREATE FUNCTION public.finish_native_sms_send(p_attempt_id uuid,p_nonce uuid,p_outcome text,p_provider_id uuid DEFAULT NULL,p_status text DEFAULT NULL,p_parts integer DEFAULT NULL,p_cost jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_sms_attempts;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','uncertain','canceled') OR(p_outcome='accepted' AND(p_provider_id IS NULL OR p_status IS NULL OR p_status NOT IN ('queued','sending','sent','expired','sending_failed','delivery_unconfirmed','delivered','delivery_failed','read') OR p_parts IS NULL OR p_parts NOT BETWEEN 1 AND 10)) THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF p_cost IS NOT NULL AND(jsonb_typeof(p_cost)<>'object' OR COALESCE(p_cost->>'amount','') !~ '^[0-9]+(\.[0-9]{1,12})?$' OR length(p_cost->>'amount')>48 OR COALESCE(p_cost->>'currency','') !~ '^[A-Z]{3}$') THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 SELECT * INTO attempt FROM public.native_sms_attempts WHERE id=p_attempt_id AND nonce=p_nonce FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 IF attempt.state IN ('accepted','uncertain','canceled') THEN
  IF attempt.state<>p_outcome OR attempt.provider_id IS DISTINCT FROM p_provider_id THEN RAISE EXCEPTION 'expansion_changed';END IF;RETURN false;
 END IF;
 IF(p_outcome='canceled' AND attempt.state<>'reviewed') OR(p_outcome<>'canceled' AND attempt.state<>'dispatching') THEN RAISE EXCEPTION 'expansion_changed';END IF;
 UPDATE public.native_sms_attempts SET state=p_outcome,provider_id=p_provider_id,provider_status=p_status,provider_parts=p_parts,provider_cost=CASE WHEN p_cost IS NULL THEN NULL ELSE jsonb_build_object('amount',p_cost->>'amount','currency',p_cost->>'currency') END,status_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_attempt_id;
 -- Delivery callbacks may have arrived before the POST response. Merge only
 -- exact profile-scoped provider IDs, never infer a lost send from peer/text.
 IF p_outcome='accepted' THEN PERFORM public.apply_native_sms_receipts(attempt.connection_id,p_provider_id);PERFORM public.native_sms_inbox_message(p_attempt_id);END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.apply_native_sms_receipts(p_connection_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event public.native_sms_events;attempt public.native_sms_attempts;new_status text;new_cost jsonb;
BEGIN
 SELECT * INTO attempt FROM public.native_sms_attempts WHERE connection_id=p_connection_id AND provider_id=p_message_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 FOR event IN SELECT * FROM public.native_sms_events WHERE connection_id=p_connection_id AND message_id=p_message_id AND event_type IN ('message.sent','message.finalized') ORDER BY event_at,event_id LOOP
  IF event.payload->>'peer'<>attempt.peer OR event.payload->>'direction'<>'outbound' THEN CONTINUE;END IF;
  new_status=event.payload->>'status';new_cost=event.payload->'cost';
  IF(attempt.final_event AND event.event_type<>'message.finalized') OR(attempt.status_at IS NOT NULL AND event.event_at<attempt.status_at AND attempt.final_event) OR(attempt.provider_status='read') OR(attempt.provider_status='delivered' AND new_status<>'read') THEN CONTINUE;END IF;
  IF new_status NOT IN ('queued','sending','sent','expired','sending_failed','delivery_unconfirmed','delivered','delivery_failed','read') THEN CONTINUE;END IF;
  UPDATE public.native_sms_attempts SET provider_status=new_status,provider_parts=COALESCE((event.payload->>'parts')::integer,provider_parts),
   provider_cost=CASE WHEN new_cost IS NULL OR new_cost='null'::jsonb THEN provider_cost ELSE new_cost END,final_event=event.event_type='message.finalized',status_at=event.event_at,updated_at=clock_timestamp()
   WHERE id=attempt.id RETURNING * INTO attempt;
 END LOOP;
 PERFORM public.native_sms_inbox_message(attempt.id);
END $$;
CREATE FUNCTION public.native_sms_inbox_message(p_attempt_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_sms_attempts;external_id text;display_status text;
BEGIN
 SELECT * INTO attempt FROM public.native_sms_attempts WHERE id=p_attempt_id AND state='accepted';IF NOT FOUND OR attempt.provider_id IS NULL THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=attempt.conversation_id AND workspace_id=attempt.workspace_id AND connection_id=attempt.connection_id AND channel='sms' AND deleted_at IS NULL) THEN RETURN;END IF;
 external_id='sms:'||attempt.connection_id::text||':'||attempt.provider_id::text;
 display_status=CASE WHEN attempt.provider_status IN ('queued','sending') THEN 'sending' WHEN attempt.provider_status IN ('expired','sending_failed','delivery_failed') THEN 'failed' WHEN attempt.provider_status IN ('delivered','read') THEN attempt.provider_status ELSE 'sent' END;
 INSERT INTO public.messages(conversation_id,channel,sender_type,sender_id,content_type,content_text,message_id,status,created_at)
 VALUES(attempt.conversation_id,'sms','agent',attempt.actor_id,'text',attempt.body,external_id,display_status,COALESCE(attempt.claimed_at,attempt.created_at)) ON CONFLICT(conversation_id,message_id) DO NOTHING;
 UPDATE public.messages SET status=display_status,delivery_unconfirmed_at=CASE WHEN attempt.provider_status='delivery_unconfirmed' THEN COALESCE(delivery_unconfirmed_at,clock_timestamp()) ELSE NULL END
 WHERE conversation_id=attempt.conversation_id AND channel='sms' AND message_id=external_id;
 UPDATE public.conversations SET last_message_text=attempt.body,last_message_at=COALESCE(attempt.claimed_at,attempt.created_at),last_sender_type='agent',last_message_status=display_status
 WHERE id=attempt.conversation_id AND workspace_id=attempt.workspace_id AND channel='sms' AND(last_message_at IS NULL OR last_message_at<=COALESCE(attempt.claimed_at,attempt.created_at));
END $$;
CREATE FUNCTION public.enqueue_native_sms_event(p_connection_id uuid,p_event jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_sms_settings;previous public.native_sms_events;kind text;event_id uuid;message_id uuid;occurred timestamptz;action text;
BEGIN
 IF p_connection_id IS NULL OR p_event IS NULL OR jsonb_typeof(p_event)<>'object' OR length(p_event::text)>131072
 OR(p_event-'eventId'-'eventType'-'occurredAt'-'messageId'-'organizationId'-'profileId'-'direction'-'businessPhone'-'peer'-'text'-'status'-'optOutAction'-'parts'-'cost')<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 kind=p_event->>'eventType';event_id=(p_event->>'eventId')::uuid;message_id=(p_event->>'messageId')::uuid;occurred=(p_event->>'occurredAt')::timestamptz;
 IF event_id IS NULL OR message_id IS NULL OR occurred IS NULL OR occurred>clock_timestamp()+interval '5 minutes' OR kind IS NULL OR kind NOT IN ('message.received','message.sent','message.finalized')
 OR COALESCE(p_event->>'peer','') !~ '^\+[1-9][0-9]{6,14}$' OR length(COALESCE(p_event->>'text',''))>6700
 OR(p_event->>'direction') IS DISTINCT FROM(CASE WHEN kind='message.received' THEN 'inbound' ELSE 'outbound' END) THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF(p_event->>'parts' IS NOT NULL AND(COALESCE(p_event->>'parts','') !~ '^[0-9]+$' OR(p_event->>'parts')::integer NOT BETWEEN 1 AND 10))
 OR(kind<>'message.received' AND COALESCE(p_event->>'status','') NOT IN ('queued','sending','sent','expired','sending_failed','delivery_unconfirmed','delivered','delivery_failed','read'))
 OR(p_event->>'optOutAction' IS NOT NULL AND(kind<>'message.received' OR p_event->>'optOutAction' NOT IN ('START','STOP','HELP')))
 OR(p_event->'cost' IS NOT NULL AND p_event->'cost'<>'null'::jsonb AND(jsonb_typeof(p_event->'cost')<>'object' OR((p_event->'cost')-'amount'-'currency')<>'{}'::jsonb OR COALESCE(p_event->'cost'->>'amount','') !~ '^[0-9]+(\.[0-9]{1,12})?$' OR length(p_event->'cost'->>'amount')>48 OR COALESCE(p_event->'cost'->>'currency','') !~ '^[A-Z]{3}$')) THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 SELECT * INTO setting FROM public.native_sms_settings WHERE connection_id=p_connection_id FOR UPDATE;
 IF NOT FOUND OR NOT setting.enabled OR setting.phone IS DISTINCT FROM p_event->>'businessPhone' OR setting.organization_id IS DISTINCT FROM p_event->>'organizationId' OR setting.profile_id IS DISTINCT FROM(p_event->>'profileId')::uuid
 OR NOT EXISTS(SELECT 1 FROM public.channel_connections WHERE id=setting.connection_id AND workspace_id=setting.workspace_id AND channel='sms' AND status='connected')
 OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=setting.workspace_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO previous FROM public.native_sms_events e WHERE e.event_id=(p_event->>'eventId')::uuid FOR UPDATE;
 IF FOUND THEN IF previous.connection_id<>p_connection_id OR previous.payload<>p_event THEN RAISE EXCEPTION 'expansion_changed';END IF;RETURN false;END IF;
 INSERT INTO public.native_sms_events(event_id,connection_id,message_id,event_type,event_at,payload,state)
 VALUES(event_id,p_connection_id,message_id,kind,occurred,p_event,CASE WHEN kind='message.received' THEN 'pending' ELSE 'done' END);
 action=p_event->>'optOutAction';
 IF kind='message.received' AND action IN ('START','STOP') THEN
  INSERT INTO public.native_sms_consents(connection_id,peer,allowed,evidence,source,occurred_at) VALUES(p_connection_id,p_event->>'peer',action='START','Telnyx signed inbound event',action,occurred)
  ON CONFLICT(connection_id,peer) DO UPDATE SET allowed=EXCLUDED.allowed,evidence=EXCLUDED.evidence,source=EXCLUDED.source,occurred_at=EXCLUDED.occurred_at,actor_id=NULL
  WHERE public.native_sms_consents.occurred_at<EXCLUDED.occurred_at OR(public.native_sms_consents.occurred_at=EXCLUDED.occurred_at AND EXCLUDED.allowed=false);
 END IF;
 IF kind<>'message.received' THEN PERFORM public.apply_native_sms_receipts(p_connection_id,message_id);END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.claim_native_sms_events(p_nonce uuid,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_nonce IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 -- Reviewed attempts have never authorized a provider POST. Dispatching
 -- attempts have, and therefore expire to uncertain, never to canceled.
 UPDATE public.native_sms_attempts SET state='canceled',updated_at=clock_timestamp() WHERE state='reviewed' AND created_at<clock_timestamp()-interval '3 minutes';
 UPDATE public.native_sms_attempts SET state='uncertain',updated_at=clock_timestamp() WHERE state='dispatching' AND claimed_at<clock_timestamp()-interval '2 minutes';
 UPDATE public.native_sms_events SET state='failed',lease_until=NULL,finished_at=clock_timestamp() WHERE state='processing' AND lease_until<clock_timestamp() AND attempts>=5;
 WITH selected AS(SELECT e.event_id FROM public.native_sms_events e JOIN public.native_sms_settings s ON s.connection_id=e.connection_id AND s.enabled
 JOIN public.channel_connections c ON c.id=s.connection_id AND c.workspace_id=s.workspace_id AND c.channel='sms' AND c.status='connected'
 JOIN public.workspaces w ON w.id=s.workspace_id AND w.deleted_at IS NULL
 WHERE e.event_type='message.received' AND e.attempts<5 AND(e.state='pending' OR(e.state='processing' AND e.lease_until<clock_timestamp())) ORDER BY e.created_at FOR UPDATE OF e SKIP LOCKED LIMIT p_limit),
 claimed AS(UPDATE public.native_sms_events e SET state='processing',nonce=p_nonce,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 FROM selected s WHERE s.event_id=e.event_id RETURNING e.event_id,e.connection_id,e.payload)
 SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO result FROM claimed;
 RETURN result;
END $$;
CREATE FUNCTION public.finish_native_sms_event(p_event_id uuid,p_nonce uuid,p_success boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_success IS NULL THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 UPDATE public.native_sms_events SET state=CASE WHEN p_success THEN 'done' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,finished_at=CASE WHEN p_success OR attempts>=5 THEN clock_timestamp() ELSE NULL END,lease_until=NULL
 WHERE event_id=p_event_id AND nonce=p_nonce AND state='processing';RETURN FOUND;
END $$;
CREATE FUNCTION public.native_sms_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_regclass('public.native_sms_settings') IS NOT NULL AND to_regclass('public.native_sms_attempts') IS NOT NULL AND to_regclass('public.native_sms_events') IS NOT NULL
 AND to_regprocedure('public.claim_native_sms_send(uuid,uuid)') IS NOT NULL
 AND NOT has_table_privilege('anon','public.native_sms_settings','SELECT') AND NOT has_table_privilege('authenticated','public.native_sms_settings','SELECT')
 AND NOT has_function_privilege('anon','public.claim_native_sms_send(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.claim_native_sms_send(uuid,uuid)','EXECUTE');
$$;
DO $$DECLARE fn regprocedure;BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('native_expansion_actor','native_sms_settings_read','set_native_sms_settings','native_sms_private_connection','native_sms_consent','native_sms_peer_policy','native_sms_receipt','review_native_sms_send','claim_native_sms_send','finish_native_sms_send','apply_native_sms_receipts','native_sms_inbox_message','enqueue_native_sms_event','claim_native_sms_events','finish_native_sms_event','retry_native_sms_inbox','purge_native_sms_control','native_sms_ready') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END $$;

-- Signed visitors request changes. Only the existing human approval engine executes them.
CREATE TABLE public.webchat_order_address_requests (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES public.channel_connections(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
 source_message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 80),
 address jsonb NOT NULL CHECK(jsonb_typeof(address)='object'),
 message_text text NOT NULL CHECK(length(message_text) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 submitted_at timestamptz,
 superseded_at timestamptz
);
CREATE INDEX webchat_order_address_requests_order ON public.webchat_order_address_requests(workspace_id,order_id,created_at DESC);
CREATE TABLE public.webchat_order_address_links (
 operation_id uuid PRIMARY KEY REFERENCES public.inbox_order_actions(id) ON DELETE CASCADE,
 request_id uuid NOT NULL REFERENCES public.webchat_order_address_requests(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.webchat_order_address_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webchat_order_address_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webchat_order_address_requests,public.webchat_order_address_links FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.webchat_address_visitor_contact(p_workspace_id uuid,p_connection_id uuid,p_visitor_id text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN count(*)=1 THEN min(c.id::text)::uuid ELSE NULL END FROM public.contacts c JOIN public.channel_connections cc ON cc.workspace_id=c.workspace_id
 JOIN public.workspaces w ON w.id=c.workspace_id AND w.deleted_at IS NULL
 WHERE c.workspace_id=p_workspace_id AND c.channel='webchat' AND c.external_id=p_visitor_id
 AND cc.id=p_connection_id AND cc.channel='webchat';
$$;
CREATE FUNCTION public.webchat_address_actor_access(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspaces w JOIN public.conversations c ON c.workspace_id=w.id
 JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=w.id AND ct.channel='webchat'
 JOIN public.channel_connections cc ON cc.id=c.connection_id AND cc.workspace_id=w.id AND cc.channel='webchat'
 WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND c.id=p_conversation_id AND c.deleted_at IS NULL AND c.channel='webchat'
 AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id
 AND m.role IN ('admin','agent','owner') AND (m.allowed_sections IS NULL OR (jsonb_typeof(to_jsonb(m.allowed_sections))='array'
 AND to_jsonb(m.allowed_sections) ? '/bandeja' AND to_jsonb(m.allowed_sections) ? '/pedidos')))));
$$;
CREATE FUNCTION public.read_webchat_address_receipt(p_workspace_id uuid,p_connection_id uuid,p_visitor_id text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.webchat_order_address_requests;op public.inbox_order_actions;state text;confirmed timestamptz;
BEGIN
 IF p_workspace_id IS NULL OR p_connection_id IS NULL OR p_visitor_id IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'invalid_address_request';END IF;
 SELECT * INTO r FROM public.webchat_order_address_requests WHERE id=p_id AND workspace_id=p_workspace_id AND connection_id=p_connection_id
 AND contact_id=public.webchat_address_visitor_contact(p_workspace_id,p_connection_id,p_visitor_id)
 AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id=webchat_order_address_requests.order_id AND o.workspace_id=p_workspace_id AND o.contact_id=webchat_order_address_requests.contact_id)
 AND (submitted_at IS NULL OR EXISTS(SELECT 1 FROM public.conversations cv WHERE cv.id=webchat_order_address_requests.conversation_id
 AND cv.workspace_id=p_workspace_id AND cv.contact_id=webchat_order_address_requests.contact_id AND cv.connection_id=p_connection_id AND cv.deleted_at IS NULL AND cv.channel='webchat'));
 IF NOT FOUND THEN RAISE EXCEPTION 'address_request_not_found';END IF;
 SELECT a.* INTO op FROM public.webchat_order_address_links l JOIN public.inbox_order_actions a ON a.id=l.operation_id AND a.workspace_id=l.workspace_id
 WHERE l.request_id=r.id AND l.workspace_id=r.workspace_id ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
 state=CASE WHEN r.submitted_at IS NULL THEN 'not_submitted' WHEN r.superseded_at IS NOT NULL THEN 'superseded'
 WHEN op.status='running' THEN 'processing' WHEN op.status IN ('uncertain','reviewed','completed') THEN 'needs_review'
 WHEN op.status='preview' AND op.expires_at>statement_timestamp() THEN 'prepared' WHEN op.status='failed' THEN 'not_completed' ELSE 'waiting_review' END;
 -- A provider response or message ACK alone cannot produce this status.
 IF op.status='completed' AND op.action->>'type'='address' AND op.finished_at IS NOT NULL AND
 (SELECT bool_and(jsonb_typeof(op.result->'shipping_after'->field) IS NOT DISTINCT FROM 'string'
 AND jsonb_typeof(op.preview->'shipping_change'->'after'->field) IS NOT DISTINCT FROM 'string'
 AND lower(regexp_replace(btrim(op.result->'shipping_after'->>field),'\s+',' ','g'))=
 lower(regexp_replace(btrim(op.preview->'shipping_change'->'after'->>field),'\s+',' ','g')))
 FROM unnest(ARRAY['address1','address2','city','province','zip','countryCode']) field) IS TRUE THEN state='confirmed';confirmed=op.finished_at;END IF;
 RETURN jsonb_build_object('id',r.id,'reference',r.reference,'created_at',r.created_at,'status',state,'confirmed_at',confirmed,'superseded',r.superseded_at IS NOT NULL);
END $$;
CREATE FUNCTION public.reserve_webchat_address_request(p_workspace_id uuid,p_connection_id uuid,p_visitor_id text,p_id uuid,p_order_id uuid,p_address jsonb,p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ct uuid;r public.webchat_order_address_requests;o public.orders;k text;
BEGIN
 IF p_workspace_id IS NULL OR p_connection_id IS NULL OR p_visitor_id IS NULL OR p_id IS NULL OR p_order_id IS NULL OR p_address IS NULL
 OR jsonb_typeof(p_address)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_address) key) IS DISTINCT FROM ARRAY['address1','address2','city','countryCode','province','zip']::text[]
 OR p_message IS NULL OR length(p_message) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid_address_request';END IF;
 FOREACH k IN ARRAY ARRAY['address1','address2','city','province','zip','countryCode'] LOOP
  IF jsonb_typeof(p_address->k) IS DISTINCT FROM 'string' OR length(p_address->>k)>(CASE WHEN k='zip' THEN 32 WHEN k='countryCode' THEN 2 ELSE 255 END)
  OR (p_address->>k) ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_address_request';END IF;
 END LOOP;
 IF length(btrim(p_address->>'address1'))=0 OR length(btrim(p_address->>'city'))=0 OR (p_address->>'countryCode') !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'invalid_address_request';END IF;
 ct=public.webchat_address_visitor_contact(p_workspace_id,p_connection_id,p_visitor_id);
 SELECT * INTO o FROM public.orders WHERE id=p_order_id AND workspace_id=p_workspace_id AND contact_id=ct AND platform='shopify' FOR UPDATE;
 IF NOT FOUND OR o.order_number IS NULL OR length(o.order_number) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'address_request_not_found';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 SELECT * INTO r FROM public.webchat_order_address_requests WHERE id=p_id;
 IF FOUND THEN
  IF r.workspace_id IS DISTINCT FROM p_workspace_id OR r.connection_id IS DISTINCT FROM p_connection_id OR r.contact_id IS DISTINCT FROM ct
  OR r.order_id IS DISTINCT FROM p_order_id OR r.address IS DISTINCT FROM p_address OR r.message_text IS DISTINCT FROM p_message THEN RAISE EXCEPTION 'address_request_changed';END IF;
  RETURN public.read_webchat_address_receipt(p_workspace_id,p_connection_id,p_visitor_id,p_id);
 END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF EXISTS(SELECT 1 FROM public.order_execution_locks WHERE workspace_id=p_workspace_id AND order_id=p_order_id) THEN RAISE EXCEPTION 'address_request_pending';END IF;
 IF (SELECT count(*) FROM public.webchat_order_address_requests WHERE workspace_id=p_workspace_id AND order_id=p_order_id)>=50 THEN RAISE EXCEPTION 'address_request_limit';END IF;
 INSERT INTO public.webchat_order_address_requests(id,workspace_id,connection_id,contact_id,order_id,reference,address,message_text)
 VALUES(p_id,p_workspace_id,p_connection_id,ct,p_order_id,o.order_number,p_address,p_message);
 RETURN public.read_webchat_address_receipt(p_workspace_id,p_connection_id,p_visitor_id,p_id);
END $$;
CREATE FUNCTION public.submit_webchat_address_request(p_workspace_id uuid,p_connection_id uuid,p_visitor_id text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.webchat_order_address_requests;m public.messages;c public.conversations;
BEGIN
 PERFORM public.read_webchat_address_receipt(p_workspace_id,p_connection_id,p_visitor_id,p_id);
 SELECT * INTO r FROM public.webchat_order_address_requests WHERE id=p_id;
 PERFORM 1 FROM public.orders WHERE id=r.order_id AND workspace_id=r.workspace_id FOR UPDATE;
 PERFORM public.read_webchat_address_receipt(p_workspace_id,p_connection_id,p_visitor_id,p_id);
 SELECT * INTO r FROM public.webchat_order_address_requests WHERE id=p_id FOR UPDATE;
 IF r.submitted_at IS NOT NULL THEN RETURN public.read_webchat_address_receipt(p_workspace_id,p_connection_id,p_visitor_id,p_id);END IF;
 IF r.expires_at<=clock_timestamp() OR public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'address_request_changed';END IF;
 IF EXISTS(SELECT 1 FROM public.webchat_order_address_requests newer WHERE newer.workspace_id=r.workspace_id AND newer.order_id=r.order_id
 AND newer.submitted_at IS NOT NULL AND (newer.created_at,newer.id)>(r.created_at,r.id)) THEN RAISE EXCEPTION 'address_request_changed';END IF;
 IF EXISTS(SELECT 1 FROM public.order_execution_locks WHERE workspace_id=r.workspace_id AND order_id=r.order_id) THEN RAISE EXCEPTION 'address_request_pending';END IF;
 SELECT msg.* INTO m FROM public.messages msg JOIN public.conversations cv ON cv.id=msg.conversation_id
 WHERE msg.message_id='wc_'||p_id::text AND msg.channel='webchat' AND msg.sender_type='customer' AND msg.deleted_at IS NULL
 AND cv.workspace_id=r.workspace_id AND cv.contact_id=r.contact_id AND cv.connection_id=r.connection_id AND cv.channel='webchat' AND cv.deleted_at IS NULL;
 IF NOT FOUND OR m.content_text IS DISTINCT FROM r.message_text THEN RAISE EXCEPTION 'address_request_source_missing';END IF;
 SELECT * INTO c FROM public.conversations WHERE id=m.conversation_id FOR SHARE;
 UPDATE public.webchat_order_address_requests SET superseded_at=clock_timestamp() WHERE workspace_id=r.workspace_id AND order_id=r.order_id AND id<>r.id AND submitted_at IS NOT NULL AND superseded_at IS NULL;
 UPDATE public.webchat_order_address_requests SET source_message_id=m.id,conversation_id=c.id,submitted_at=clock_timestamp() WHERE id=r.id;
 RETURN public.read_webchat_address_receipt(p_workspace_id,p_connection_id,p_visitor_id,p_id);
END $$;
CREATE FUNCTION public.read_case_address_requests(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_conversation_id IS NULL OR p_order_id IS NULL THEN RAISE EXCEPTION 'invalid_address_request';END IF;
 IF NOT public.webchat_address_actor_access(p_workspace_id,p_actor_id,p_conversation_id) THEN RAISE EXCEPTION 'address_request_not_found';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(visible)),'[]'::jsonb) INTO rows FROM (SELECT r.id,r.order_id,r.contact_id,r.conversation_id,r.reference,r.address,r.created_at
 FROM public.webchat_order_address_requests r JOIN public.orders o ON o.id=r.order_id AND o.workspace_id=r.workspace_id AND o.contact_id=r.contact_id
 JOIN public.conversations cv ON cv.id=r.conversation_id AND cv.workspace_id=r.workspace_id AND cv.contact_id=r.contact_id AND cv.connection_id=r.connection_id AND cv.deleted_at IS NULL AND cv.channel='webchat'
 JOIN public.messages m ON m.id=r.source_message_id AND m.conversation_id=r.conversation_id AND m.content_text=r.message_text AND m.deleted_at IS NULL AND m.sender_type='customer' AND m.channel='webchat'
 WHERE r.workspace_id=p_workspace_id AND r.conversation_id=p_conversation_id AND r.order_id=p_order_id AND r.submitted_at IS NOT NULL
 AND r.superseded_at IS NULL AND r.expires_at>statement_timestamp() ORDER BY r.created_at DESC,r.id DESC LIMIT 20) visible;
 RETURN jsonb_build_object('requests',rows);
END $$;
CREATE FUNCTION public.prepare_webchat_address_preview(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_request_id uuid,p_id uuid,p_preview jsonb,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.webchat_order_address_requests;op public.inbox_order_actions;marker jsonb;action jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_conversation_id IS NULL OR p_request_id IS NULL OR p_id IS NULL
 THEN RAISE EXCEPTION 'invalid_address_request';END IF;
 SELECT * INTO r FROM public.webchat_order_address_requests WHERE id=p_request_id AND workspace_id=p_workspace_id AND conversation_id=p_conversation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'address_request_not_found';END IF;
 PERFORM 1 FROM public.orders WHERE id=r.order_id AND workspace_id=r.workspace_id FOR UPDATE;
 SELECT * INTO r FROM public.webchat_order_address_requests WHERE id=p_request_id FOR SHARE;
 IF NOT public.webchat_address_actor_access(p_workspace_id,p_actor_id,p_conversation_id) THEN RAISE EXCEPTION 'address_request_not_found';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 SELECT a.* INTO op FROM public.inbox_order_actions a WHERE a.id=p_id;
 IF FOUND THEN
  IF op.workspace_id IS DISTINCT FROM p_workspace_id OR op.conversation_id IS DISTINCT FROM p_conversation_id OR op.order_id IS DISTINCT FROM r.order_id
  OR op.requested_by IS DISTINCT FROM p_actor_id OR op.action IS DISTINCT FROM jsonb_build_object('type','address','address',r.address,'reason','webchat_address_request')
  OR NOT EXISTS(SELECT 1 FROM public.webchat_order_address_links l WHERE l.operation_id=p_id AND l.request_id=r.id AND l.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'address_request_changed';END IF;
  RETURN jsonb_build_object('operation_id',op.id,'order_id',op.order_id,'request_id',r.id);
 END IF;
 IF p_preview IS NULL AND p_fingerprint IS NULL THEN RETURN NULL;END IF;
 IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR p_preview IS NULL OR jsonb_typeof(p_preview)<>'object'
 OR jsonb_typeof(p_preview->'shipping_change'->'after') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_address_request';END IF;
 IF r.submitted_at IS NULL OR r.superseded_at IS NOT NULL OR r.expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations cv ON cv.id=m.conversation_id AND cv.workspace_id=r.workspace_id AND cv.contact_id=r.contact_id AND cv.connection_id=r.connection_id AND cv.deleted_at IS NULL AND cv.channel='webchat'
 WHERE m.id=r.source_message_id AND m.conversation_id=r.conversation_id AND m.content_text=r.message_text AND m.deleted_at IS NULL AND m.sender_type='customer' AND m.channel='webchat')
 THEN RAISE EXCEPTION 'address_request_changed';END IF;
 IF EXISTS(SELECT 1 FROM public.webchat_order_address_links l JOIN public.inbox_order_actions a ON a.id=l.operation_id
 WHERE l.request_id=r.id AND a.id<>p_id AND (a.status IN ('running','uncertain','completed') OR (a.status='preview' AND a.expires_at>clock_timestamp()))) THEN RAISE EXCEPTION 'address_request_pending';END IF;
 marker=jsonb_build_object('version',1,'request_id',r.id,'source_message_id',r.source_message_id);
 action=jsonb_build_object('type','address','address',r.address,'reason','webchat_address_request');
 op=public.save_inbox_order_preview(p_id,p_workspace_id,p_conversation_id,r.order_id,p_actor_id,action,p_preview||jsonb_build_object('customer_request',marker),p_fingerprint);
 IF op.preview->'customer_request' IS DISTINCT FROM marker THEN RAISE EXCEPTION 'address_request_changed';END IF;
 INSERT INTO public.webchat_order_address_links VALUES(p_id,r.id,r.workspace_id) ON CONFLICT(operation_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.webchat_order_address_links WHERE operation_id=p_id AND request_id=r.id AND workspace_id=r.workspace_id) THEN RAISE EXCEPTION 'address_request_changed';END IF;
 RETURN jsonb_build_object('operation_id',op.id,'order_id',op.order_id,'request_id',r.id);
END $$;
CREATE FUNCTION public.guard_webchat_address_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.webchat_order_address_requests;link public.webchat_order_address_links;
BEGIN
 SELECT * INTO link FROM public.webchat_order_address_links WHERE operation_id=OLD.id;
 IF NOT FOUND THEN
  IF OLD.status<>'running' AND NEW.status='running' AND OLD.preview ? 'customer_request' THEN RAISE EXCEPTION 'address_request_changed';END IF;
  RETURN NEW;
 END IF;
 IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id OR OLD.order_id IS DISTINCT FROM NEW.order_id
 OR OLD.action IS DISTINCT FROM NEW.action OR OLD.preview IS DISTINCT FROM NEW.preview OR OLD.fingerprint IS DISTINCT FROM NEW.fingerprint THEN RAISE EXCEPTION 'address_request_changed';END IF;
 IF OLD.status<>'running' AND NEW.status='running' THEN
  -- Same order-first lock order as customer submission prevents a stale request claim.
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  SELECT * INTO r FROM public.webchat_order_address_requests WHERE id=link.request_id AND workspace_id=link.workspace_id FOR SHARE;
  IF NOT FOUND OR r.superseded_at IS NOT NULL OR r.expires_at<=clock_timestamp() OR r.submitted_at IS NULL OR r.order_id IS DISTINCT FROM NEW.order_id
  OR r.conversation_id IS DISTINCT FROM NEW.conversation_id OR NEW.action->'address' IS DISTINCT FROM r.address
  OR NOT public.webchat_address_actor_access(r.workspace_id,NEW.approved_by,r.conversation_id)
  OR NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations cv ON cv.id=m.conversation_id AND cv.workspace_id=r.workspace_id AND cv.contact_id=r.contact_id AND cv.connection_id=r.connection_id AND cv.deleted_at IS NULL AND cv.channel='webchat'
  WHERE m.id=r.source_message_id AND m.conversation_id=r.conversation_id AND m.content_text=r.message_text AND m.deleted_at IS NULL AND m.sender_type='customer' AND m.channel='webchat')
  THEN RAISE EXCEPTION 'address_request_changed';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_webchat_address_operation BEFORE UPDATE ON public.inbox_order_actions FOR EACH ROW EXECUTE FUNCTION public.guard_webchat_address_operation();
REVOKE ALL ON FUNCTION public.webchat_address_visitor_contact(uuid,uuid,text),public.webchat_address_actor_access(uuid,uuid,uuid),
 public.read_webchat_address_receipt(uuid,uuid,text,uuid),public.reserve_webchat_address_request(uuid,uuid,text,uuid,uuid,jsonb,text),
 public.submit_webchat_address_request(uuid,uuid,text,uuid),public.read_case_address_requests(uuid,uuid,uuid,uuid),public.prepare_webchat_address_preview(uuid,uuid,uuid,uuid,uuid,jsonb,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.webchat_address_visitor_contact(uuid,uuid,text),public.webchat_address_actor_access(uuid,uuid,uuid),
 public.read_webchat_address_receipt(uuid,uuid,text,uuid),public.reserve_webchat_address_request(uuid,uuid,text,uuid,uuid,jsonb,text),
 public.submit_webchat_address_request(uuid,uuid,text,uuid),public.read_case_address_requests(uuid,uuid,uuid,uuid),public.prepare_webchat_address_preview(uuid,uuid,uuid,uuid,uuid,jsonb,text)
 TO service_role;
REVOKE ALL ON FUNCTION public.guard_webchat_address_operation() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.webchat_address_request_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT count(*)=2 AND bool_and(relrowsecurity AND NOT has_table_privilege('anon',oid,'select,insert,update,delete')
 AND NOT has_table_privilege('authenticated',oid,'select,insert,update,delete') AND NOT has_table_privilege('service_role',oid,'select,insert,update,delete'))
 FROM pg_catalog.pg_class WHERE oid IN ('public.webchat_order_address_requests'::regclass,'public.webchat_order_address_links'::regclass))
 AND (SELECT count(*)=7 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute')
 AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute')) FROM pg_catalog.pg_proc
 WHERE pronamespace='public'::regnamespace AND proname IN ('webchat_address_visitor_contact','webchat_address_actor_access','read_webchat_address_receipt',
 'reserve_webchat_address_request','submit_webchat_address_request','read_case_address_requests','prepare_webchat_address_preview'))
 AND (SELECT prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute')
 AND NOT has_function_privilege('authenticated',oid,'execute') AND NOT has_function_privilege('service_role',oid,'execute')
 FROM pg_catalog.pg_proc WHERE oid='public.guard_webchat_address_operation()'::regprocedure)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='guard_webchat_address_operation' AND tgenabled='O' AND NOT tgisinternal);
$$;
REVOKE ALL ON FUNCTION public.webchat_address_request_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.webchat_address_request_ready() TO service_role;

-- Opt-in neutral team notices. No customer text, payment execution or provider calls in SQL.
CREATE TABLE public.browser_push_subscriptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,endpoint_hash text NOT NULL UNIQUE CHECK(endpoint_hash ~ '^[0-9a-f]{64}$'),
 ciphertext text,locale text NOT NULL CHECK(locale IN ('es','en')),enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 CHECK((enabled AND ciphertext IS NOT NULL AND length(ciphertext) BETWEEN 100 AND 12000) OR (NOT enabled AND ciphertext IS NULL))
);
CREATE TABLE public.browser_push_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subscription_id uuid NOT NULL REFERENCES public.browser_push_subscriptions(id) ON DELETE CASCADE,
 notification_id uuid NOT NULL REFERENCES public.workspace_notifications(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','acknowledged','uncertain','dropped')),
 lease_id uuid,claimed_at timestamptz,finished_at timestamptz,status_code integer CHECK(status_code BETWEEN 100 AND 599),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(subscription_id,notification_id)
);
CREATE INDEX browser_push_pending_idx ON public.browser_push_receipts(created_at,id) WHERE state='pending';
ALTER TABLE public.browser_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_push_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.browser_push_subscriptions,public.browser_push_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.browser_push_subscriptions,public.browser_push_receipts TO service_role;

CREATE FUNCTION public.browser_push_user_access(p_workspace_id uuid,p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL
  AND (w.owner_id=p_user_id OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_user_id
   AND m.role IN ('admin','agent') AND (m.allowed_sections IS NULL OR (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/bandeja')))));
$$;
REVOKE ALL ON FUNCTION public.browser_push_user_access(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.browser_push_user_access(uuid,uuid) TO service_role;

CREATE FUNCTION public.manage_browser_push(p_workspace_id uuid,p_user_id uuid,p_endpoint_hash text,p_operation text,p_ciphertext text DEFAULT NULL,p_locale text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.browser_push_subscriptions;
BEGIN
 IF p_workspace_id IS NULL OR p_user_id IS NULL OR p_endpoint_hash IS NULL OR p_endpoint_hash !~ '^[0-9a-f]{64}$' OR p_operation NOT IN ('save','remove') OR p_operation IS NULL
 THEN RAISE EXCEPTION 'invalid_browser_push_context';END IF;
 -- Removing this actor's own browser remains possible after an Inbox permission is revoked.
 IF p_operation='save' AND NOT public.browser_push_user_access(p_workspace_id,p_user_id) THEN RAISE EXCEPTION 'browser_push_forbidden';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('browser-push-user:'||p_user_id::text,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('browser-push:'||p_endpoint_hash,0));
 SELECT * INTO s FROM public.browser_push_subscriptions WHERE endpoint_hash=p_endpoint_hash FOR UPDATE;
 IF FOUND AND s.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'browser_push_forbidden';END IF;
 IF p_operation='remove' THEN
  UPDATE public.browser_push_subscriptions SET enabled=false,ciphertext=NULL WHERE endpoint_hash=p_endpoint_hash AND user_id=p_user_id;
  RETURN jsonb_build_object('enabled',false);
 END IF;
 IF p_ciphertext IS NULL OR length(p_ciphertext) NOT BETWEEN 100 AND 12000 OR p_locale IS NULL OR p_locale NOT IN ('es','en') THEN RAISE EXCEPTION 'invalid_browser_push_context';END IF;
 IF NOT FOUND AND (SELECT count(*) FROM public.browser_push_subscriptions WHERE user_id=p_user_id AND enabled AND expires_at>now())>=5 THEN RAISE EXCEPTION 'browser_push_limit';END IF;
 -- One physical subscription receives notices for one selected business. Move only for the same authenticated actor.
 INSERT INTO public.browser_push_subscriptions(workspace_id,user_id,endpoint_hash,ciphertext,locale) VALUES(p_workspace_id,p_user_id,p_endpoint_hash,p_ciphertext,p_locale)
 ON CONFLICT(endpoint_hash) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,ciphertext=EXCLUDED.ciphertext,locale=EXCLUDED.locale,enabled=true,created_at=now(),expires_at=now()+interval '30 days';
 RETURN jsonb_build_object('enabled',true,'expires_at',now()+interval '30 days');
END $$;
REVOKE ALL ON FUNCTION public.manage_browser_push(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_browser_push(uuid,uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.queue_browser_push_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.browser_push_receipts(subscription_id,notification_id)
 SELECT s.id,NEW.id FROM public.browser_push_subscriptions s WHERE s.workspace_id=NEW.workspace_id AND s.user_id=NEW.user_id
  AND s.enabled AND s.expires_at>now() AND NEW.read_at IS NULL AND NEW.kind IN ('mention','reminder','snooze')
 ON CONFLICT(subscription_id,notification_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_browser_push_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER queue_browser_push_notice AFTER INSERT ON public.workspace_notifications FOR EACH ROW EXECUTE FUNCTION public.queue_browser_push_notice();

CREATE FUNCTION public.browser_push_receipt_current(p_receipt_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.browser_push_receipts r
 JOIN public.browser_push_subscriptions s ON s.id=r.subscription_id JOIN public.workspace_notifications n ON n.id=r.notification_id
 JOIN public.conversations c ON c.id=n.conversation_id AND c.workspace_id=n.workspace_id AND c.deleted_at IS NULL
 WHERE r.id=p_receipt_id AND s.enabled AND s.expires_at>now() AND s.workspace_id=n.workspace_id AND s.user_id=n.user_id
  AND n.created_at>=s.created_at AND n.created_at>now()-interval '10 minutes' AND n.read_at IS NULL
  AND n.kind IN ('mention','reminder','snooze') AND public.browser_push_user_access(n.workspace_id,n.user_id)
  AND (c.channel::text NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc
   WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=n.user_id AND cc.channel=c.channel)));
$$;
REVOKE ALL ON FUNCTION public.browser_push_receipt_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.browser_push_receipt_current(uuid) TO service_role;

CREATE FUNCTION public.claim_browser_push_notices() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item record;rows jsonb='[]'::jsonb;lease uuid;
BEGIN
 -- A lost HTTP acknowledgment stays uncertain and is never replayed automatically.
 UPDATE public.browser_push_receipts SET state='uncertain',finished_at=now() WHERE id IN
  (SELECT id FROM public.browser_push_receipts WHERE state='claimed' AND claimed_at<now()-interval '5 minutes' ORDER BY claimed_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 UPDATE public.browser_push_subscriptions SET enabled=false,ciphertext=NULL WHERE id IN
  (SELECT id FROM public.browser_push_subscriptions WHERE enabled AND expires_at<=now() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 FOR item IN SELECT r.id FROM public.browser_push_receipts r WHERE r.state='pending' ORDER BY r.created_at,r.id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  IF NOT public.browser_push_receipt_current(item.id) THEN UPDATE public.browser_push_receipts SET state='dropped',finished_at=now() WHERE id=item.id;CONTINUE;END IF;
  lease=gen_random_uuid();UPDATE public.browser_push_receipts SET state='claimed',lease_id=lease,claimed_at=now() WHERE id=item.id;
  SELECT rows||jsonb_build_array(jsonb_build_object('id',r.id,'lease_id',lease,'subscription_id',s.id,'workspace_id',s.workspace_id,'user_id',s.user_id,'endpoint_hash',s.endpoint_hash,'ciphertext',s.ciphertext,
   'notice',jsonb_build_object('version',1,'kind',n.kind,'conversation_id',n.conversation_id,'locale',s.locale))) INTO rows
  FROM public.browser_push_receipts r JOIN public.browser_push_subscriptions s ON s.id=r.subscription_id JOIN public.workspace_notifications n ON n.id=r.notification_id WHERE r.id=item.id;
 END LOOP;
 RETURN rows;
END $$;
REVOKE ALL ON FUNCTION public.claim_browser_push_notices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_browser_push_notices() TO service_role;

CREATE FUNCTION public.finish_browser_push_notice(p_id uuid,p_lease_id uuid,p_state text,p_status_code integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 IF p_id IS NULL OR p_lease_id IS NULL OR p_state IS NULL OR p_state NOT IN ('acknowledged','uncertain','dropped')
  OR (p_status_code IS NOT NULL AND p_status_code NOT BETWEEN 100 AND 599)
  OR (p_state='acknowledged' AND (p_status_code IS NULL OR p_status_code NOT BETWEEN 200 AND 299)) THEN RAISE EXCEPTION 'invalid_browser_push_context';END IF;
 UPDATE public.browser_push_receipts SET state=p_state,status_code=p_status_code,finished_at=now() WHERE id=p_id AND lease_id=p_lease_id AND state='claimed' RETURNING subscription_id INTO sid;
 IF NOT FOUND THEN RETURN false;END IF;
 IF p_status_code IN (404,410) THEN UPDATE public.browser_push_subscriptions SET enabled=false,ciphertext=NULL WHERE id=sid;END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_browser_push_notice(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_browser_push_notice(uuid,uuid,text,integer) TO service_role;

CREATE FUNCTION public.browser_push_schema_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT bool_and(relrowsecurity) FROM pg_catalog.pg_class WHERE oid IN ('public.browser_push_subscriptions'::regclass,'public.browser_push_receipts'::regclass))
 AND NOT has_table_privilege('anon','public.browser_push_subscriptions','select') AND NOT has_table_privilege('authenticated','public.browser_push_subscriptions','select')
 AND NOT has_table_privilege('service_role','public.browser_push_subscriptions','insert,update,delete')
 AND NOT has_table_privilege('anon','public.browser_push_receipts','select') AND NOT has_table_privilege('authenticated','public.browser_push_receipts','select')
 AND NOT has_table_privilege('service_role','public.browser_push_receipts','insert,update,delete')
 AND (SELECT count(*)=5 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute'))
 FROM pg_catalog.pg_proc WHERE oid IN ('public.browser_push_user_access(uuid,uuid)'::regprocedure,'public.manage_browser_push(uuid,uuid,text,text,text,text)'::regprocedure,
 'public.browser_push_receipt_current(uuid)'::regprocedure,'public.claim_browser_push_notices()'::regprocedure,'public.finish_browser_push_notice(uuid,uuid,text,integer)'::regprocedure))
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.workspace_notifications'::regclass AND tgname='queue_browser_push_notice' AND tgenabled='O' AND NOT tgisinternal);
$$;
REVOKE ALL ON FUNCTION public.browser_push_schema_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.browser_push_schema_ready() TO service_role;

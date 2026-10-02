-- X4 merchant-owned Judge.me reviews. Additive/private; no imports, publication,
-- provider calls, customers, emails, AI usage or wallet changes on installation.
CREATE TABLE public.native_review_settings(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
 shopify_connection_id uuid NOT NULL UNIQUE REFERENCES public.shopify_connections(id) ON DELETE CASCADE,
 shop_domain text NOT NULL CHECK(shop_domain ~ '^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$'),
 encrypted_key text NOT NULL CHECK(length(encrypted_key) BETWEEN 60 AND 9000),revision uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT false,daily_replies integer NOT NULL DEFAULT 50 CHECK(daily_replies BETWEEN 1 AND 1000),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.native_store_reviews(
 connection_id uuid NOT NULL REFERENCES public.native_review_settings(id) ON DELETE CASCADE,
 review_id bigint NOT NULL CHECK(review_id BETWEEN 1 AND 9007199254740991),snapshot text NOT NULL CHECK(snapshot ~ '^[a-f0-9]{64}$'),
 projection jsonb NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(connection_id,review_id)
);
CREATE TABLE public.native_review_replies(
 id uuid PRIMARY KEY,connection_id uuid NOT NULL,review_id bigint NOT NULL,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 installation_revision uuid NOT NULL,snapshot text NOT NULL CHECK(snapshot ~ '^[a-f0-9]{64}$'),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),nonce uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('reviewed','dispatching','accepted','uncertain','canceled')),
 confirmed_current_store_view boolean NOT NULL CHECK(confirmed_current_store_view),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),claimed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(connection_id,review_id) REFERENCES public.native_store_reviews(connection_id,review_id) ON DELETE CASCADE
);
CREATE INDEX native_review_reply_lookup ON public.native_review_replies(connection_id,review_id,created_at DESC);
ALTER TABLE public.native_review_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_store_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_review_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.native_review_settings,public.native_store_reviews,public.native_review_replies FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.native_review_actor(p_workspace_id uuid,p_actor_id uuid,p_section text,p_admin boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(p_workspace_id IS NOT NULL AND p_actor_id IS NOT NULL AND p_section IN ('/productos','/ajustes') AND p_admin IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND(w.owner_id=p_actor_id OR EXISTS(
 SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent') AND(NOT p_admin OR m.role='admin')
 AND(m.allowed_sections IS NULL OR(jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? p_section))))),false);
$$;
CREATE FUNCTION public.native_reviews_settings_read(p_workspace_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_review_settings;stores jsonb;
BEGIN
 IF NOT public.native_review_actor(p_workspace_id,p_actor_id,'/ajustes',true) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'shopDomain',shop_domain) ORDER BY shop_domain,id),'[]'::jsonb) INTO stores FROM public.shopify_connections WHERE workspace_id=p_workspace_id AND status='active' AND platform='shopify';
 SELECT * INTO setting FROM public.native_review_settings WHERE workspace_id=p_workspace_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('configured',false,'enabled',false,'stores',stores);END IF;
 RETURN jsonb_build_object('configured',true,'connectionId',setting.id,'shopifyConnectionId',setting.shopify_connection_id,'shopDomain',setting.shop_domain,'revision',setting.revision,
 'enabled',setting.enabled AND EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify'),
 'dailyReplies',setting.daily_replies,'stores',stores);
END $$;
CREATE FUNCTION public.set_native_reviews_settings(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_shopify_connection_id uuid,p_shop_domain text,p_revision uuid,p_encrypted_key text,p_enabled boolean,p_daily_replies integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_review_settings;
BEGIN
 IF p_connection_id IS NULL OR p_shopify_connection_id IS NULL OR p_revision IS NULL OR p_shop_domain IS NULL OR p_shop_domain !~ '^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$' OR p_encrypted_key IS NULL OR length(p_encrypted_key) NOT BETWEEN 60 AND 9000 OR p_enabled IS NULL OR p_daily_replies IS NULL OR p_daily_replies NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_review_actor(p_workspace_id,p_actor_id,'/ajustes',true) OR(p_enabled AND public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-reviews-workspace:'||p_workspace_id::text,0));
 SELECT * INTO setting FROM public.native_review_settings WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF FOUND AND(setting.id<>p_connection_id OR setting.shopify_connection_id<>p_shopify_connection_id OR setting.shop_domain<>p_shop_domain) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 -- Disabled existing installations can still be stopped after Shopify uninstall.
 IF(p_enabled OR setting.id IS NULL) AND NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=p_shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=p_shop_domain AND status='active' AND platform='shopify') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 INSERT INTO public.native_review_settings(id,workspace_id,shopify_connection_id,shop_domain,encrypted_key,revision,enabled,daily_replies,updated_by)
 VALUES(p_connection_id,p_workspace_id,p_shopify_connection_id,p_shop_domain,p_encrypted_key,p_revision,p_enabled,p_daily_replies,p_actor_id)
 ON CONFLICT(workspace_id) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,revision=EXCLUDED.revision,enabled=EXCLUDED.enabled,daily_replies=EXCLUDED.daily_replies,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 RETURN public.native_reviews_settings_read(p_workspace_id,p_actor_id);
END $$;
CREATE FUNCTION public.native_reviews_private_connection(p_workspace_id uuid,p_actor_id uuid,p_section text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_review_settings;
BEGIN
 IF NOT public.native_review_actor(p_workspace_id,p_actor_id,p_section,p_section='/ajustes') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO setting FROM public.native_review_settings WHERE workspace_id=p_workspace_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF p_section='/productos' AND(NOT setting.enabled OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify')) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 RETURN to_jsonb(setting);
END $$;
CREATE FUNCTION public.cache_native_store_reviews(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_revision uuid,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_review_settings;item jsonb;review_number bigint;last_reply public.native_review_replies;result jsonb='[]'::jsonb;
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>100 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_review_actor(p_workspace_id,p_actor_id,'/productos') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO setting FROM public.native_review_settings WHERE id=p_connection_id AND workspace_id=p_workspace_id AND revision=p_revision AND enabled FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 UPDATE public.native_review_replies SET state=CASE WHEN state='reviewed' THEN 'canceled' ELSE 'uncertain' END,updated_at=clock_timestamp()
 WHERE connection_id=p_connection_id AND((state='reviewed' AND created_at<clock_timestamp()-interval '3 minutes') OR(state='dispatching' AND claimed_at<clock_timestamp()-interval '2 minutes'));
 IF(SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_rows)) THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['id','snapshot','title','body','rating','hidden','createdAt','updatedAt','productExternalId','productTitle']<>'{}'::jsonb
  OR NOT(item ?& ARRAY['id','snapshot','title','body','rating','hidden','createdAt','updatedAt','productExternalId','productTitle'])
  OR jsonb_typeof(item->'id')<>'number' OR item->>'id' !~ '^[1-9][0-9]*$' OR(item->>'id')::numeric>9007199254740991
  OR jsonb_typeof(item->'snapshot')<>'string' OR item->>'snapshot' !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(item->'body')<>'string' OR length(item->>'body')>20000
  OR jsonb_typeof(item->'title') NOT IN ('string','null') OR length(item->>'title')>4000
  OR jsonb_typeof(item->'productTitle') NOT IN ('string','null') OR length(item->>'productTitle')>4000
  OR jsonb_typeof(item->'rating')<>'number' OR item->>'rating' !~ '^[1-5]$' OR jsonb_typeof(item->'hidden')<>'boolean'
  OR jsonb_typeof(item->'createdAt')<>'string' OR jsonb_typeof(item->'updatedAt')<>'string'
  OR(jsonb_typeof(item->'productExternalId')<>'null' AND(jsonb_typeof(item->'productExternalId')<>'number' OR item->>'productExternalId' !~ '^[1-9][0-9]*$' OR(item->>'productExternalId')::numeric>9007199254740991)) THEN RAISE EXCEPTION 'invalid_expansion';END IF;
  PERFORM(item->>'createdAt')::timestamptz;PERFORM(item->>'updatedAt')::timestamptz;
  review_number=(item->>'id')::bigint;
  INSERT INTO public.native_store_reviews(connection_id,review_id,snapshot,projection) VALUES(p_connection_id,review_number,item->>'snapshot',item-'snapshot')
  ON CONFLICT(connection_id,review_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,projection=EXCLUDED.projection,observed_at=clock_timestamp();
  SELECT * INTO last_reply FROM public.native_review_replies WHERE connection_id=p_connection_id AND review_id=review_number AND state IN ('reviewed','dispatching','accepted','uncertain') ORDER BY created_at DESC,id DESC LIMIT 1;
  result=result||jsonb_build_array(item||jsonb_build_object('reply',jsonb_build_object('blocked',FOUND,'state',last_reply.state,'ownAttemptId',CASE WHEN last_reply.actor_id=p_actor_id THEN last_reply.id ELSE NULL END)));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.native_review_reply_receipt(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_review_replies;
BEGIN
 IF NOT public.native_review_actor(p_workspace_id,p_actor_id,'/productos') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 UPDATE public.native_review_replies SET state=CASE WHEN state='reviewed' THEN 'canceled' ELSE 'uncertain' END,updated_at=clock_timestamp()
 WHERE id=p_attempt_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id AND((state='reviewed' AND created_at<clock_timestamp()-interval '3 minutes') OR(state='dispatching' AND claimed_at<clock_timestamp()-interval '2 minutes'));
 SELECT * INTO attempt FROM public.native_review_replies WHERE workspace_id=p_workspace_id AND actor_id=p_actor_id AND id=p_attempt_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('attemptId',attempt.id,'connectionId',attempt.connection_id,'reviewId',attempt.review_id,'text',attempt.content,'state',attempt.state,'providerConfirmedCreation',attempt.state='accepted','independentPublicationVerified',false,'emailRequested',false,'createdAt',attempt.created_at,'updatedAt',attempt.updated_at);
END $$;
CREATE FUNCTION public.review_native_store_reply(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid,p_connection_id uuid,p_revision uuid,p_review_id bigint,p_snapshot text,p_content text,p_reviewed_publication boolean,p_nonce uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_review_settings;attempt public.native_review_replies;observed public.native_store_reviews;
BEGIN
 IF p_attempt_id IS NULL OR p_connection_id IS NULL OR p_revision IS NULL OR p_review_id IS NULL OR p_review_id NOT BETWEEN 1 AND 9007199254740991 OR p_snapshot IS NULL OR p_snapshot !~ '^[a-f0-9]{64}$' OR p_content IS NULL OR length(btrim(p_content))=0 OR length(p_content)>4000 OR p_reviewed_publication IS DISTINCT FROM true OR p_nonce IS NULL THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_review_actor(p_workspace_id,p_actor_id,'/productos') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-reviews-workspace:'||p_workspace_id::text,0));
 SELECT * INTO attempt FROM public.native_review_replies WHERE id=p_attempt_id FOR UPDATE;
 IF FOUND THEN
  IF attempt.workspace_id<>p_workspace_id OR attempt.actor_id IS DISTINCT FROM p_actor_id OR attempt.connection_id<>p_connection_id OR attempt.review_id<>p_review_id OR attempt.snapshot<>p_snapshot OR attempt.content<>p_content THEN RAISE EXCEPTION 'expansion_changed';END IF;
  RETURN jsonb_build_object('claimed',false,'receipt',public.native_review_reply_receipt(p_workspace_id,p_actor_id,p_attempt_id));
 END IF;
 SELECT * INTO setting FROM public.native_review_settings WHERE id=p_connection_id AND workspace_id=p_workspace_id AND revision=p_revision AND enabled FOR UPDATE;
 IF NOT FOUND OR public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO observed FROM public.native_store_reviews WHERE connection_id=p_connection_id AND review_id=p_review_id AND snapshot=p_snapshot;
 IF NOT FOUND OR(observed.projection->>'hidden')::boolean THEN RAISE EXCEPTION 'expansion_changed';END IF;
 -- No documented reply replacement/readback/idempotency contract: one known
 -- acceptance or unresolved attempt blocks another connector reply to this review.
 IF EXISTS(SELECT 1 FROM public.native_review_replies WHERE connection_id=p_connection_id AND review_id=p_review_id AND state IN ('reviewed','dispatching','accepted','uncertain')) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 IF(SELECT count(*) FROM public.native_review_replies WHERE connection_id=p_connection_id AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND state IN ('reviewed','dispatching','accepted','uncertain'))>=setting.daily_replies THEN RAISE EXCEPTION 'expansion_limit';END IF;
 INSERT INTO public.native_review_replies(id,connection_id,review_id,workspace_id,actor_id,installation_revision,snapshot,content,nonce,state,confirmed_current_store_view)
 VALUES(p_attempt_id,p_connection_id,p_review_id,p_workspace_id,p_actor_id,p_revision,p_snapshot,p_content,p_nonce,'reviewed',true);
 RETURN jsonb_build_object('claimed',true,'attemptId',p_attempt_id,'nonce',p_nonce);
END $$;
CREATE FUNCTION public.claim_native_store_reply(p_attempt_id uuid,p_nonce uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_review_replies;setting public.native_review_settings;
BEGIN
 SELECT * INTO attempt FROM public.native_review_replies WHERE id=p_attempt_id AND nonce=p_nonce;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-reviews-workspace:'||attempt.workspace_id::text,0));
 SELECT * INTO attempt FROM public.native_review_replies WHERE id=p_attempt_id AND nonce=p_nonce FOR UPDATE;
 IF attempt.state<>'reviewed' OR attempt.created_at<clock_timestamp()-interval '3 minutes' OR NOT public.native_review_actor(attempt.workspace_id,attempt.actor_id,'/productos') OR public.workspace_billing_write_allowed(attempt.workspace_id) IS DISTINCT FROM true THEN RETURN false;END IF;
 SELECT * INTO setting FROM public.native_review_settings WHERE id=attempt.connection_id AND workspace_id=attempt.workspace_id AND revision=attempt.installation_revision AND enabled;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=attempt.workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify') OR NOT EXISTS(SELECT 1 FROM public.native_store_reviews WHERE connection_id=attempt.connection_id AND review_id=attempt.review_id AND snapshot=attempt.snapshot AND NOT(projection->>'hidden')::boolean) THEN RETURN false;END IF;
 IF(SELECT count(*) FROM public.native_review_replies WHERE connection_id=attempt.connection_id AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND state IN ('reviewed','dispatching','accepted','uncertain'))>setting.daily_replies THEN RETURN false;END IF;
 UPDATE public.native_review_replies SET state='dispatching',claimed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_attempt_id;RETURN true;
END $$;
CREATE FUNCTION public.finish_native_store_reply(p_attempt_id uuid,p_nonce uuid,p_outcome text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_review_replies;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','uncertain','canceled') THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 SELECT * INTO attempt FROM public.native_review_replies WHERE id=p_attempt_id AND nonce=p_nonce FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF attempt.state=p_outcome THEN RETURN true;END IF;
 IF(p_outcome='canceled' AND attempt.state<>'reviewed') OR(p_outcome='uncertain' AND attempt.state<>'dispatching') OR(p_outcome='accepted' AND(attempt.state NOT IN ('dispatching','uncertain') OR attempt.claimed_at IS NULL)) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 UPDATE public.native_review_replies SET state=p_outcome,updated_at=clock_timestamp() WHERE id=p_attempt_id;RETURN true;
END $$;
CREATE FUNCTION public.purge_native_store_reviews(p_grace_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE connections integer;
BEGIN
 IF p_grace_days IS NULL OR p_grace_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 DELETE FROM public.native_review_settings WHERE workspace_id IN(SELECT id FROM public.workspaces WHERE deleted_at<clock_timestamp()-p_grace_days*interval '1 day');GET DIAGNOSTICS connections=ROW_COUNT;
 -- Never convert a claimed provider write into a cancel/retry opportunity.
 UPDATE public.native_review_replies SET state='canceled',updated_at=clock_timestamp() WHERE state='reviewed' AND created_at<clock_timestamp()-interval '3 minutes';
 UPDATE public.native_review_replies SET state='uncertain',updated_at=clock_timestamp() WHERE state='dispatching' AND claimed_at<clock_timestamp()-interval '2 minutes';
 RETURN jsonb_build_object('connections',connections);
END $$;
CREATE FUNCTION public.native_store_reviews_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_regclass('public.native_review_settings') IS NOT NULL AND to_regclass('public.native_store_reviews') IS NOT NULL AND to_regclass('public.native_review_replies') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('native_review_settings','native_store_reviews','native_review_replies')
 AND(NOT c.relrowsecurity OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('native_review_actor','native_reviews_settings_read','set_native_reviews_settings','native_reviews_private_connection','cache_native_store_reviews','native_review_reply_receipt','review_native_store_reply','claim_native_store_reply','finish_native_store_reply','purge_native_store_reviews','native_store_reviews_ready')
 AND(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']));
$$;
DO $$DECLARE fn regprocedure;BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('native_review_actor','native_reviews_settings_read','set_native_reviews_settings','native_reviews_private_connection','cache_native_store_reviews','native_review_reply_receipt','review_native_store_reply','claim_native_store_reply','finish_native_store_reply','purge_native_store_reviews','native_store_reviews_ready') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END $$;

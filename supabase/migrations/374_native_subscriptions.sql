-- X5: optional Recharge, private and additive. Installation performs no provider
-- writes, billing changes, emails, AI requests or changes to the current UI.
CREATE TABLE public.native_subscription_settings(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
 shopify_connection_id uuid NOT NULL UNIQUE REFERENCES public.shopify_connections(id) ON DELETE CASCADE,
 shop_domain text NOT NULL CHECK(shop_domain ~ '^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$'),
 recharge_store_id bigint NOT NULL UNIQUE CHECK(recharge_store_id BETWEEN 1 AND 9007199254740991),identifier text NOT NULL CHECK(length(identifier) BETWEEN 1 AND 500),
 encrypted_key text NOT NULL CHECK(length(encrypted_key) BETWEEN 60 AND 9000),revision uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 daily_changes integer NOT NULL CHECK(daily_changes BETWEEN 1 AND 1000),confirmed_store_mapping boolean NOT NULL CHECK(confirmed_store_mapping),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.native_case_subscriptions(
 connection_id uuid NOT NULL REFERENCES public.native_subscription_settings(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,contact_updated_at timestamptz NOT NULL,order_updated_at timestamptz NOT NULL,
 provider_order_id text NOT NULL,shopify_customer_id text NOT NULL CHECK(shopify_customer_id ~ '^[1-9][0-9]{0,19}$'),
 subscription_id bigint NOT NULL CHECK(subscription_id BETWEEN 1 AND 9007199254740991),customer_id bigint NOT NULL CHECK(customer_id BETWEEN 1 AND 9007199254740991),address_id bigint NOT NULL CHECK(address_id BETWEEN 1 AND 9007199254740991),
 snapshot text NOT NULL CHECK(snapshot ~ '^[a-f0-9]{64}$'),projection jsonb NOT NULL,deliveries jsonb NOT NULL DEFAULT '[]'::jsonb,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(connection_id,conversation_id,order_id,subscription_id)
);
CREATE TABLE public.native_subscription_actions(
 id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES public.native_subscription_settings(id) ON DELETE CASCADE,conversation_id uuid NOT NULL,order_id uuid NOT NULL,subscription_id bigint NOT NULL,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 installation_revision uuid NOT NULL,snapshot text NOT NULL CHECK(snapshot ~ '^[a-f0-9]{64}$'),change jsonb NOT NULL,before_state jsonb NOT NULL,before_deliveries jsonb NOT NULL,shopify_customer_id text NOT NULL,nonce uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('reviewed','dispatching','accepted','observed','uncertain','canceled')),provider_accepted boolean NOT NULL DEFAULT false,desired_state_observed boolean NOT NULL DEFAULT false,
 confirmed_billing_effects boolean NOT NULL CHECK(confirmed_billing_effects),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),claimed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX native_subscription_action_lookup ON public.native_subscription_actions(connection_id,subscription_id,created_at DESC);
-- An absent receipt does not prove a delayed request cannot arrive later.
-- Durable abandonment prevents that late request from executing this UUID.
CREATE TABLE public.native_subscription_abandoned_attempts(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,connection_id uuid NOT NULL,conversation_id uuid NOT NULL,order_id uuid NOT NULL,subscription_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.native_subscription_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_case_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_subscription_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_subscription_abandoned_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.native_subscription_settings,public.native_case_subscriptions,public.native_subscription_actions,public.native_subscription_abandoned_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.native_subscription_actor(p_workspace_id uuid,p_actor_id uuid,p_section text,p_admin boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(p_workspace_id IS NOT NULL AND p_actor_id IS NOT NULL AND p_section IN ('/bandeja','/ajustes') AND p_admin IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND(w.owner_id=p_actor_id OR EXISTS(
 SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent') AND(NOT p_admin OR m.role='admin')
 AND(m.allowed_sections IS NULL OR(jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? p_section))))),false);
$$;
CREATE FUNCTION public.native_subscription_case_allowed(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_order_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(public.native_subscription_actor(p_workspace_id,p_actor_id,'/bandeja') AND EXISTS(
 SELECT 1 FROM public.conversations c JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
 JOIN public.orders o ON o.id=p_order_id AND o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
 WHERE c.id=p_conversation_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL AND o.platform='shopify'
 AND c.channel IS NOT NULL AND(c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(
 SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=p_workspace_id AND cc.channel=c.channel AND cc.created_by=p_actor_id))),false);
$$;
CREATE FUNCTION public.native_subscriptions_settings_read(p_workspace_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_subscription_settings;stores jsonb;
BEGIN
 IF NOT public.native_subscription_actor(p_workspace_id,p_actor_id,'/ajustes',true) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'shopDomain',shop_domain) ORDER BY shop_domain,id),'[]'::jsonb) INTO stores FROM public.shopify_connections WHERE workspace_id=p_workspace_id AND status='active' AND platform='shopify';
 SELECT * INTO setting FROM public.native_subscription_settings WHERE workspace_id=p_workspace_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('configured',false,'enabled',false,'stores',stores);END IF;
 RETURN jsonb_build_object('configured',true,'connectionId',setting.id,'shopifyConnectionId',setting.shopify_connection_id,'shopDomain',setting.shop_domain,'storeId',setting.recharge_store_id,'identifier',setting.identifier,'revision',setting.revision,
 'enabled',setting.enabled AND EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify'),
 'dailyChanges',setting.daily_changes,'stores',stores);
END $$;
CREATE FUNCTION public.set_native_subscriptions_settings(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_shopify_connection_id uuid,p_shop_domain text,p_store_id bigint,p_identifier text,p_revision uuid,p_encrypted_key text,p_enabled boolean,p_daily_changes integer,p_confirmed_mapping boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_subscription_settings;
BEGIN
 IF p_connection_id IS NULL OR p_shopify_connection_id IS NULL OR p_revision IS NULL OR p_shop_domain IS NULL OR p_shop_domain !~ '^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$' OR p_store_id IS NULL OR p_store_id NOT BETWEEN 1 AND 9007199254740991 OR p_identifier IS NULL OR length(p_identifier) NOT BETWEEN 1 AND 500 OR p_encrypted_key IS NULL OR length(p_encrypted_key) NOT BETWEEN 60 AND 9000 OR p_enabled IS NULL OR p_daily_changes IS NULL OR p_daily_changes NOT BETWEEN 1 AND 1000 OR p_confirmed_mapping IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_subscription_actor(p_workspace_id,p_actor_id,'/ajustes',true) OR(p_enabled AND public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-subscriptions-workspace:'||p_workspace_id::text,0));
 SELECT * INTO setting FROM public.native_subscription_settings WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF FOUND AND(setting.id<>p_connection_id OR setting.shopify_connection_id<>p_shopify_connection_id OR setting.shop_domain<>p_shop_domain OR setting.recharge_store_id<>p_store_id OR setting.identifier<>p_identifier) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 IF(p_enabled OR setting.id IS NULL) AND NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=p_shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=p_shop_domain AND status='active' AND platform='shopify') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 INSERT INTO public.native_subscription_settings(id,workspace_id,shopify_connection_id,shop_domain,recharge_store_id,identifier,encrypted_key,revision,enabled,daily_changes,confirmed_store_mapping,updated_by)
 VALUES(p_connection_id,p_workspace_id,p_shopify_connection_id,p_shop_domain,p_store_id,p_identifier,p_encrypted_key,p_revision,p_enabled,p_daily_changes,true,p_actor_id)
 ON CONFLICT(workspace_id) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,revision=EXCLUDED.revision,enabled=EXCLUDED.enabled,daily_changes=EXCLUDED.daily_changes,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 RETURN public.native_subscriptions_settings_read(p_workspace_id,p_actor_id);
END $$;
CREATE FUNCTION public.native_subscriptions_private_connection(p_workspace_id uuid,p_actor_id uuid,p_section text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_subscription_settings;
BEGIN
 IF NOT public.native_subscription_actor(p_workspace_id,p_actor_id,p_section,p_section='/ajustes') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO setting FROM public.native_subscription_settings WHERE workspace_id=p_workspace_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF p_section='/bandeja' AND(NOT setting.enabled OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify')) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 RETURN to_jsonb(setting);
END $$;
CREATE FUNCTION public.native_subscriptions_case_context(p_workspace_id uuid,p_actor_id uuid,p_conversation_id uuid,p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.native_subscription_case_allowed(p_workspace_id,p_actor_id,p_conversation_id,p_order_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT jsonb_build_object('conversationId',c.id,'orderId',o.id,'contactId',ct.id,'providerOrderId',o.shopify_order_id,'shopDomain',o.shop_domain,'contactUpdatedAt',ct.updated_at,'orderUpdatedAt',o.updated_at,'email',ct.email,'phone',ct.phone)
 INTO result FROM public.conversations c JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=p_workspace_id JOIN public.orders o ON o.id=p_order_id AND o.workspace_id=p_workspace_id AND o.contact_id=ct.id WHERE c.id=p_conversation_id AND c.workspace_id=p_workspace_id;
 RETURN result;
END $$;
CREATE FUNCTION public.native_subscription_projection_valid(p_row jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT COALESCE(jsonb_typeof(p_row)='object' AND p_row ?& ARRAY['id','customerId','addressId','status','quantity','price','productId','variantId','title','variantTitle','orderIntervalFrequency','chargeIntervalFrequency','orderIntervalUnit','nextChargeScheduledAt','isPrepaid','isSkippable','updatedAt','cancellationReason','cancellationComments','cancelledAt']
 AND p_row-ARRAY['id','customerId','addressId','status','quantity','price','productId','variantId','title','variantTitle','orderIntervalFrequency','chargeIntervalFrequency','orderIntervalUnit','nextChargeScheduledAt','isPrepaid','isSkippable','updatedAt','cancellationReason','cancellationComments','cancelledAt']='{}'::jsonb
 AND jsonb_typeof(p_row->'id')='number' AND p_row->>'id' ~ '^[1-9][0-9]*$' AND(p_row->>'id')::numeric<=9007199254740991
 AND jsonb_typeof(p_row->'customerId')='number' AND p_row->>'customerId' ~ '^[1-9][0-9]*$' AND(p_row->>'customerId')::numeric<=9007199254740991
 AND jsonb_typeof(p_row->'addressId')='number' AND p_row->>'addressId' ~ '^[1-9][0-9]*$' AND(p_row->>'addressId')::numeric<=9007199254740991
 AND p_row->>'status' IN ('active','cancelled','expired') AND jsonb_typeof(p_row->'isPrepaid')='boolean' AND jsonb_typeof(p_row->'isSkippable')='boolean'
 AND jsonb_typeof(p_row->'quantity')='number' AND p_row->>'quantity' ~ '^[1-9][0-9]*$' AND(p_row->>'quantity')::numeric<=10000
 AND jsonb_typeof(p_row->'price')='string' AND length(p_row->>'price')<=40 AND p_row->>'price' ~ '^[0-9]+(\.[0-9]{1,6})?$'
 AND jsonb_typeof(p_row->'orderIntervalFrequency')='number' AND p_row->>'orderIntervalFrequency' ~ '^[1-9][0-9]*$' AND(p_row->>'orderIntervalFrequency')::numeric<=10000
 AND jsonb_typeof(p_row->'chargeIntervalFrequency') IN ('number','string') AND p_row->>'chargeIntervalFrequency' ~ '^[1-9][0-9]{0,4}$' AND(p_row->>'chargeIntervalFrequency')::numeric<=10000
 AND p_row->>'orderIntervalUnit' IN ('day','week','month') AND jsonb_typeof(p_row->'updatedAt')='string',false);
$$;
CREATE FUNCTION public.native_subscription_deliveries_valid(p_rows jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE row jsonb;line jsonb;
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>1000 THEN RETURN false;END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row)<>'object' OR row-ARRAY['date','addressId','chargeId','lines']<>'{}'::jsonb OR NOT(row ?& ARRAY['date','addressId','chargeId','lines']) OR jsonb_typeof(row->'date') IS DISTINCT FROM 'string' OR row->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(row->'addressId') IS DISTINCT FROM 'number' OR row->>'addressId' !~ '^[1-9][0-9]*$' OR(row->>'addressId')::numeric>9007199254740991
  OR jsonb_typeof(row->'chargeId') IS DISTINCT FROM 'number' OR row->>'chargeId' !~ '^[1-9][0-9]*$' OR(row->>'chargeId')::numeric>9007199254740991
  OR jsonb_typeof(row->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(row->'lines')>250 THEN RETURN false;END IF;
  PERFORM(row->>'date')::date;
  IF(SELECT count(*)<>count(DISTINCT value->>'subscriptionId') FROM jsonb_array_elements(row->'lines')) THEN RETURN false;END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(row->'lines') LOOP
   IF jsonb_typeof(line)<>'object' OR line-ARRAY['subscriptionId','isSkippable','isSkipped','isPrepaid']<>'{}'::jsonb OR NOT(line ?& ARRAY['subscriptionId','isSkippable','isSkipped','isPrepaid'])
   OR jsonb_typeof(line->'subscriptionId') IS DISTINCT FROM 'number' OR line->>'subscriptionId' !~ '^[1-9][0-9]*$' OR(line->>'subscriptionId')::numeric>9007199254740991
   OR jsonb_typeof(line->'isSkippable') IS DISTINCT FROM 'boolean' OR jsonb_typeof(line->'isSkipped') IS DISTINCT FROM 'boolean' OR jsonb_typeof(line->'isPrepaid') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION public.cache_native_case_subscriptions(p_workspace_id uuid,p_actor_id uuid,p_connection_id uuid,p_revision uuid,p_conversation_id uuid,p_order_id uuid,p_shopify_customer_id text,p_context jsonb,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_subscription_settings;ctx jsonb;item jsonb;sub jsonb;last_action public.native_subscription_actions;result jsonb='[]'::jsonb;
BEGIN
 IF p_shopify_customer_id IS NULL OR p_shopify_customer_id !~ '^[1-9][0-9]{0,19}$' OR p_context IS NULL OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 ctx=public.native_subscriptions_case_context(p_workspace_id,p_actor_id,p_conversation_id,p_order_id);
 IF ctx IS DISTINCT FROM p_context THEN RAISE EXCEPTION 'expansion_changed';END IF;
 SELECT * INTO setting FROM public.native_subscription_settings WHERE id=p_connection_id AND workspace_id=p_workspace_id AND revision=p_revision AND enabled FOR UPDATE;
 IF NOT FOUND OR setting.shop_domain IS DISTINCT FROM ctx->>'shopDomain' OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 UPDATE public.native_subscription_actions SET state=CASE WHEN state='reviewed' THEN 'canceled' ELSE 'uncertain' END,updated_at=clock_timestamp() WHERE connection_id=p_connection_id AND((state='reviewed' AND created_at<clock_timestamp()-interval '3 minutes') OR(state='dispatching' AND claimed_at<clock_timestamp()-interval '2 minutes'));
 IF(SELECT count(*)<>count(DISTINCT value->'subscription'->>'id') FROM jsonb_array_elements(p_rows)) THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  sub=item->'subscription';
  IF NOT public.native_subscription_projection_valid(sub) OR item-ARRAY['subscription','snapshot','deliveries']<>'{}'::jsonb OR NOT(item ?& ARRAY['subscription','snapshot','deliveries']) OR jsonb_typeof(item->'snapshot') IS DISTINCT FROM 'string' OR item->>'snapshot' !~ '^[a-f0-9]{64}$' OR NOT public.native_subscription_deliveries_valid(item->'deliveries') THEN RAISE EXCEPTION 'invalid_expansion';END IF;
  INSERT INTO public.native_case_subscriptions(connection_id,conversation_id,order_id,contact_id,contact_updated_at,order_updated_at,provider_order_id,shopify_customer_id,subscription_id,customer_id,address_id,snapshot,projection,deliveries)
  VALUES(p_connection_id,p_conversation_id,p_order_id,(ctx->>'contactId')::uuid,(ctx->>'contactUpdatedAt')::timestamptz,(ctx->>'orderUpdatedAt')::timestamptz,ctx->>'providerOrderId',p_shopify_customer_id,(sub->>'id')::bigint,(sub->>'customerId')::bigint,(sub->>'addressId')::bigint,item->>'snapshot',sub,item->'deliveries')
  ON CONFLICT(connection_id,conversation_id,order_id,subscription_id) DO UPDATE SET contact_id=EXCLUDED.contact_id,contact_updated_at=EXCLUDED.contact_updated_at,order_updated_at=EXCLUDED.order_updated_at,provider_order_id=EXCLUDED.provider_order_id,shopify_customer_id=EXCLUDED.shopify_customer_id,customer_id=EXCLUDED.customer_id,address_id=EXCLUDED.address_id,snapshot=EXCLUDED.snapshot,projection=EXCLUDED.projection,deliveries=EXCLUDED.deliveries,observed_at=clock_timestamp();
  SELECT * INTO last_action FROM public.native_subscription_actions WHERE connection_id=p_connection_id AND subscription_id=(sub->>'id')::bigint AND state IN ('reviewed','dispatching','accepted','uncertain') ORDER BY created_at DESC,id DESC LIMIT 1;
  result=result||jsonb_build_array(jsonb_build_object('subscription',sub,'snapshot',item->>'snapshot','blocked',FOUND,'ownAttemptId',CASE WHEN last_action.actor_id=p_actor_id AND last_action.conversation_id=p_conversation_id AND last_action.order_id=p_order_id THEN last_action.id ELSE NULL END));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.native_subscription_action_receipt(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_subscription_actions;
BEGIN
 IF NOT public.native_subscription_actor(p_workspace_id,p_actor_id,'/bandeja') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 UPDATE public.native_subscription_actions SET state=CASE WHEN state='reviewed' THEN 'canceled' ELSE 'uncertain' END,updated_at=clock_timestamp() WHERE id=p_attempt_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id AND((state='reviewed' AND created_at<clock_timestamp()-interval '3 minutes') OR(state='dispatching' AND claimed_at<clock_timestamp()-interval '2 minutes'));
 SELECT * INTO attempt FROM public.native_subscription_actions WHERE id=p_attempt_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT public.native_subscription_case_allowed(p_workspace_id,p_actor_id,attempt.conversation_id,attempt.order_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 RETURN jsonb_build_object('attemptId',attempt.id,'connectionId',attempt.connection_id,'revision',attempt.installation_revision,'snapshot',attempt.snapshot,'conversationId',attempt.conversation_id,'orderId',attempt.order_id,'subscriptionId',attempt.subscription_id,'change',attempt.change,'before',attempt.before_state,'state',attempt.state,'providerAccepted',attempt.provider_accepted,'desiredStateObserved',attempt.desired_state_observed,'causalityVerified',false,'emailRequested',false,'createdAt',attempt.created_at,'updatedAt',attempt.updated_at);
END $$;
CREATE FUNCTION public.native_subscription_source_current(p_connection_id uuid,p_conversation_id uuid,p_order_id uuid,p_subscription_id bigint,p_snapshot text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.native_case_subscriptions s JOIN public.native_subscription_settings setting ON setting.id=s.connection_id
 JOIN public.conversations c ON c.id=s.conversation_id AND c.workspace_id=setting.workspace_id AND c.contact_id=s.contact_id AND c.deleted_at IS NULL
 JOIN public.contacts ct ON ct.id=s.contact_id AND ct.workspace_id=setting.workspace_id AND ct.updated_at=s.contact_updated_at
 JOIN public.orders o ON o.id=s.order_id AND o.workspace_id=setting.workspace_id AND o.contact_id=s.contact_id AND o.updated_at=s.order_updated_at AND o.shopify_order_id=s.provider_order_id AND o.shop_domain=setting.shop_domain AND o.platform='shopify'
 WHERE s.connection_id=p_connection_id AND s.conversation_id=p_conversation_id AND s.order_id=p_order_id AND s.subscription_id=p_subscription_id AND s.snapshot=p_snapshot AND s.observed_at>clock_timestamp()-interval '3 minutes');
$$;
CREATE FUNCTION public.review_native_subscription_action(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid,p_connection_id uuid,p_revision uuid,p_conversation_id uuid,p_order_id uuid,p_subscription_id bigint,p_snapshot text,p_change jsonb,p_confirmed_billing boolean,p_nonce uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE setting public.native_subscription_settings;attempt public.native_subscription_actions;source public.native_case_subscriptions;kind text;
BEGIN
 IF p_attempt_id IS NULL OR p_connection_id IS NULL OR p_revision IS NULL OR p_subscription_id IS NULL OR p_subscription_id NOT BETWEEN 1 AND 9007199254740991 OR p_snapshot IS NULL OR p_snapshot !~ '^[a-f0-9]{64}$' OR p_change IS NULL OR jsonb_typeof(p_change)<>'object' OR p_confirmed_billing IS DISTINCT FROM true OR p_nonce IS NULL THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 kind=p_change->>'type';
 IF kind IS NULL OR kind NOT IN ('quantity','cadence','date','cancel','activate','skip') OR
 (kind='quantity' AND(p_change-ARRAY['type','quantity']<>'{}'::jsonb OR jsonb_typeof(p_change->'quantity') IS DISTINCT FROM 'number' OR p_change->>'quantity' !~ '^[1-9][0-9]*$' OR(p_change->>'quantity')::numeric>100)) OR
 (kind='cadence' AND(p_change-ARRAY['type','unit','orderFrequency','chargeFrequency']<>'{}'::jsonb OR NOT(p_change ?& ARRAY['type','unit','orderFrequency','chargeFrequency']) OR jsonb_typeof(p_change->'unit') IS DISTINCT FROM 'string' OR p_change->>'unit' NOT IN ('day','week','month') OR jsonb_typeof(p_change->'orderFrequency')<>'number' OR jsonb_typeof(p_change->'chargeFrequency')<>'number' OR p_change->>'orderFrequency' !~ '^[1-9][0-9]*$' OR p_change->>'chargeFrequency' !~ '^[1-9][0-9]*$' OR(p_change->>'orderFrequency')::numeric>1000 OR(p_change->>'chargeFrequency')::numeric>1000)) OR
 (kind='date' AND(p_change-ARRAY['type','date']<>'{}'::jsonb OR jsonb_typeof(p_change->'date') IS DISTINCT FROM 'string' OR p_change->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) OR
 (kind='cancel' AND(p_change-ARRAY['type','reason','comments']<>'{}'::jsonb OR NOT(p_change ?& ARRAY['type','reason','comments']) OR jsonb_typeof(p_change->'reason')<>'string' OR length(btrim(p_change->>'reason')) NOT BETWEEN 1 AND 1000 OR jsonb_typeof(p_change->'comments')<>'string' OR length(p_change->>'comments')>1024)) OR
 (kind='activate' AND p_change<>jsonb_build_object('type','activate')) OR
 (kind='skip' AND(p_change-ARRAY['type','chargeId','date']<>'{}'::jsonb OR NOT(p_change ?& ARRAY['type','chargeId','date']) OR jsonb_typeof(p_change->'chargeId')<>'number' OR p_change->>'chargeId' !~ '^[1-9][0-9]*$' OR(p_change->>'chargeId')::numeric>9007199254740991 OR jsonb_typeof(p_change->'date')<>'string' OR p_change->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF kind IN ('date','skip') THEN PERFORM(p_change->>'date')::date;END IF;
 IF NOT public.native_subscription_case_allowed(p_workspace_id,p_actor_id,p_conversation_id,p_order_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-subscriptions-workspace:'||p_workspace_id::text,0));
 SELECT * INTO attempt FROM public.native_subscription_actions WHERE id=p_attempt_id FOR UPDATE;
 IF FOUND THEN
  IF attempt.workspace_id<>p_workspace_id OR attempt.actor_id IS DISTINCT FROM p_actor_id OR attempt.connection_id<>p_connection_id OR attempt.conversation_id<>p_conversation_id OR attempt.order_id<>p_order_id OR attempt.subscription_id<>p_subscription_id OR attempt.snapshot<>p_snapshot OR attempt.change<>p_change THEN RAISE EXCEPTION 'expansion_changed';END IF;
  RETURN jsonb_build_object('claimed',false,'receipt',public.native_subscription_action_receipt(p_workspace_id,p_actor_id,p_attempt_id));
 END IF;
 IF EXISTS(SELECT 1 FROM public.native_subscription_abandoned_attempts WHERE id=p_attempt_id) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 SELECT * INTO setting FROM public.native_subscription_settings WHERE id=p_connection_id AND workspace_id=p_workspace_id AND revision=p_revision AND enabled FOR UPDATE;
 IF NOT FOUND OR public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=p_workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify') THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 SELECT * INTO source FROM public.native_case_subscriptions WHERE connection_id=p_connection_id AND conversation_id=p_conversation_id AND order_id=p_order_id AND subscription_id=p_subscription_id AND snapshot=p_snapshot;
 IF NOT FOUND OR NOT public.native_subscription_source_current(p_connection_id,p_conversation_id,p_order_id,p_subscription_id,p_snapshot) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 IF(kind='activate' AND source.projection->>'status'<>'cancelled') OR(kind<>'activate' AND source.projection->>'status'<>'active') THEN RAISE EXCEPTION 'expansion_changed';END IF;
 IF EXISTS(SELECT 1 FROM public.native_subscription_actions WHERE connection_id=p_connection_id AND subscription_id=p_subscription_id AND state IN ('reviewed','dispatching','accepted','uncertain')) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 IF(SELECT count(*) FROM public.native_subscription_actions WHERE connection_id=p_connection_id AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND state<>'canceled')>=setting.daily_changes THEN RAISE EXCEPTION 'expansion_limit';END IF;
 INSERT INTO public.native_subscription_actions(id,connection_id,conversation_id,order_id,subscription_id,workspace_id,actor_id,installation_revision,snapshot,change,before_state,before_deliveries,shopify_customer_id,nonce,state,confirmed_billing_effects)
 VALUES(p_attempt_id,p_connection_id,p_conversation_id,p_order_id,p_subscription_id,p_workspace_id,p_actor_id,p_revision,p_snapshot,p_change,source.projection,source.deliveries,source.shopify_customer_id,p_nonce,'reviewed',true);
 RETURN jsonb_build_object('claimed',true,'attemptId',p_attempt_id,'nonce',p_nonce);
END $$;
CREATE FUNCTION public.claim_native_subscription_action(p_attempt_id uuid,p_nonce uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_subscription_actions;setting public.native_subscription_settings;
BEGIN
 SELECT * INTO attempt FROM public.native_subscription_actions WHERE id=p_attempt_id AND nonce=p_nonce;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-subscriptions-workspace:'||attempt.workspace_id::text,0));
 SELECT * INTO attempt FROM public.native_subscription_actions WHERE id=p_attempt_id AND nonce=p_nonce FOR UPDATE;
 IF attempt.state<>'reviewed' OR attempt.created_at<clock_timestamp()-interval '3 minutes' OR NOT public.native_subscription_case_allowed(attempt.workspace_id,attempt.actor_id,attempt.conversation_id,attempt.order_id) OR public.workspace_billing_write_allowed(attempt.workspace_id) IS DISTINCT FROM true THEN RETURN false;END IF;
 SELECT * INTO setting FROM public.native_subscription_settings WHERE id=attempt.connection_id AND workspace_id=attempt.workspace_id AND revision=attempt.installation_revision AND enabled;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.shopify_connections WHERE id=setting.shopify_connection_id AND workspace_id=attempt.workspace_id AND shop_domain=setting.shop_domain AND status='active' AND platform='shopify') OR NOT public.native_subscription_source_current(attempt.connection_id,attempt.conversation_id,attempt.order_id,attempt.subscription_id,attempt.snapshot) THEN RETURN false;END IF;
 IF(SELECT count(*) FROM public.native_subscription_actions WHERE connection_id=attempt.connection_id AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND state<>'canceled')>setting.daily_changes THEN RETURN false;END IF;
 UPDATE public.native_subscription_actions SET state='dispatching',claimed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_attempt_id;RETURN true;
END $$;
CREATE FUNCTION public.finish_native_subscription_action(p_attempt_id uuid,p_nonce uuid,p_outcome text,p_provider_accepted boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_subscription_actions;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','observed','uncertain','canceled') OR p_provider_accepted IS NULL THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 SELECT * INTO attempt FROM public.native_subscription_actions WHERE id=p_attempt_id AND nonce=p_nonce FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF attempt.state=p_outcome AND(attempt.provider_accepted OR NOT p_provider_accepted) THEN RETURN true;END IF;
 IF(p_outcome='canceled' AND(attempt.state<>'reviewed' OR p_provider_accepted)) OR(p_outcome<>'canceled' AND(attempt.state NOT IN ('dispatching','accepted','uncertain') OR attempt.claimed_at IS NULL)) OR(p_outcome='accepted' AND NOT p_provider_accepted) THEN RAISE EXCEPTION 'expansion_changed';END IF;
 -- An observed target state after an unknown POST does not prove receipt of
 -- that POST. Keep its uncertainty blocking; known acceptance + readback may
 -- permit a different, newly reviewed change. Never release an in-flight call.
 IF p_outcome='observed' AND attempt.state='dispatching' THEN RAISE EXCEPTION 'expansion_changed';END IF;
 UPDATE public.native_subscription_actions SET state=CASE WHEN p_outcome='observed' AND NOT(provider_accepted OR p_provider_accepted) THEN 'uncertain' ELSE p_outcome END,
 provider_accepted=provider_accepted OR p_provider_accepted,desired_state_observed=desired_state_observed OR p_outcome='observed',updated_at=clock_timestamp() WHERE id=p_attempt_id;RETURN true;
END $$;
CREATE FUNCTION public.native_subscription_action_private(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_subscription_actions;
BEGIN
 SELECT * INTO attempt FROM public.native_subscription_actions WHERE id=p_attempt_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT public.native_subscription_case_allowed(p_workspace_id,p_actor_id,attempt.conversation_id,attempt.order_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 RETURN jsonb_build_object('nonce',attempt.nonce,'snapshot',attempt.snapshot,'shopifyCustomerId',attempt.shopify_customer_id,'deliveries',attempt.before_deliveries,'revision',attempt.installation_revision);
END $$;
CREATE FUNCTION public.purge_native_subscriptions(p_grace_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE connections integer;
BEGIN
 IF p_grace_days IS NULL OR p_grace_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 DELETE FROM public.native_subscription_settings WHERE workspace_id IN(SELECT id FROM public.workspaces WHERE deleted_at<clock_timestamp()-p_grace_days*interval '1 day');GET DIAGNOSTICS connections=ROW_COUNT;
 DELETE FROM public.native_subscription_abandoned_attempts WHERE workspace_id IN(SELECT id FROM public.workspaces WHERE deleted_at<clock_timestamp()-p_grace_days*interval '1 day');
 UPDATE public.native_subscription_actions SET state='canceled',updated_at=clock_timestamp() WHERE state='reviewed' AND created_at<clock_timestamp()-interval '3 minutes';
 UPDATE public.native_subscription_actions SET state='uncertain',updated_at=clock_timestamp() WHERE state='dispatching' AND claimed_at<clock_timestamp()-interval '2 minutes';
 RETURN jsonb_build_object('connections',connections);
END $$;
CREATE FUNCTION public.abandon_native_subscription_attempt(p_workspace_id uuid,p_actor_id uuid,p_attempt_id uuid,p_connection_id uuid,p_conversation_id uuid,p_order_id uuid,p_subscription_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.native_subscription_actions;abandoned public.native_subscription_abandoned_attempts;
BEGIN
 IF p_attempt_id IS NULL OR p_connection_id IS NULL OR p_subscription_id IS NULL OR p_subscription_id NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'invalid_expansion';END IF;
 IF NOT public.native_subscription_case_allowed(p_workspace_id,p_actor_id,p_conversation_id,p_order_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-subscriptions-workspace:'||p_workspace_id::text,0));
 SELECT * INTO attempt FROM public.native_subscription_actions WHERE id=p_attempt_id FOR UPDATE;
 IF FOUND THEN
  IF attempt.workspace_id<>p_workspace_id OR attempt.actor_id IS DISTINCT FROM p_actor_id OR attempt.connection_id<>p_connection_id OR attempt.conversation_id<>p_conversation_id OR attempt.order_id<>p_order_id OR attempt.subscription_id<>p_subscription_id THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
  IF attempt.state NOT IN ('reviewed','canceled') THEN RETURN jsonb_build_object('abandoned',false);END IF;
  UPDATE public.native_subscription_actions SET state='canceled',updated_at=clock_timestamp() WHERE id=p_attempt_id;RETURN jsonb_build_object('abandoned',true);
 END IF;
 SELECT * INTO abandoned FROM public.native_subscription_abandoned_attempts WHERE id=p_attempt_id;
 IF FOUND THEN
  IF abandoned.workspace_id<>p_workspace_id OR abandoned.actor_id IS DISTINCT FROM p_actor_id OR abandoned.connection_id<>p_connection_id OR abandoned.conversation_id<>p_conversation_id OR abandoned.order_id<>p_order_id OR abandoned.subscription_id<>p_subscription_id THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
  RETURN jsonb_build_object('abandoned',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.native_subscription_settings WHERE id=p_connection_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'expansion_not_allowed';END IF;
 IF(SELECT count(*) FROM public.native_subscription_abandoned_attempts WHERE workspace_id=p_workspace_id AND created_at>clock_timestamp()-interval '1 day')>=1000 THEN RAISE EXCEPTION 'expansion_limit';END IF;
 INSERT INTO public.native_subscription_abandoned_attempts(id,workspace_id,actor_id,connection_id,conversation_id,order_id,subscription_id) VALUES(p_attempt_id,p_workspace_id,p_actor_id,p_connection_id,p_conversation_id,p_order_id,p_subscription_id);
 RETURN jsonb_build_object('abandoned',true);
END $$;
CREATE FUNCTION public.native_subscriptions_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_regclass('public.native_subscription_settings') IS NOT NULL AND to_regclass('public.native_case_subscriptions') IS NOT NULL AND to_regclass('public.native_subscription_actions') IS NOT NULL AND to_regclass('public.native_subscription_abandoned_attempts') IS NOT NULL
 AND(SELECT count(*)=18 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('native_subscription_actor','native_subscription_case_allowed','native_subscriptions_settings_read','set_native_subscriptions_settings','native_subscriptions_private_connection','native_subscriptions_case_context','native_subscription_projection_valid','native_subscription_deliveries_valid','cache_native_case_subscriptions','native_subscription_action_receipt','native_subscription_source_current','review_native_subscription_action','claim_native_subscription_action','finish_native_subscription_action','native_subscription_action_private','purge_native_subscriptions','abandon_native_subscription_attempt','native_subscriptions_ready'))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('native_subscription_settings','native_case_subscriptions','native_subscription_actions','native_subscription_abandoned_attempts') AND(NOT c.relrowsecurity OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('native_subscription_actor','native_subscription_case_allowed','native_subscriptions_settings_read','set_native_subscriptions_settings','native_subscriptions_private_connection','native_subscriptions_case_context','native_subscription_projection_valid','native_subscription_deliveries_valid','cache_native_case_subscriptions','native_subscription_action_receipt','native_subscription_source_current','review_native_subscription_action','claim_native_subscription_action','finish_native_subscription_action','native_subscription_action_private','purge_native_subscriptions','abandon_native_subscription_attempt','native_subscriptions_ready')
 AND(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']));
$$;
DO $$DECLARE fn regprocedure;BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('native_subscription_actor','native_subscription_case_allowed','native_subscriptions_settings_read','set_native_subscriptions_settings','native_subscriptions_private_connection','native_subscriptions_case_context','native_subscription_projection_valid','native_subscription_deliveries_valid','cache_native_case_subscriptions','native_subscription_action_receipt','native_subscription_source_current','review_native_subscription_action','claim_native_subscription_action','finish_native_subscription_action','native_subscription_action_private','purge_native_subscriptions','abandon_native_subscription_attempt','native_subscriptions_ready') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END $$;

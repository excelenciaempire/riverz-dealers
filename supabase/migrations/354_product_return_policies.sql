-- Versioned merchant declarations. No eligibility denial or financial execution.
CREATE TABLE public.product_return_policies(
 product_id uuid PRIMARY KEY REFERENCES public.shopify_products(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0),
 policy jsonb,
 changed_at timestamptz NOT NULL,
 changed_by uuid NOT NULL
);
CREATE TABLE public.product_return_policy_events(
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES public.shopify_products(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 expected_revision integer NOT NULL CHECK(expected_revision>=0),
 revision integer NOT NULL CHECK(revision>0),
 policy jsonb,
 changed_at timestamptz NOT NULL,
 UNIQUE(product_id,revision)
);
ALTER TABLE public.product_return_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_policy_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_return_policies,public.product_return_policy_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.product_return_policy_access(p_workspace_id uuid,p_actor_id uuid,p_product_id uuid,p_write boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_write IS NOT NULL AND EXISTS(SELECT 1 FROM public.shopify_products p JOIN public.workspaces w ON w.id=p.workspace_id
 WHERE p.id=p_product_id AND p.workspace_id=p_workspace_id AND w.deleted_at IS NULL AND (w.owner_id=p_actor_id OR EXISTS(
 SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent')
 AND (NOT p_write OR m.role='admin') AND (m.allowed_sections IS NULL OR
 (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/productos')))));
$$;
CREATE FUNCTION public.read_product_return_policy(p_workspace_id uuid,p_actor_id uuid,p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE policy public.product_return_policies;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_product_id IS NULL THEN RAISE EXCEPTION 'invalid_product_return_policy';END IF;
 IF NOT public.product_return_policy_access(p_workspace_id,p_actor_id,p_product_id,false) THEN RAISE EXCEPTION 'product_return_policy_not_found';END IF;
 SELECT * INTO policy FROM public.product_return_policies WHERE product_id=p_product_id AND workspace_id=p_workspace_id;
 RETURN jsonb_build_object('snapshot',jsonb_build_object('product_id',p_product_id,'revision',COALESCE(policy.revision,0),'policy',policy.policy,'changed_at',policy.changed_at),
 'can_edit',public.product_return_policy_access(p_workspace_id,p_actor_id,p_product_id,true));
END $$;

CREATE FUNCTION public.write_product_return_policy(p_workspace_id uuid,p_actor_id uuid,p_product_id uuid,p_id uuid,p_expected_revision integer,p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.product_return_policies;prior public.product_return_policy_events;stamp timestamptz;next_revision integer;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_product_id IS NULL OR p_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 2147483646 THEN RAISE EXCEPTION 'invalid_product_return_policy';END IF;
 IF p_policy IS NOT NULL AND (jsonb_typeof(p_policy)<>'object'
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_policy) k) IS DISTINCT FROM ARRAY['conditions','mode','remedies','starts_at','window_days']::text[]
 OR p_policy->>'mode' IS NULL OR p_policy->>'mode' NOT IN ('allow','review','not_offered')
 OR p_policy->>'starts_at' IS NULL OR p_policy->>'starts_at' NOT IN ('purchase','delivery')
 OR jsonb_typeof(p_policy->'conditions') IS DISTINCT FROM 'string' OR length(p_policy->>'conditions')>1200
 OR NOT (p_policy->'window_days'='null'::jsonb OR (jsonb_typeof(p_policy->'window_days')='number' AND (p_policy->>'window_days') ~ '^[0-9]{1,3}$' AND (p_policy->>'window_days')::int BETWEEN 1 AND 365))
 OR jsonb_typeof(p_policy->'remedies') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'invalid_product_return_policy';END IF;
 IF p_policy IS NOT NULL AND (jsonb_array_length(p_policy->'remedies')>4
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_policy->'remedies') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN ('refund','replacement','exchange','store_credit'))
 OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(p_policy->'remedies') x)
 OR (p_policy->>'mode'='allow' AND jsonb_array_length(p_policy->'remedies')=0)
 OR (p_policy->>'mode'='not_offered' AND jsonb_array_length(p_policy->'remedies')<>0)) THEN RAISE EXCEPTION 'invalid_product_return_policy';END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 PERFORM 1 FROM public.shopify_products WHERE id=p_product_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR NOT public.product_return_policy_access(p_workspace_id,p_actor_id,p_product_id,true) THEN RAISE EXCEPTION 'product_return_policy_not_found';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 SELECT * INTO prior FROM public.product_return_policy_events WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.product_id IS DISTINCT FROM p_product_id OR prior.actor_id IS DISTINCT FROM p_actor_id
   OR prior.expected_revision IS DISTINCT FROM p_expected_revision OR prior.policy IS DISTINCT FROM p_policy THEN RAISE EXCEPTION 'product_return_policy_changed';END IF;
  RETURN jsonb_build_object('product_id',prior.product_id,'revision',prior.revision,'policy',prior.policy,'changed_at',prior.changed_at);
 END IF;
 SELECT * INTO old FROM public.product_return_policies WHERE product_id=p_product_id AND workspace_id=p_workspace_id;
 IF COALESCE(old.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'product_return_policy_changed';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'product_return_policy_read_only';END IF;
 stamp=clock_timestamp();next_revision=p_expected_revision+1;
 INSERT INTO public.product_return_policy_events(id,workspace_id,product_id,actor_id,expected_revision,revision,policy,changed_at)
 VALUES(p_id,p_workspace_id,p_product_id,p_actor_id,p_expected_revision,next_revision,p_policy,stamp);
 INSERT INTO public.product_return_policies(product_id,workspace_id,revision,policy,changed_at,changed_by) VALUES(p_product_id,p_workspace_id,next_revision,p_policy,stamp,p_actor_id)
 ON CONFLICT(product_id) DO UPDATE SET revision=EXCLUDED.revision,policy=EXCLUDED.policy,changed_at=EXCLUDED.changed_at,changed_by=EXCLUDED.changed_by;
 RETURN jsonb_build_object('product_id',p_product_id,'revision',next_revision,'policy',p_policy,'changed_at',stamp);
END $$;

CREATE FUNCTION public.read_agent_product_return_policies(p_workspace_id uuid,p_agent_id uuid,p_product_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE agent public.ai_agents;
BEGIN
 IF p_workspace_id IS NULL OR p_agent_id IS NULL OR p_product_ids IS NULL OR cardinality(p_product_ids)>80 OR array_position(p_product_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'invalid_product_return_policy';END IF;
 SELECT a.* INTO agent FROM public.ai_agents a JOIN public.workspaces w ON w.id=a.workspace_id WHERE a.id=p_agent_id AND a.workspace_id=p_workspace_id AND a.is_active=true AND w.deleted_at IS NULL;
 IF NOT FOUND OR agent.product_scope NOT IN ('all','specific') OR agent.product_scope IS NULL THEN RAISE EXCEPTION 'product_return_policy_not_found';END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_product_ids) requested(product_id) WHERE NOT EXISTS(SELECT 1 FROM public.shopify_products p WHERE p.id=requested.product_id AND p.workspace_id=p_workspace_id
 AND (agent.product_scope='all' OR EXISTS(SELECT 1 FROM public.ai_agent_products ap WHERE ap.product_id=p.id AND ap.agent_id=agent.id)))) THEN RAISE EXCEPTION 'product_return_policy_not_found';END IF;
 RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id',p.id,'revision',COALESCE(r.revision,0),'policy',r.policy,'changed_at',r.changed_at) ORDER BY p.id),'[]'::jsonb)
 FROM public.shopify_products p LEFT JOIN public.product_return_policies r ON r.product_id=p.id AND r.workspace_id=p.workspace_id WHERE p.workspace_id=p_workspace_id AND p.id=ANY(p_product_ids));
END $$;
REVOKE ALL ON FUNCTION public.product_return_policy_access(uuid,uuid,uuid,boolean),public.read_product_return_policy(uuid,uuid,uuid),public.write_product_return_policy(uuid,uuid,uuid,uuid,integer,jsonb),public.read_agent_product_return_policies(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.product_return_policy_access(uuid,uuid,uuid,boolean),public.read_product_return_policy(uuid,uuid,uuid),public.write_product_return_policy(uuid,uuid,uuid,uuid,integer,jsonb),public.read_agent_product_return_policies(uuid,uuid,uuid[]) TO service_role;

CREATE FUNCTION public.product_return_policy_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT count(*)=2 AND bool_and(relrowsecurity AND NOT has_table_privilege('anon',oid,'select,insert,update,delete') AND NOT has_table_privilege('authenticated',oid,'select,insert,update,delete') AND NOT has_table_privilege('service_role',oid,'select,insert,update,delete')) FROM pg_catalog.pg_class WHERE oid IN ('public.product_return_policies'::regclass,'public.product_return_policy_events'::regclass))
 AND (SELECT count(*)=4 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute')) FROM pg_catalog.pg_proc WHERE oid IN ('public.product_return_policy_access(uuid,uuid,uuid,boolean)'::regprocedure,'public.read_product_return_policy(uuid,uuid,uuid)'::regprocedure,'public.write_product_return_policy(uuid,uuid,uuid,uuid,integer,jsonb)'::regprocedure,'public.read_agent_product_return_policies(uuid,uuid,uuid[])'::regprocedure));
$$;
REVOKE ALL ON FUNCTION public.product_return_policy_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.product_return_policy_ready() TO service_role;

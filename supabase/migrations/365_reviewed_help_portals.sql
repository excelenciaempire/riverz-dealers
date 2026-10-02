-- Branded self-service from explicitly reviewed excerpts of current assistant sources.
CREATE TABLE public.help_portals(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 slug text NOT NULL UNIQUE CHECK(length(slug) BETWEEN 3 AND 64 AND slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 brand jsonb NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),published boolean NOT NULL DEFAULT false,
 actor_id uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,agent_id)
);
CREATE TABLE public.help_portal_articles(
 id uuid PRIMARY KEY,portal_id uuid NOT NULL REFERENCES public.help_portals(id) ON DELETE CASCADE,
 source_id uuid NOT NULL REFERENCES public.ai_document_sources(id) ON DELETE CASCADE,source_revision integer NOT NULL CHECK(source_revision>0),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 16000 AND octet_length(body)<=48000),
 locale text NOT NULL CHECK(locale IN ('es','en')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','withdrawn')),actor_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX help_portal_articles_scope ON public.help_portal_articles(portal_id,id);
ALTER TABLE public.help_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_portal_articles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.help_portals,public.help_portal_articles FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.help_portal_visits(
 portal_id uuid NOT NULL REFERENCES public.help_portals(id) ON DELETE CASCADE,
 article_id uuid NOT NULL REFERENCES public.help_portal_articles(id) ON DELETE CASCADE,revision integer NOT NULL,
 visit_id uuid NOT NULL,day date NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')::date,
 resolved boolean,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 days',
 PRIMARY KEY(portal_id,article_id,revision,visit_id,day)
);
CREATE INDEX help_portal_visit_expiry ON public.help_portal_visits(expires_at);
ALTER TABLE public.help_portal_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.help_portal_visits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.help_portal_guard(p_workspace_id uuid,p_actor_id uuid,p_write boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid;member public.workspace_members;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_write IS NULL THEN RAISE EXCEPTION 'portal_invalid';END IF;
 SELECT owner_id INTO owner FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_not_found';END IF;
 IF owner IS DISTINCT FROM p_actor_id THEN
  SELECT * INTO member FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
  IF NOT FOUND OR member.role IS DISTINCT FROM 'admin' OR(member.allowed_sections IS NOT NULL AND
   (jsonb_typeof(to_jsonb(member.allowed_sections)) IS DISTINCT FROM 'array' OR NOT(to_jsonb(member.allowed_sections) ? '/asistente')))
  THEN RAISE EXCEPTION 'portal_not_found';END IF;
 END IF;
 IF p_write THEN
  PERFORM 1 FROM public.workspace_subscriptions WHERE workspace_id=p_workspace_id FOR SHARE;
  PERFORM 1 FROM public.workspace_billing_invoices WHERE workspace_id=p_workspace_id FOR SHARE;
  IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'portal_read_only';END IF;
 END IF;
END $$;

CREATE FUNCTION public.read_help_portal(p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE portal public.help_portals;articles jsonb;
BEGIN
 PERFORM public.help_portal_guard(p_workspace_id,p_actor_id,false);
 PERFORM 1 FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_not_found';END IF;
 SELECT * INTO portal FROM public.help_portals WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(a)-'actor_id' ORDER BY a.updated_at DESC,a.id),'[]'::jsonb) INTO articles
 FROM public.help_portal_articles a WHERE a.portal_id=portal.id;
 RETURN (to_jsonb(portal)-'actor_id'-'updated_at')||jsonb_build_object('articles',articles);
END $$;

CREATE FUNCTION public.manage_help_portal(p_workspace_id uuid,p_actor_id uuid,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE portal public.help_portals;article public.help_portal_articles;source public.ai_document_sources;
 target uuid;agent uuid;keys integer;expected integer;body_text text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('configure','save','publish','withdraw') OR p_input IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'portal_invalid';END IF;
 PERFORM public.help_portal_guard(p_workspace_id,p_actor_id,true);
 -- Serialize each business before assistant/source/version checks and all writes.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('help-portal:'||p_workspace_id::text,0));
 SELECT count(*) INTO keys FROM jsonb_object_keys(p_input);
 IF p_action='configure' THEN
  IF keys<>6 OR NOT(p_input ?& ARRAY['id','agentId','slug','brand','revision','published']) THEN RAISE EXCEPTION 'portal_invalid';END IF;
  target=(p_input->>'id')::uuid;agent=(p_input->>'agentId')::uuid;
 ELSE
  target=(p_input->>'portalId')::uuid;
  SELECT agent_id INTO agent FROM public.help_portals WHERE id=target AND workspace_id=p_workspace_id;
 END IF;
 IF target IS NULL OR agent IS NULL THEN RAISE EXCEPTION 'portal_not_found';END IF;
 PERFORM 1 FROM public.ai_agents WHERE id=agent AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_not_found';END IF;
 SELECT * INTO portal FROM public.help_portals WHERE id=target FOR UPDATE;
 IF FOUND AND(portal.workspace_id IS DISTINCT FROM p_workspace_id OR portal.agent_id IS DISTINCT FROM agent) THEN RAISE EXCEPTION 'portal_not_found';END IF;
 IF jsonb_typeof(p_input->'revision') IS DISTINCT FROM 'number' OR p_input->>'revision' !~ '^(0|[1-9][0-9]*)$'
 THEN RAISE EXCEPTION 'portal_invalid';END IF;
 expected=(p_input->>'revision')::integer;
 IF p_action='configure' THEN
  IF jsonb_typeof(p_input->'slug') IS DISTINCT FROM 'string' OR length(p_input->>'slug') NOT BETWEEN 3 AND 64 OR p_input->>'slug' !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
   OR jsonb_typeof(p_input->'brand') IS DISTINCT FROM 'object' OR NOT(p_input->'brand' ?& ARRAY['name','description','accent'])
   OR (SELECT count(*) FROM jsonb_object_keys(p_input->'brand'))<>3
   OR jsonb_typeof(p_input->'brand'->'name') IS DISTINCT FROM 'string' OR length(btrim(p_input->'brand'->>'name')) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(p_input->'brand'->'description') IS DISTINCT FROM 'string' OR length(p_input->'brand'->>'description')>300
   OR jsonb_typeof(p_input->'brand'->'accent') IS DISTINCT FROM 'string' OR p_input->'brand'->>'accent' !~ '^#[a-fA-F0-9]{6}$'
   OR jsonb_typeof(p_input->'published') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'portal_invalid';END IF;
  IF portal.id IS NULL THEN
   IF expected<>0 THEN RAISE EXCEPTION 'portal_changed';END IF;
   INSERT INTO public.help_portals(id,workspace_id,agent_id,slug,brand,published,actor_id)
    VALUES(target,p_workspace_id,agent,p_input->>'slug',p_input->'brand',(p_input->>'published')::boolean,p_actor_id) RETURNING * INTO portal;
  ELSE
   IF expected<>portal.revision THEN RAISE EXCEPTION 'portal_changed';END IF;
   UPDATE public.help_portals SET slug=p_input->>'slug',brand=p_input->'brand',published=(p_input->>'published')::boolean,
    revision=revision+1,actor_id=p_actor_id,updated_at=clock_timestamp() WHERE id=target RETURNING * INTO portal;
  END IF;
 ELSE
  IF portal.id IS NULL OR p_input->>'id' IS NULL THEN RAISE EXCEPTION 'portal_not_found';END IF;
  SELECT * INTO article FROM public.help_portal_articles WHERE id=(p_input->>'id')::uuid FOR UPDATE;
  IF FOUND AND article.portal_id IS DISTINCT FROM portal.id THEN RAISE EXCEPTION 'portal_not_found';END IF;
  IF p_action='save' THEN
   IF keys<>8 OR NOT(p_input ?& ARRAY['id','portalId','sourceId','sourceRevision','title','body','locale','revision']) THEN RAISE EXCEPTION 'portal_invalid';END IF;
  ELSE
   IF keys<>(CASE WHEN p_action='publish' THEN 5 ELSE 4 END) OR NOT(p_input ?& ARRAY['id','portalId','revision','action'])
    OR p_input->>'action' IS DISTINCT FROM p_action OR(p_action='publish' AND p_input->'reviewed' IS DISTINCT FROM 'true'::jsonb)
   THEN RAISE EXCEPTION 'portal_invalid';END IF;
  END IF;
  IF p_action='save' THEN
   IF jsonb_typeof(p_input->'sourceRevision') IS DISTINCT FROM 'number' OR p_input->>'sourceRevision' !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(p_input->'title') IS DISTINCT FROM 'string' OR length(btrim(p_input->>'title')) NOT BETWEEN 1 AND 160
    OR jsonb_typeof(p_input->'body') IS DISTINCT FROM 'string' OR length(btrim(p_input->>'body')) NOT BETWEEN 1 AND 16000 OR octet_length(p_input->>'body')>48000
    OR jsonb_typeof(p_input->'locale') IS DISTINCT FROM 'string' OR p_input->>'locale' NOT IN ('es','en') THEN RAISE EXCEPTION 'portal_invalid';END IF;
   SELECT * INTO source FROM public.ai_document_sources WHERE id=(p_input->>'sourceId')::uuid AND workspace_id=p_workspace_id AND agent_id=agent FOR SHARE;
   body_text=btrim(p_input->>'body');
   IF NOT FOUND OR source.status<>'active' OR source.revision<>(p_input->>'sourceRevision')::integer OR strpos(source.text,body_text)=0 THEN RAISE EXCEPTION 'portal_source_changed';END IF;
   IF (SELECT COALESCE(sum(octet_length(body)),0) FROM public.help_portal_articles WHERE portal_id=portal.id AND id<>(p_input->>'id')::uuid)+octet_length(body_text)>48000
   THEN RAISE EXCEPTION 'portal_limit';END IF;
   IF article.id IS NULL THEN
    IF expected<>0 THEN RAISE EXCEPTION 'portal_changed';END IF;
    IF (SELECT count(*) FROM public.help_portal_articles WHERE portal_id=portal.id)>=30 THEN RAISE EXCEPTION 'portal_limit';END IF;
    INSERT INTO public.help_portal_articles(id,portal_id,source_id,source_revision,title,body,locale,actor_id)
    VALUES((p_input->>'id')::uuid,portal.id,source.id,source.revision,btrim(p_input->>'title'),body_text,p_input->>'locale',p_actor_id);
   ELSE
    IF expected<>article.revision THEN RAISE EXCEPTION 'portal_changed';END IF;
    UPDATE public.help_portal_articles SET source_id=source.id,source_revision=source.revision,title=btrim(p_input->>'title'),body=body_text,locale=p_input->>'locale',
     status='draft',revision=revision+1,actor_id=p_actor_id,updated_at=clock_timestamp() WHERE id=article.id;
   END IF;
  ELSE
   IF article.id IS NULL THEN RAISE EXCEPTION 'portal_not_found';END IF;
   IF expected<>article.revision THEN RAISE EXCEPTION 'portal_changed';END IF;
   IF p_action='publish' THEN
    SELECT * INTO source FROM public.ai_document_sources WHERE id=article.source_id AND workspace_id=p_workspace_id AND agent_id=agent FOR SHARE;
    IF NOT FOUND OR source.status<>'active' OR source.revision<>article.source_revision OR strpos(source.text,article.body)=0 THEN RAISE EXCEPTION 'portal_source_changed';END IF;
   END IF;
   UPDATE public.help_portal_articles SET status=CASE WHEN p_action='publish' THEN 'published' ELSE 'withdrawn' END,
    revision=revision+1,actor_id=p_actor_id,updated_at=clock_timestamp() WHERE id=article.id;
  END IF;
 END IF;
 RETURN public.read_help_portal(p_workspace_id,p_actor_id,agent);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RAISE EXCEPTION 'portal_invalid';
 WHEN unique_violation THEN RAISE EXCEPTION 'portal_changed';
END $$;

CREATE FUNCTION public.public_help_portal(p_slug text,p_locale text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('slug',p.slug,'brand',p.brand,'locale',p_locale,'articles',COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'revision',a.revision,'updated_at',a.updated_at) ORDER BY a.title,a.id)
  FROM public.help_portal_articles a JOIN public.ai_document_sources s ON s.id=a.source_id AND s.workspace_id=p.workspace_id AND s.agent_id=p.agent_id
  WHERE a.portal_id=p.id AND a.status='published' AND a.locale=p_locale AND s.status='active' AND s.revision=a.source_revision AND strpos(s.text,a.body)>0
 ),'[]'::jsonb)) FROM public.help_portals p JOIN public.workspaces w ON w.id=p.workspace_id AND w.deleted_at IS NULL
 JOIN public.ai_agents agent ON agent.id=p.agent_id AND agent.workspace_id=p.workspace_id AND agent.deleted_at IS NULL
 WHERE p.slug=p_slug AND p.published AND p_locale IN ('es','en');
$$;
REVOKE ALL ON FUNCTION public.help_portal_guard(uuid,uuid,boolean),public.read_help_portal(uuid,uuid,uuid),public.manage_help_portal(uuid,uuid,text,jsonb),public.public_help_portal(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_help_portal(uuid,uuid,uuid),public.manage_help_portal(uuid,uuid,text,jsonb),public.public_help_portal(text,text) TO service_role;

CREATE FUNCTION public.record_help_portal_visit(p_slug text,p_locale text,p_article_id uuid,p_revision integer,p_visit_id uuid,p_resolved boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE portal uuid;today date=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_slug IS NULL OR length(p_slug) NOT BETWEEN 3 AND 64 OR p_slug !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' OR p_locale IS NULL OR p_locale NOT IN ('es','en')
 OR p_article_id IS NULL OR p_revision IS NULL OR p_revision<1 OR p_visit_id IS NULL THEN RAISE EXCEPTION 'portal_invalid';END IF;
 SELECT p.id INTO portal FROM public.help_portals p JOIN public.workspaces w ON w.id=p.workspace_id AND w.deleted_at IS NULL
 JOIN public.ai_agents agent ON agent.id=p.agent_id AND agent.workspace_id=p.workspace_id AND agent.deleted_at IS NULL
 JOIN public.help_portal_articles a ON a.portal_id=p.id AND a.id=p_article_id AND a.locale=p_locale AND a.revision=p_revision AND a.status='published'
 JOIN public.ai_document_sources s ON s.id=a.source_id AND s.workspace_id=p.workspace_id AND s.agent_id=p.agent_id AND s.revision=a.source_revision AND s.status='active' AND strpos(s.text,a.body)>0
 WHERE p.slug=p_slug AND p.published;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_not_found';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('help-visit:'||portal::text,0));
 -- Prevent unbounded anonymous storage; these are reported article reads, not verified unique people or tickets avoided.
 IF NOT EXISTS(SELECT 1 FROM public.help_portal_visits WHERE portal_id=portal AND article_id=p_article_id AND revision=p_revision AND visit_id=p_visit_id AND day=today)
 AND(SELECT count(*) FROM public.help_portal_visits WHERE portal_id=portal AND day=today)>=5000 THEN RAISE EXCEPTION 'portal_limit';END IF;
 INSERT INTO public.help_portal_visits(portal_id,article_id,revision,visit_id,day,resolved) VALUES(portal,p_article_id,p_revision,p_visit_id,today,p_resolved)
 ON CONFLICT(portal_id,article_id,revision,visit_id,day) DO UPDATE SET resolved=COALESCE(public.help_portal_visits.resolved,EXCLUDED.resolved);
 RETURN true;
END $$;
CREATE FUNCTION public.help_portal_statistics(p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE portal jsonb;result jsonb;
BEGIN
 portal=public.read_help_portal(p_workspace_id,p_actor_id,p_agent_id);
 IF portal IS NULL THEN RAISE EXCEPTION 'portal_not_found';END IF;
 SELECT jsonb_build_object('views',count(*),'responded',count(*) FILTER(WHERE resolved IS NOT NULL),'resolved',count(*) FILTER(WHERE resolved=true),
 'needsHelp',count(*) FILTER(WHERE resolved=false),'windowDays',30,'observedAt',clock_timestamp()) INTO result FROM public.help_portal_visits
 WHERE portal_id=(portal->>'id')::uuid AND expires_at>clock_timestamp();RETURN result;
END $$;
CREATE FUNCTION public.purge_help_portal_visits() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 DELETE FROM public.help_portal_visits WHERE (portal_id,article_id,revision,visit_id,day) IN
 (SELECT portal_id,article_id,revision,visit_id,day FROM public.help_portal_visits WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 10000);
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
CREATE FUNCTION public.help_portal_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT to_regclass('public.help_portal_articles') IS NOT NULL AND to_regclass('public.help_portal_visits') IS NOT NULL
 AND NOT has_table_privilege('anon','public.help_portals','SELECT') AND NOT has_table_privilege('authenticated','public.help_portal_articles','SELECT')
 AND NOT has_table_privilege('service_role','public.help_portal_visits','SELECT')
 AND NOT has_function_privilege('anon','public.public_help_portal(text,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.manage_help_portal(uuid,uuid,text,jsonb)','EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.record_help_portal_visit(text,text,uuid,integer,uuid,boolean),public.help_portal_statistics(uuid,uuid,uuid),public.purge_help_portal_visits(),public.help_portal_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_help_portal_visit(text,text,uuid,integer,uuid,boolean),public.help_portal_statistics(uuid,uuid,uuid),public.purge_help_portal_visits(),public.help_portal_ready() TO service_role;

CREATE FUNCTION public.widget_help_portal(p_workspace_id uuid,p_agent_id uuid,p_locale text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.public_help_portal(p.slug,p_locale) FROM public.help_portals p
 WHERE p.workspace_id=p_workspace_id AND p.agent_id=p_agent_id;
$$;
CREATE FUNCTION public.widget_help_orders(p_workspace_id uuid,p_visitor_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.observed_at DESC,row.id),'[]'::jsonb) FROM(
 SELECT o.id,o.order_number AS reference,
 CASE WHEN o.status IN ('created','paid','fulfilled','refunded','cancelled','failed') THEN o.status ELSE 'unknown' END AS status,o.updated_at AS observed_at
 FROM public.orders o JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id AND c.channel='webchat' AND c.external_id=p_visitor_id
 JOIN public.workspaces w ON w.id=o.workspace_id AND w.deleted_at IS NULL
 WHERE o.workspace_id=p_workspace_id AND o.order_number IS NOT NULL
 ORDER BY o.updated_at DESC,o.id LIMIT 20
 ) row;
$$;
REVOKE ALL ON FUNCTION public.widget_help_portal(uuid,uuid,text),public.widget_help_orders(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_help_portal(uuid,uuid,text),public.widget_help_orders(uuid,text) TO service_role;

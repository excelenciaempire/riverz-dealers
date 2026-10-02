-- Counterfactual contact avoidance is visitor-reported, not inferred from views or resolution.
ALTER TABLE public.help_portal_visits ADD COLUMN avoided_contact boolean;
ALTER TABLE public.help_portal_visits ADD CONSTRAINT help_portal_avoidance_requires_resolution CHECK(avoided_contact IS NULL OR resolved=true);
CREATE FUNCTION public.record_help_portal_visit(p_slug text,p_locale text,p_article_id uuid,p_revision integer,p_visit_id uuid,p_resolved boolean,p_avoided_contact boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE portal uuid;today date=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_avoided_contact IS NOT NULL AND p_resolved IS DISTINCT FROM true THEN RAISE EXCEPTION 'portal_invalid';END IF;
 PERFORM public.record_help_portal_visit(p_slug,p_locale,p_article_id,p_revision,p_visit_id,p_resolved);
 IF p_avoided_contact IS NOT NULL THEN
  SELECT id INTO portal FROM public.help_portals WHERE slug=p_slug;
  UPDATE public.help_portal_visits SET avoided_contact=COALESCE(avoided_contact,p_avoided_contact)
  WHERE portal_id=portal AND article_id=p_article_id AND revision=p_revision AND visit_id=p_visit_id AND day=today AND resolved=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal_changed';END IF;
 END IF;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.help_portal_statistics(p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE portal jsonb;result jsonb;
BEGIN
 portal=public.read_help_portal(p_workspace_id,p_actor_id,p_agent_id);
 IF portal IS NULL THEN RAISE EXCEPTION 'portal_not_found';END IF;
 SELECT jsonb_build_object('views',count(*),'responded',count(*) FILTER(WHERE resolved IS NOT NULL),'resolved',count(*) FILTER(WHERE resolved=true),
 'needsHelp',count(*) FILTER(WHERE resolved=false),'avoidanceResponded',count(*) FILTER(WHERE avoided_contact IS NOT NULL),
 'reportedAvoided',count(*) FILTER(WHERE avoided_contact=true),'windowDays',30,'observedAt',clock_timestamp()) INTO result FROM public.help_portal_visits
 WHERE portal_id=(portal->>'id')::uuid AND expires_at>clock_timestamp();RETURN result;
END $$;
CREATE FUNCTION public.help_portal_avoidance_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.help_portal_ready() AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.help_portal_visits'::regclass AND attname='avoided_contact' AND NOT attisdropped)
 AND NOT has_function_privilege('anon','public.record_help_portal_visit(text,text,uuid,integer,uuid,boolean,boolean)','execute')
 AND NOT has_function_privilege('authenticated','public.record_help_portal_visit(text,text,uuid,integer,uuid,boolean,boolean)','execute');
$$;
REVOKE ALL ON FUNCTION public.record_help_portal_visit(text,text,uuid,integer,uuid,boolean,boolean),public.help_portal_avoidance_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_help_portal_visit(text,text,uuid,integer,uuid,boolean,boolean),public.help_portal_avoidance_ready() TO service_role;

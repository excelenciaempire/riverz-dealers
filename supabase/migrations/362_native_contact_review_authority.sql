-- Preparing an import review must lock the live native source job in the same
-- transaction. Cancelling or expiring a source cannot race a later copied review.
CREATE FUNCTION public.prepare_native_contact_review(p_workspace_id uuid,p_actor_id uuid,p_job_id uuid,p_id uuid,p_input_hash text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;
BEGIN
 IF p_job_id IS NULL OR p_id IS NULL OR p_job_id=p_id OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 SELECT * INTO job FROM public.native_contact_migration_jobs WHERE id=p_job_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_contact_migration_not_found';END IF;
 IF job.state<>'ready' OR job.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'native_contact_migration_changed';END IF;
 IF jsonb_array_length(p_rows)<>job.total OR
  (SELECT jsonb_agg(value->>'sourceId' ORDER BY ordinality) FROM jsonb_array_elements(p_rows) WITH ORDINALITY) IS DISTINCT FROM
  (SELECT jsonb_agg(value->>'sourceId' ORDER BY ordinality) FROM jsonb_array_elements(job.payload) WITH ORDINALITY)
 THEN RAISE EXCEPTION 'native_contact_migration_changed';END IF;
 RETURN public.prepare_contact_migration(p_workspace_id,p_actor_id,p_id,job.source->>'provider',(job.source->>'origin')||'#'||(job.source->>'accountId'),p_input_hash,p_rows);
END $$;
REVOKE ALL ON FUNCTION public.prepare_native_contact_review(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_native_contact_review(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
CREATE FUNCTION public.native_contact_review_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.native_contact_migration_ready() AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.prepare_native_contact_review(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure
 AND prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND has_function_privilege('service_role',oid,'EXECUTE'));
$$;
REVOKE ALL ON FUNCTION public.native_contact_review_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.native_contact_review_ready() TO service_role;

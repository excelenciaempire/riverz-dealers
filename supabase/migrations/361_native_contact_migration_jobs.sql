-- Private, bounded native X2 contact collection. Reviewed before installation.
-- No provider requests, contacts, messages, AI or business mutations in SQL.
CREATE TABLE public.native_contact_migration_jobs(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source jsonb NOT NULL,input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[0-9a-f]{64}$'),credential_ciphertext text,
 state text NOT NULL CHECK(state IN ('queued','fetching','ready','empty','failed','expired','cancelled')),
 page integer NOT NULL DEFAULT 1 CHECK(page BETWEEN 1 AND 335),total integer CHECK(total BETWEEN 0 AND 5000),collected integer NOT NULL DEFAULT 0 CHECK(collected BETWEEN 0 AND 5000),
 payload jsonb,lease_id uuid,lease_until timestamptz,error_code text,retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 hours',updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(collected<=COALESCE(total,5000)),
 CHECK((state='fetching' AND lease_id IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'fetching' AND lease_id IS NULL AND lease_until IS NULL)),
 CHECK((state IN ('queued','fetching') AND credential_ciphertext IS NOT NULL AND payload IS NOT NULL)
  OR(state='ready' AND total IS NOT NULL AND total>0 AND collected=total AND credential_ciphertext IS NULL AND payload IS NOT NULL)
  OR(state='empty' AND total IS NOT NULL AND total=0 AND collected=0 AND credential_ciphertext IS NULL AND payload IS NULL)
  OR(state IN ('failed','expired','cancelled') AND credential_ciphertext IS NULL AND payload IS NULL))
);
ALTER TABLE public.native_contact_migration_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.native_contact_migration_jobs FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX native_contact_migration_queue ON public.native_contact_migration_jobs(available_at,updated_at,id) WHERE state IN ('queued','fetching');
CREATE INDEX native_contact_migration_actor ON public.native_contact_migration_jobs(workspace_id,actor_id,created_at DESC,id DESC);

CREATE FUNCTION public.read_native_contact_migration(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_after integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;rows jsonb='[]'::jsonb;last_row integer;next_row integer;
BEGIN
 IF p_id IS NULL OR p_after IS NULL OR p_after NOT BETWEEN 0 AND 5000 THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 SELECT * INTO job FROM public.native_contact_migration_jobs WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_contact_migration_not_found';END IF;
 IF job.state IN ('queued','fetching','ready') AND job.expires_at<=clock_timestamp() THEN
  UPDATE public.native_contact_migration_jobs SET state='expired',payload=NULL,credential_ciphertext=NULL,lease_id=NULL,lease_until=NULL,error_code='source_expired',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO job;
 END IF;
 IF job.state='ready' THEN
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb),max(ordinality::integer) INTO rows,last_row
  FROM(SELECT value,ordinality FROM jsonb_array_elements(job.payload) WITH ORDINALITY WHERE ordinality>p_after ORDER BY ordinality LIMIT 25) page;
  IF last_row<job.collected THEN next_row=last_row;END IF;
 END IF;
 RETURN jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'source',job.source,'state',job.state,'total',job.total,'collected',job.collected,
  'created_at',job.created_at,'expires_at',job.expires_at,'updated_at',job.updated_at,'error',job.error_code,'rows',rows,'next',next_row);
END $$;

CREATE FUNCTION public.create_native_contact_migration(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_source jsonb,p_fingerprint text,p_ciphertext text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;
BEGIN
 IF p_id IS NULL OR p_source IS NULL OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
  OR p_ciphertext IS NULL OR length(p_ciphertext)>20000 OR p_ciphertext !~ '^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$' THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_source))<>3 OR NOT(p_source ?& ARRAY['provider','origin','accountId']) OR p_source->>'provider' IS DISTINCT FROM 'chatwoot'
  OR jsonb_typeof(p_source->'origin') IS DISTINCT FROM 'string' OR length(p_source->>'origin')>120 OR p_source->>'origin' !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$'
  OR jsonb_typeof(p_source->'accountId') IS DISTINCT FROM 'number' OR p_source->>'accountId' !~ '^[1-9][0-9]{0,15}$'
 THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 IF (p_source->>'accountId')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('native-contact-job:'||p_id::text,0));
 SELECT * INTO job FROM public.native_contact_migration_jobs WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF job.workspace_id IS DISTINCT FROM p_workspace_id OR job.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'native_contact_migration_not_found';END IF;
  IF job.source IS DISTINCT FROM p_source OR job.input_fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'native_contact_migration_changed';END IF;
  RETURN public.read_native_contact_migration(p_workspace_id,p_actor_id,p_id,0);
 END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('native-contact-workspace:'||p_workspace_id::text,0));
 IF (SELECT count(*) FROM public.native_contact_migration_jobs WHERE workspace_id=p_workspace_id AND state IN ('queued','fetching') AND expires_at>clock_timestamp())>=3 THEN RAISE EXCEPTION 'native_contact_migration_limit';END IF;
 IF (SELECT count(*) FROM public.native_contact_migration_jobs WHERE workspace_id=p_workspace_id AND state IN ('queued','fetching','ready') AND expires_at>clock_timestamp())>=10 THEN RAISE EXCEPTION 'native_contact_migration_limit';END IF;
 INSERT INTO public.native_contact_migration_jobs(id,workspace_id,actor_id,source,input_fingerprint,credential_ciphertext,state,payload)
 VALUES(p_id,p_workspace_id,p_actor_id,p_source,p_fingerprint,p_ciphertext,'queued','[]'::jsonb);
 RETURN public.read_native_contact_migration(p_workspace_id,p_actor_id,p_id,0);
END $$;

CREATE FUNCTION public.claim_native_contact_migrations(p_limit integer DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;lease uuid;claimed jsonb='[]'::jsonb;failure text;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 FOR job IN SELECT * FROM public.native_contact_migration_jobs WHERE (state='queued' OR state='fetching' AND lease_until<=clock_timestamp())
  AND available_at<=clock_timestamp() ORDER BY updated_at,id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  IF job.expires_at<=clock_timestamp() THEN
   UPDATE public.native_contact_migration_jobs SET state='expired',credential_ciphertext=NULL,payload=NULL,lease_id=NULL,lease_until=NULL,error_code='source_expired',updated_at=clock_timestamp() WHERE id=job.id;CONTINUE;
  END IF;
  BEGIN
   PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,true);
  EXCEPTION WHEN raise_exception THEN
   failure=SQLERRM;
   IF failure NOT IN ('contact_migration_not_found','contact_migration_read_only') THEN RAISE;END IF;
   UPDATE public.native_contact_migration_jobs SET state='cancelled',credential_ciphertext=NULL,payload=NULL,lease_id=NULL,lease_until=NULL,error_code=CASE WHEN failure='contact_migration_read_only' THEN 'source_read_only' ELSE 'source_access_revoked' END,updated_at=clock_timestamp() WHERE id=job.id;CONTINUE;
  END;
  lease=gen_random_uuid();
  UPDATE public.native_contact_migration_jobs SET state='fetching',lease_id=lease,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE id=job.id;
  claimed=claimed||jsonb_build_array(jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'source',job.source,'credential_ciphertext',job.credential_ciphertext,
   'lease_id',lease,'page',job.page,'total',job.total,'collected',job.collected,'expires_at',job.expires_at));
  IF jsonb_array_length(claimed)>=p_limit THEN EXIT;END IF;
 END LOOP;
 RETURN claimed;
END $$;

CREATE FUNCTION public.record_native_contact_page(p_id uuid,p_lease_id uuid,p_page integer,p_total integer,p_rows jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;item jsonb;combined jsonb;count_rows integer;
BEGIN
 IF p_id IS NULL OR p_lease_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 334 OR p_total IS NULL OR p_total NOT BETWEEN 0 AND 5000
  OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 IF jsonb_array_length(p_rows)>15 THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 SELECT * INTO job FROM public.native_contact_migration_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_contact_migration_not_found';END IF;
 IF job.state IS DISTINCT FROM 'fetching' OR job.lease_id IS DISTINCT FROM p_lease_id OR job.lease_until<=clock_timestamp() OR job.expires_at<=clock_timestamp() THEN RETURN false;END IF;
 PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,true);
 IF job.page<>p_page OR job.total IS NOT NULL AND job.total<>p_total OR (p_page-1)*15<>job.collected
  OR jsonb_array_length(p_rows)<>LEAST(15,GREATEST(0,p_total-job.collected)) OR p_page>GREATEST(1,ceil(p_total/15.0)) THEN RAISE EXCEPTION 'native_contact_migration_changed';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>5 OR NOT(item ?& ARRAY['sourceId','phone','name','email','company'])
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['sourceId','phone','name','email','company']) field WHERE jsonb_typeof(item->field) IS DISTINCT FROM 'string' OR length(item->>field)>4096)
   OR item->>'sourceId' !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
  IF (item->>'sourceId')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 END LOOP;
 combined=job.payload||p_rows;count_rows=jsonb_array_length(combined);
 IF octet_length(combined::text)>8388608 THEN RAISE EXCEPTION 'native_contact_migration_limit';END IF;
 IF (SELECT count(DISTINCT value->>'sourceId') FROM jsonb_array_elements(combined))<>count_rows THEN RAISE EXCEPTION 'native_contact_migration_changed';END IF;
 UPDATE public.native_contact_migration_jobs SET total=p_total,collected=count_rows,page=p_page+1,
  state=CASE WHEN p_total=0 THEN 'empty' WHEN count_rows=p_total THEN 'ready' ELSE 'queued' END,
  payload=CASE WHEN p_total=0 THEN NULL ELSE combined END,credential_ciphertext=CASE WHEN count_rows=p_total THEN NULL ELSE credential_ciphertext END,
  lease_id=NULL,lease_until=NULL,retry_count=0,error_code=NULL,available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;
 RETURN true;
END $$;

CREATE FUNCTION public.authorize_native_contact_page(p_id uuid,p_lease_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;
BEGIN
 IF p_id IS NULL OR p_lease_id IS NULL THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 SELECT * INTO job FROM public.native_contact_migration_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.state<>'fetching' OR job.lease_id IS DISTINCT FROM p_lease_id OR job.lease_until<=clock_timestamp() OR job.expires_at<=clock_timestamp() THEN RETURN false;END IF;
 PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,true);RETURN true;
END $$;

CREATE FUNCTION public.cancel_native_contact_migration(p_workspace_id uuid,p_actor_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_id IS NULL THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 PERFORM 1 FROM public.native_contact_migration_jobs WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_contact_migration_not_found';END IF;
 UPDATE public.native_contact_migration_jobs SET state='cancelled',payload=NULL,credential_ciphertext=NULL,lease_id=NULL,lease_until=NULL,error_code=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND state IN ('queued','fetching','ready');
 RETURN public.read_native_contact_migration(p_workspace_id,p_actor_id,p_id,0);
END $$;

CREATE FUNCTION public.purge_native_contact_migrations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;removed integer;
BEGIN
 WITH candidates AS(SELECT j.id FROM public.native_contact_migration_jobs j JOIN public.workspaces w ON w.id=j.workspace_id WHERE j.state IN ('queued','fetching','ready') AND (j.expires_at<=clock_timestamp() OR w.deleted_at IS NOT NULL) ORDER BY j.expires_at,j.id LIMIT 500 FOR UPDATE OF j SKIP LOCKED),
 cleared AS(UPDATE public.native_contact_migration_jobs j SET state='expired',payload=NULL,credential_ciphertext=NULL,lease_id=NULL,lease_until=NULL,error_code='source_expired',updated_at=clock_timestamp()
 FROM candidates c WHERE j.id=c.id RETURNING j.id) SELECT count(*) INTO changed FROM cleared;
 WITH candidates AS(SELECT id FROM public.native_contact_migration_jobs WHERE state IN ('empty','failed','expired','cancelled') AND updated_at<clock_timestamp()-interval '30 days' ORDER BY updated_at,id LIMIT 500 FOR UPDATE SKIP LOCKED),
 deleted AS(DELETE FROM public.native_contact_migration_jobs j USING candidates c WHERE j.id=c.id RETURNING j.id) SELECT count(*) INTO removed FROM deleted;
 RETURN changed+removed;
END $$;

REVOKE ALL ON FUNCTION public.authorize_native_contact_page(uuid,uuid),public.cancel_native_contact_migration(uuid,uuid,uuid),public.purge_native_contact_migrations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_native_contact_page(uuid,uuid),public.cancel_native_contact_migration(uuid,uuid,uuid),public.purge_native_contact_migrations() TO service_role;

CREATE FUNCTION public.fail_native_contact_migration(p_id uuid,p_lease_id uuid,p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;retry boolean;
BEGIN
 IF p_id IS NULL OR p_lease_id IS NULL OR p_code IS NULL OR p_code NOT IN ('source_invalid','source_changed','source_limit','source_order_unsupported','source_auth','source_rate_limit','source_timeout','source_unavailable','source_credential_unavailable','source_access_revoked','source_read_only') THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 SELECT * INTO job FROM public.native_contact_migration_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.state<>'fetching' OR job.lease_id IS DISTINCT FROM p_lease_id OR job.lease_until<=clock_timestamp() THEN RETURN false;END IF;
 retry=p_code IN ('source_rate_limit','source_timeout','source_unavailable') AND job.retry_count<3 AND job.expires_at>clock_timestamp();
 UPDATE public.native_contact_migration_jobs SET state=CASE WHEN retry THEN 'queued' ELSE 'failed' END,
  payload=CASE WHEN retry THEN payload END,credential_ciphertext=CASE WHEN retry THEN credential_ciphertext END,lease_id=NULL,lease_until=NULL,error_code=p_code,
  retry_count=LEAST(3,retry_count+1),available_at=clock_timestamp()+(interval '1 minute' * power(2,job.retry_count)),updated_at=clock_timestamp() WHERE id=p_id;
 RETURN true;
END $$;

CREATE FUNCTION public.read_native_contact_payload(p_workspace_id uuid,p_actor_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_contact_migration_jobs;
BEGIN
 IF p_id IS NULL THEN RAISE EXCEPTION 'invalid_native_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 SELECT * INTO job FROM public.native_contact_migration_jobs WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_contact_migration_not_found';END IF;
 IF job.state IS DISTINCT FROM 'ready' OR job.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'native_contact_migration_changed';END IF;
 RETURN jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'source',job.source,'total',job.total,'rows',job.payload);
END $$;

REVOKE ALL ON FUNCTION public.read_native_contact_migration(uuid,uuid,uuid,integer),public.create_native_contact_migration(uuid,uuid,uuid,jsonb,text,text),
 public.claim_native_contact_migrations(integer),public.record_native_contact_page(uuid,uuid,integer,integer,jsonb),public.fail_native_contact_migration(uuid,uuid,text),
 public.read_native_contact_payload(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_native_contact_migration(uuid,uuid,uuid,integer),public.create_native_contact_migration(uuid,uuid,uuid,jsonb,text,text),
 public.claim_native_contact_migrations(integer),public.record_native_contact_page(uuid,uuid,integer,integer,jsonb),public.fail_native_contact_migration(uuid,uuid,text),
 public.read_native_contact_payload(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.native_contact_migration_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.contact_migration_ready()
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.native_contact_migration_jobs'::regclass AND relrowsecurity)
 AND NOT has_table_privilege('anon','public.native_contact_migration_jobs','SELECT')
 AND NOT has_table_privilege('authenticated','public.native_contact_migration_jobs','SELECT')
 AND NOT has_table_privilege('service_role','public.native_contact_migration_jobs','SELECT')
 AND NOT has_table_privilege('service_role','public.native_contact_migration_jobs','INSERT')
 AND (SELECT count(*)=9 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND
  NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE'))
  FROM pg_catalog.pg_proc p WHERE p.oid=ANY(ARRAY[
  'public.read_native_contact_migration(uuid,uuid,uuid,integer)'::regprocedure,'public.create_native_contact_migration(uuid,uuid,uuid,jsonb,text,text)'::regprocedure,
  'public.claim_native_contact_migrations(integer)'::regprocedure,'public.record_native_contact_page(uuid,uuid,integer,integer,jsonb)'::regprocedure,
  'public.fail_native_contact_migration(uuid,uuid,text)'::regprocedure,'public.read_native_contact_payload(uuid,uuid,uuid)'::regprocedure,
  'public.authorize_native_contact_page(uuid,uuid)'::regprocedure,'public.cancel_native_contact_migration(uuid,uuid,uuid)'::regprocedure,'public.purge_native_contact_migrations()'::regprocedure]));
$$;
REVOKE ALL ON FUNCTION public.native_contact_migration_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.native_contact_migration_ready() TO service_role;

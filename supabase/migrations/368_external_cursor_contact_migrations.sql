-- X2 Gorgias and Zendesk cursor-based contact collection. Migration 367 is immutable.
-- Extends the independent private queue; no provider IO or customer mutations.
ALTER TABLE public.external_contact_migration_jobs ADD COLUMN source_cursor text,
 ADD COLUMN cursor_hashes text[] NOT NULL DEFAULT ARRAY[]::text[],
 ADD CONSTRAINT external_contact_cursor_valid CHECK(source_cursor IS NULL OR length(source_cursor)<=1024 AND source_cursor ~ '^[A-Za-z0-9+/=_-]+$'),
 ADD CONSTRAINT external_contact_cursor_history_bounded CHECK(cardinality(cursor_hashes)<=201);
-- Opaque cursors never enter client snapshots and are cleared on every terminal transition.
CREATE FUNCTION public.clear_external_contact_cursor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.state NOT IN ('queued','fetching') THEN NEW.source_cursor=NULL;NEW.cursor_hashes=ARRAY[]::text[];END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_external_contact_cursor() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER external_contact_cursor_terminal BEFORE INSERT OR UPDATE ON public.external_contact_migration_jobs FOR EACH ROW EXECUTE FUNCTION public.clear_external_contact_cursor();


CREATE OR REPLACE FUNCTION public.create_external_contact_migration(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_source jsonb,p_fingerprint text,p_ciphertext text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.external_contact_migration_jobs;
BEGIN
 IF p_id IS NULL OR p_source IS NULL OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
  OR p_ciphertext IS NULL OR length(p_ciphertext)>20000 OR p_ciphertext !~ '^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$' THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 IF p_source->>'provider' IN ('gorgias','zendesk') THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_source))<>2 OR NOT(p_source ?& ARRAY['provider','origin'])
   OR jsonb_typeof(p_source->'origin') IS DISTINCT FROM 'string' OR length(p_source->>'origin')>120
   OR (p_source->>'provider'='gorgias' AND p_source->>'origin' !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.gorgias\.com$')
   OR (p_source->>'provider'='zendesk' AND p_source->>'origin' !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.zendesk\.com$')
  THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 ELSE
 IF p_source->>'provider' NOT IN ('kommo','manychat') OR p_source->>'provider' IS NULL
  OR jsonb_typeof(p_source->'origin') IS DISTINCT FROM 'string' OR length(p_source->>'origin')>120
  OR jsonb_typeof(p_source->'accountId') IS DISTINCT FROM 'number' OR p_source->>'accountId' !~ '^[1-9][0-9]{0,15}$'
 THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 IF (p_source->>'accountId')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 IF p_source->>'provider'='kommo' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_source))<>3 OR NOT(p_source ?& ARRAY['provider','origin','accountId'])
   OR p_source->>'origin' !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.kommo\.com$' THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(p_source))<>4 OR NOT(p_source ?& ARRAY['provider','origin','accountId','subscriberIds'])
   OR p_source->>'origin' IS DISTINCT FROM 'https://api.manychat.com' OR jsonb_typeof(p_source->'subscriberIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
  IF jsonb_array_length(p_source->'subscriberIds') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_source->'subscriberIds') item WHERE jsonb_typeof(item) IS DISTINCT FROM 'number' OR item::text !~ '^[1-9][0-9]{0,15}$') THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_source->'subscriberIds') item WHERE item::text::numeric>9007199254740991)
   OR (SELECT count(DISTINCT item) FROM jsonb_array_elements(p_source->'subscriberIds') item)<>jsonb_array_length(p_source->'subscriberIds') THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 END IF;
 END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('external-contact-job:'||p_id::text,0));
 SELECT * INTO job FROM public.external_contact_migration_jobs WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF job.workspace_id IS DISTINCT FROM p_workspace_id OR job.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'external_contact_migration_not_found';END IF;
  IF job.source IS DISTINCT FROM p_source OR job.input_fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'external_contact_migration_changed';END IF;
  RETURN public.read_external_contact_migration(p_workspace_id,p_actor_id,p_id,0);
 END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('external-contact-workspace:'||p_workspace_id::text,0));
 IF (SELECT count(*) FROM public.external_contact_migration_jobs WHERE workspace_id=p_workspace_id AND state IN ('queued','fetching') AND expires_at>clock_timestamp())>=3 THEN RAISE EXCEPTION 'external_contact_migration_limit';END IF;
 IF (SELECT count(*) FROM public.external_contact_migration_jobs WHERE workspace_id=p_workspace_id AND state IN ('queued','fetching','ready') AND expires_at>clock_timestamp())>=10 THEN RAISE EXCEPTION 'external_contact_migration_limit';END IF;
 INSERT INTO public.external_contact_migration_jobs(id,workspace_id,actor_id,source,input_fingerprint,credential_ciphertext,state,payload)
 VALUES(p_id,p_workspace_id,p_actor_id,p_source,p_fingerprint,p_ciphertext,'queued','[]'::jsonb);
 RETURN public.read_external_contact_migration(p_workspace_id,p_actor_id,p_id,0);
END $$;

CREATE OR REPLACE FUNCTION public.claim_external_contact_migrations(p_limit integer DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.external_contact_migration_jobs;lease uuid;claimed jsonb='[]'::jsonb;failure text;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 FOR job IN SELECT * FROM public.external_contact_migration_jobs WHERE (state='queued' OR state='fetching' AND lease_until<=clock_timestamp())
  AND available_at<=clock_timestamp() ORDER BY updated_at,id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  IF job.expires_at<=clock_timestamp() THEN
   UPDATE public.external_contact_migration_jobs SET state='expired',credential_ciphertext=NULL,payload=NULL,lease_id=NULL,lease_until=NULL,error_code='source_expired',updated_at=clock_timestamp() WHERE id=job.id;CONTINUE;
  END IF;
  BEGIN
   PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,true);
  EXCEPTION WHEN raise_exception THEN
   failure=SQLERRM;
   IF failure NOT IN ('contact_migration_not_found','contact_migration_read_only') THEN RAISE;END IF;
   UPDATE public.external_contact_migration_jobs SET state='cancelled',credential_ciphertext=NULL,payload=NULL,lease_id=NULL,lease_until=NULL,error_code=CASE WHEN failure='contact_migration_read_only' THEN 'source_read_only' ELSE 'source_access_revoked' END,updated_at=clock_timestamp() WHERE id=job.id;CONTINUE;
  END;
  lease=gen_random_uuid();
  UPDATE public.external_contact_migration_jobs SET state='fetching',lease_id=lease,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE id=job.id;
  claimed=claimed||jsonb_build_array(jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'source',job.source,'credential_ciphertext',job.credential_ciphertext,
   'last_id',COALESCE((job.payload->-1->>'sourceId')::bigint,0),'lease_id',lease,'page',job.page,'total',job.total,'collected',job.collected,'expires_at',job.expires_at)||CASE WHEN job.source->>'provider' IN ('gorgias','zendesk') THEN jsonb_build_object('source_cursor',job.source_cursor) ELSE '{}'::jsonb END);
  IF jsonb_array_length(claimed)>=p_limit THEN EXIT;END IF;
 END LOOP;
 RETURN claimed;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_external_contact_review(p_workspace_id uuid,p_actor_id uuid,p_job_id uuid,p_id uuid,p_input_hash text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.external_contact_migration_jobs;
BEGIN
 IF p_job_id IS NULL OR p_id IS NULL OR p_job_id=p_id OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 SELECT * INTO job FROM public.external_contact_migration_jobs WHERE id=p_job_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'external_contact_migration_not_found';END IF;
 IF job.state<>'ready' OR job.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'external_contact_migration_changed';END IF;
 IF jsonb_array_length(p_rows)<>job.total OR
  (SELECT jsonb_agg(value->>'sourceId' ORDER BY ordinality) FROM jsonb_array_elements(p_rows) WITH ORDINALITY) IS DISTINCT FROM
  (SELECT jsonb_agg(value->>'sourceId' ORDER BY ordinality) FROM jsonb_array_elements(job.payload) WITH ORDINALITY)
 THEN RAISE EXCEPTION 'external_contact_migration_changed';END IF;
 RETURN public.prepare_contact_migration(p_workspace_id,p_actor_id,p_id,job.source->>'provider',(job.source->>'origin')||CASE WHEN job.source ? 'accountId' THEN '#'||(job.source->>'accountId') ELSE '' END,p_input_hash,p_rows);
END $$;

CREATE FUNCTION public.record_external_cursor_contact_page(p_id uuid,p_lease_id uuid,p_page integer,p_done boolean,p_rows jsonb,p_cursor text,p_next_cursor text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.external_contact_migration_jobs;item jsonb;combined jsonb;count_rows integer;cursor_hash text;
BEGIN
 IF p_id IS NULL OR p_lease_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 201 OR p_done IS NULL
  OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
  OR p_cursor IS NOT NULL AND (length(p_cursor)>1024 OR p_cursor !~ '^[A-Za-z0-9+/=_-]+$')
  OR p_next_cursor IS NOT NULL AND (length(p_next_cursor)>1024 OR p_next_cursor !~ '^[A-Za-z0-9+/=_-]+$')
 THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 IF jsonb_array_length(p_rows)>25 THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 SELECT * INTO job FROM public.external_contact_migration_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'external_contact_migration_not_found';END IF;
 IF job.state IS DISTINCT FROM 'fetching' OR job.lease_id IS DISTINCT FROM p_lease_id OR job.lease_until<=clock_timestamp() OR job.expires_at<=clock_timestamp() THEN RETURN false;END IF;
 PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,true);
 IF job.source->>'provider' NOT IN ('gorgias','zendesk') OR job.source->>'provider' IS NULL OR job.page<>p_page OR job.total IS NOT NULL
  OR job.source_cursor IS DISTINCT FROM p_cursor OR (p_page=1) IS DISTINCT FROM (p_cursor IS NULL)
  OR p_done IS DISTINCT FROM (p_next_cursor IS NULL) OR NOT p_done AND (jsonb_array_length(p_rows)=0 OR p_cursor=p_next_cursor)
 THEN RAISE EXCEPTION 'external_contact_migration_changed';END IF;
 IF NOT p_done AND p_page>=201 THEN RAISE EXCEPTION 'external_contact_migration_limit';END IF;
 cursor_hash=md5(p_next_cursor);
 IF cursor_hash=ANY(job.cursor_hashes) THEN RAISE EXCEPTION 'external_contact_migration_changed';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>5 OR NOT(item ?& ARRAY['sourceId','phone','name','email','company'])
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['sourceId','phone','name','email','company']) field WHERE jsonb_typeof(item->field) IS DISTINCT FROM 'string' OR length(item->>field)>4096)
   OR item->>'sourceId' !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
  IF (item->>'sourceId')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_external_contact_migration';END IF;
 END LOOP;
 combined=job.payload||p_rows;count_rows=jsonb_array_length(combined);
 IF count_rows>5000 OR octet_length(combined::text)>8388608 THEN RAISE EXCEPTION 'external_contact_migration_limit';END IF;
 IF (SELECT count(DISTINCT value->>'sourceId') FROM jsonb_array_elements(combined))<>count_rows THEN RAISE EXCEPTION 'external_contact_migration_changed';END IF;
 UPDATE public.external_contact_migration_jobs SET total=CASE WHEN p_done THEN count_rows END,collected=count_rows,page=p_page+1,
  source_cursor=p_next_cursor,cursor_hashes=CASE WHEN p_done THEN ARRAY[]::text[] ELSE array_append(cursor_hashes,cursor_hash) END,
  state=CASE WHEN p_done AND count_rows=0 THEN 'empty' WHEN p_done THEN 'ready' ELSE 'queued' END,
  payload=CASE WHEN p_done AND count_rows=0 THEN NULL ELSE combined END,credential_ciphertext=CASE WHEN p_done THEN NULL ELSE credential_ciphertext END,
  lease_id=NULL,lease_until=NULL,retry_count=0,error_code=NULL,available_at=clock_timestamp()+interval '1 second',updated_at=clock_timestamp() WHERE id=p_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_external_cursor_contact_page(uuid,uuid,integer,boolean,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_external_cursor_contact_page(uuid,uuid,integer,boolean,jsonb,text,text) TO service_role;
CREATE FUNCTION public.external_cursor_contact_review_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.external_contact_review_ready()
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.external_contact_migration_jobs'::regclass AND attname='source_cursor' AND NOT attisdropped)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.external_contact_migration_jobs'::regclass AND tgname='external_contact_cursor_terminal' AND tgenabled='O')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.record_external_cursor_contact_page(uuid,uuid,integer,boolean,jsonb,text,text)'::regprocedure
 AND prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND has_function_privilege('service_role',oid,'EXECUTE'));
$$;
REVOKE ALL ON FUNCTION public.external_cursor_contact_review_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.external_cursor_contact_review_ready() TO service_role;


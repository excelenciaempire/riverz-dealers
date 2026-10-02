-- Private observed Chatwoot history. No live conversation/message/event writes.
CREATE TABLE public.native_history_archives(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 receipt_id uuid NOT NULL REFERENCES public.contact_migration_jobs(id) ON DELETE CASCADE,source jsonb NOT NULL,input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[a-f0-9]{64}$'),
 after_hash text, next_hash text,targets jsonb NOT NULL CHECK(jsonb_typeof(targets)='array' AND jsonb_array_length(targets) BETWEEN 1 AND 100),
 state text NOT NULL CHECK(state IN ('queued','fetching','ready','empty','confirmed','failed','cancelled','expired')),
 credential_ciphertext text,payload jsonb,revision text CHECK(revision ~ '^[a-f0-9]{64}$'),step integer NOT NULL DEFAULT 0 CHECK(step>=0),
 lease_id uuid,lease_until timestamptz,error_code text,retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 confirmed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),privacy_checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='fetching' AND lease_id IS NOT NULL AND lease_until IS NOT NULL) OR(state<>'fetching' AND lease_id IS NULL AND lease_until IS NULL)),
 CHECK((state IN ('queued','fetching') AND payload IS NOT NULL) OR(state IN ('ready','confirmed') AND payload IS NOT NULL AND revision IS NOT NULL AND credential_ciphertext IS NULL)
 OR(state IN ('empty','failed','cancelled','expired') AND payload IS NULL AND credential_ciphertext IS NULL)),
 CHECK((state='confirmed' AND confirmed_at IS NOT NULL) OR(state<>'confirmed' AND confirmed_at IS NULL))
);
CREATE INDEX native_history_archive_queue ON public.native_history_archives(available_at,updated_at,id) WHERE state IN ('queued','fetching');
CREATE INDEX native_history_archive_actor ON public.native_history_archives(workspace_id,actor_id,created_at DESC,id);
-- Upload intent survives archive/workspace deletion, so lost upload responses
-- and late lease holders can be cleaned up by their registered exact paths.
CREATE TABLE public.native_history_archive_objects(
 path text PRIMARY KEY,job_id uuid NOT NULL,lease_id uuid NOT NULL,message_id text NOT NULL,file_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.native_history_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_history_archive_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.native_history_archives,public.native_history_archive_objects FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('migration-archives','migration-archives',false,8388608) ON CONFLICT(id) DO NOTHING;
CREATE POLICY native_history_bucket_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>'migration-archives') WITH CHECK(bucket_id<>'migration-archives');

CREATE FUNCTION public.native_history_targets_valid(p_job public.native_history_archives) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.contact_migration_jobs r WHERE r.id=p_job.receipt_id AND r.workspace_id=p_job.workspace_id AND r.actor_id=p_job.actor_id AND r.state='completed'
 AND r.provider=p_job.source->>'provider' AND r.account=(p_job.source->>'origin')||'#'||(p_job.source->>'accountId'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_job.targets) t WHERE NOT EXISTS(SELECT 1 FROM public.contact_migration_sources s JOIN public.contacts c ON c.id=s.contact_id AND c.workspace_id=s.workspace_id
 WHERE s.job_id=p_job.receipt_id AND s.workspace_id=p_job.workspace_id AND s.provider=p_job.source->>'provider' AND s.account=(p_job.source->>'origin')||'#'||(p_job.source->>'accountId')
 AND s.source_hash=t->>'sourceHash' AND s.source_id=t->>'sourceId' AND s.contact_id::text=t->>'contactId'));
$$;

CREATE FUNCTION public.read_native_history_archive(p_workspace_id uuid,p_actor_id uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;p jsonb;
BEGIN
 IF p_id IS NULL THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_history_archive_not_found';END IF;
 IF job.state IN ('queued','fetching','ready','confirmed') AND (job.state<>'confirmed' AND job.expires_at<=clock_timestamp() OR NOT public.native_history_targets_valid(job)) THEN
  UPDATE public.native_history_archives SET state='expired',payload=NULL,credential_ciphertext=NULL,lease_id=NULL,lease_until=NULL,confirmed_at=NULL,error_code='source_expired',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO job;
 END IF;
 p=job.payload;
 RETURN jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'receipt_id',job.receipt_id,'source',job.source,'state',job.state,
  'created_at',job.created_at,'expires_at',job.expires_at,'confirmed_at',job.confirmed_at,'revision',job.revision,'error',job.error_code,'targets',jsonb_array_length(job.targets),
  'contacts_collected',COALESCE((p->>'targetIndex')::integer,0),'conversations',COALESCE(jsonb_array_length(p->'conversations'),0),'messages',COALESCE(jsonb_array_length(p->'messages'),0),
  'files',COALESCE(jsonb_array_length(p->'storedFiles'),0),'next',job.next_hash);
END $$;

CREATE FUNCTION public.create_native_history_archive(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_receipt_id uuid,p_source jsonb,p_after text,p_fingerprint text,p_ciphertext text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;receipt public.contact_migration_jobs;targets jsonb;next_hash text;
BEGIN
 IF p_id IS NULL OR p_receipt_id IS NULL OR p_id=p_receipt_id OR p_source IS NULL OR jsonb_typeof(p_source) IS DISTINCT FROM 'object'
 OR p_after IS NOT NULL AND p_after !~ '^[a-f0-9]{64}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
 OR p_ciphertext IS NULL OR length(p_ciphertext)>20000 OR p_ciphertext !~ '^[a-f0-9]{24}:[a-f0-9]+:[a-f0-9]{32}$' THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_source))<>3 OR NOT(p_source ?& ARRAY['provider','origin','accountId']) OR p_source->>'provider' IS DISTINCT FROM 'chatwoot'
 OR jsonb_typeof(p_source->'origin') IS DISTINCT FROM 'string' OR length(p_source->>'origin')>120 OR p_source->>'origin' !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$'
 OR jsonb_typeof(p_source->'accountId') IS DISTINCT FROM 'number' OR p_source->>'accountId' !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 IF (p_source->>'accountId')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('native-history-job:'||p_id::text,0));
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF job.workspace_id IS DISTINCT FROM p_workspace_id OR job.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'native_history_archive_not_found';END IF;
  IF job.receipt_id IS DISTINCT FROM p_receipt_id OR job.source IS DISTINCT FROM p_source OR job.after_hash IS DISTINCT FROM p_after OR job.input_fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
  RETURN public.read_native_history_archive(p_workspace_id,p_actor_id,p_id);
 END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 SELECT * INTO receipt FROM public.contact_migration_jobs WHERE id=p_receipt_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR SHARE;
 IF NOT FOUND OR receipt.state<>'completed' OR receipt.provider IS DISTINCT FROM p_source->>'provider' OR receipt.account IS DISTINCT FROM (p_source->>'origin')||'#'||(p_source->>'accountId') THEN RAISE EXCEPTION 'native_history_archive_not_found';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('native-history-workspace:'||p_workspace_id::text,0));
 IF (SELECT count(*) FROM public.native_history_archives WHERE workspace_id=p_workspace_id AND state IN ('queued','fetching','ready') AND expires_at>clock_timestamp())>=3 THEN RAISE EXCEPTION 'native_history_archive_limit';END IF;
 IF (SELECT count(*) FROM public.native_history_archives WHERE workspace_id=p_workspace_id AND state='confirmed')>=100 THEN RAISE EXCEPTION 'native_history_archive_limit';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceHash',s.source_hash,'sourceId',s.source_id,'contactId',s.contact_id) ORDER BY s.source_hash),'[]'::jsonb) INTO targets FROM
 (SELECT * FROM public.contact_migration_sources WHERE job_id=p_receipt_id AND workspace_id=p_workspace_id AND (p_after IS NULL OR source_hash>p_after) ORDER BY source_hash LIMIT 100) s;
 IF jsonb_array_length(targets)=0 THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(targets) t WHERE t->>'sourceId' !~ '^[1-9][0-9]{0,15}$') THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(targets) t WHERE (t->>'sourceId')::numeric>9007199254740991) THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 IF EXISTS(SELECT 1 FROM public.contact_migration_sources WHERE job_id=p_receipt_id AND workspace_id=p_workspace_id AND source_hash>(targets->-1->>'sourceHash')) THEN next_hash=targets->-1->>'sourceHash';END IF;
 INSERT INTO public.native_history_archives(id,workspace_id,actor_id,receipt_id,source,after_hash,next_hash,input_fingerprint,credential_ciphertext,state,targets,payload)
 VALUES(p_id,p_workspace_id,p_actor_id,p_receipt_id,p_source,p_after,next_hash,p_fingerprint,p_ciphertext,'queued',targets,
  jsonb_build_object('targets',targets,'targetIndex',0,'phase','initial','seed',NULL,'anchor',NULL,'neighbour',NULL,'sample','[]'::jsonb,'conversationIndex',0,'before',NULL,'conversations','[]'::jsonb,'messages','[]'::jsonb,'storedFiles','[]'::jsonb));
 RETURN public.read_native_history_archive(p_workspace_id,p_actor_id,p_id);
END $$;

CREATE FUNCTION public.claim_native_history_archives(p_limit integer DEFAULT 2) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;lease uuid;claimed jsonb='[]'::jsonb;failure text;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 FOR job IN SELECT * FROM public.native_history_archives WHERE (state='queued' OR state='fetching' AND lease_until<=clock_timestamp()) AND available_at<=clock_timestamp()
 ORDER BY updated_at,id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  BEGIN
   IF job.expires_at<=clock_timestamp() OR NOT public.native_history_targets_valid(job) THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
   PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,true);
  EXCEPTION WHEN raise_exception THEN
   failure=SQLERRM;IF failure NOT IN ('contact_migration_not_found','contact_migration_read_only','native_history_archive_changed') THEN RAISE;END IF;
   UPDATE public.native_history_archives SET state='expired',payload=NULL,credential_ciphertext=NULL,lease_id=NULL,lease_until=NULL,error_code=CASE WHEN failure='contact_migration_read_only' THEN 'source_read_only' ELSE 'source_access_revoked' END,updated_at=clock_timestamp() WHERE id=job.id;CONTINUE;
  END;
  lease=gen_random_uuid();UPDATE public.native_history_archives SET state='fetching',lease_id=lease,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE id=job.id;
  claimed=claimed||jsonb_build_array(jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'receipt_id',job.receipt_id,'source',job.source,'credential_ciphertext',job.credential_ciphertext,
   'lease_id',lease,'step',job.step,'payload',job.payload,'expires_at',job.expires_at));IF jsonb_array_length(claimed)>=p_limit THEN EXIT;END IF;
 END LOOP;RETURN claimed;
END $$;

CREATE FUNCTION public.authorize_native_history_step(p_id uuid,p_lease_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;
BEGIN
 IF p_id IS NULL OR p_lease_id IS NULL THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.state<>'fetching' OR job.lease_id IS DISTINCT FROM p_lease_id OR job.lease_until<=clock_timestamp() OR job.expires_at<=clock_timestamp() THEN RETURN false;END IF;
 PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,true);
 IF NOT public.native_history_targets_valid(job) THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;RETURN true;
END $$;

CREATE FUNCTION public.register_native_history_object(p_id uuid,p_lease_id uuid,p_message_id text,p_file_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;upload_path text;
BEGIN
 IF public.authorize_native_history_step(p_id,p_lease_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id;
 IF p_message_id IS NULL OR p_message_id !~ '^[1-9][0-9]{0,9}$' OR p_file_id IS NULL OR p_file_id !~ '^[1-9][0-9]{0,15}$' OR job.payload->>'phase'<>'files'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(job.payload->'messages') m,jsonb_array_elements(m->'attachments') f WHERE m->>'sourceId'=p_message_id AND f->>'sourceId'=p_file_id AND jsonb_typeof(f->'referenceCiphertext')='string')
 THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 upload_path=p_id::text||'/'||p_lease_id::text||'/'||p_file_id;
 INSERT INTO public.native_history_archive_objects(path,job_id,lease_id,message_id,file_id) VALUES(upload_path,p_id,p_lease_id,p_message_id,p_file_id) ON CONFLICT(path) DO NOTHING;RETURN upload_path;
END $$;

CREATE FUNCTION public.record_native_history_step(p_id uuid,p_lease_id uuid,p_step integer,p_payload jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;phase text;f jsonb;
BEGIN
 IF p_step IS NULL OR p_step<0 OR p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 IF public.authorize_native_history_step(p_id,p_lease_id) IS DISTINCT FROM true THEN RETURN false;END IF;
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id;
 IF job.step<>p_step OR p_payload->'targets' IS DISTINCT FROM job.targets THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
 IF octet_length(p_payload::text)>16777216 THEN RAISE EXCEPTION 'native_history_archive_limit';END IF;
 phase=p_payload->>'phase';
 IF phase IS NULL OR phase NOT IN ('initial','older','newer','messages','files','done') OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>12 OR
 NOT(p_payload ?& ARRAY['targets','targetIndex','phase','seed','anchor','neighbour','sample','conversationIndex','before','conversations','messages','storedFiles'])
 THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 -- Twelve collection keys; no provider tokens or raw response fields allowed.
 IF jsonb_typeof(p_payload->'conversations') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'messages') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'storedFiles') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 IF jsonb_array_length(p_payload->'conversations')>500 OR jsonb_array_length(p_payload->'messages')>10000 OR jsonb_array_length(p_payload->'storedFiles')>100 THEN RAISE EXCEPTION 'native_history_archive_limit';END IF;
 IF (p_payload->>'targetIndex') !~ '^[0-9]{1,3}$' OR (p_payload->>'targetIndex')::integer>jsonb_array_length(job.targets) OR
 (phase IN ('files','done') AND (p_payload->>'targetIndex')::integer<>jsonb_array_length(job.targets)) THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_payload->'storedFiles') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.native_history_archive_objects o WHERE o.path=f->>'path' AND o.job_id=p_id AND o.message_id=f->>'messageId' AND o.file_id=f->>'fileId') THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
 END LOOP;
 IF phase='done' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'messages') m,jsonb_array_elements(m->'attachments') a WHERE a->'referenceCiphertext' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 UPDATE public.native_history_archives SET state=CASE WHEN phase='done' THEN CASE WHEN jsonb_array_length(p_payload->'conversations')=0 THEN 'empty' ELSE 'ready' END ELSE 'queued' END,
 payload=CASE WHEN phase='done' AND jsonb_array_length(p_payload->'conversations')=0 THEN NULL ELSE p_payload END,
 credential_ciphertext=CASE WHEN phase IN ('files','done') THEN NULL ELSE credential_ciphertext END,
 revision=CASE WHEN phase='done' THEN encode(pg_catalog.sha256(convert_to(p_payload::text,'UTF8')),'hex') ELSE NULL END,
 step=step+1,lease_id=NULL,lease_until=NULL,retry_count=0,error_code=NULL,available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;RETURN true;
END $$;

CREATE FUNCTION public.fail_native_history_archive(p_id uuid,p_lease_id uuid,p_code text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;retry boolean;
BEGIN
 IF p_id IS NULL OR p_lease_id IS NULL OR p_code IS NULL OR p_code NOT IN ('source_invalid','source_changed','source_limit','source_order_unsupported','source_auth','source_rate_limit','source_timeout','source_unavailable','source_credential_unavailable','source_access_revoked','source_read_only') THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.state<>'fetching' OR job.lease_id IS DISTINCT FROM p_lease_id OR job.lease_until<=clock_timestamp() THEN RETURN false;END IF;
 retry=p_code IN ('source_rate_limit','source_timeout','source_unavailable') AND job.retry_count<3 AND job.expires_at>clock_timestamp();
 UPDATE public.native_history_archives SET state=CASE WHEN retry THEN 'queued' ELSE 'failed' END,payload=CASE WHEN retry THEN payload END,credential_ciphertext=CASE WHEN retry THEN credential_ciphertext END,
 lease_id=NULL,lease_until=NULL,error_code=p_code,retry_count=LEAST(3,retry_count+1),available_at=clock_timestamp()+(interval '1 minute'*power(2,job.retry_count)),updated_at=clock_timestamp() WHERE id=p_id;RETURN true;
END $$;

CREATE FUNCTION public.confirm_native_history_archive(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_revision text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;
BEGIN
 IF p_id IS NULL OR p_revision IS NULL OR p_revision !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_history_archive_not_found';END IF;
 IF job.revision IS DISTINCT FROM p_revision OR NOT public.native_history_targets_valid(job) OR job.state NOT IN ('ready','confirmed') OR job.state='ready' AND job.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
 IF job.state='ready' THEN UPDATE public.native_history_archives SET state='confirmed',confirmed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;END IF;
 RETURN public.read_native_history_archive(p_workspace_id,p_actor_id,p_id);
END $$;

CREATE FUNCTION public.cancel_native_history_archive(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_delete boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_id IS NULL OR p_delete IS NULL THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 PERFORM 1 FROM public.native_history_archives WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'native_history_archive_not_found';END IF;
 UPDATE public.native_history_archives SET state='cancelled',payload=NULL,credential_ciphertext=NULL,confirmed_at=NULL,lease_id=NULL,lease_until=NULL,error_code=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND (state IN ('queued','fetching','ready') OR p_delete AND state='confirmed');RETURN public.read_native_history_archive(p_workspace_id,p_actor_id,p_id);
END $$;

-- Service receives only a bounded page after authority, not the entire archive.
CREATE FUNCTION public.read_native_history_messages(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_after integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;rows jsonb;last_row integer;
BEGIN
 IF p_after IS NULL OR p_after NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 PERFORM public.read_native_history_archive(p_workspace_id,p_actor_id,p_id);
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id;
 IF job.state NOT IN ('ready','confirmed') THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('message',page.value,'conversation',(SELECT c FROM jsonb_array_elements(job.payload->'conversations') c WHERE c->>'sourceId'=page.value->>'conversationSourceId'),
  'target',(SELECT t FROM jsonb_array_elements(job.targets) t WHERE t->>'sourceId'=(SELECT c->>'contactSourceId' FROM jsonb_array_elements(job.payload->'conversations') c WHERE c->>'sourceId'=page.value->>'conversationSourceId')),
  'files',(SELECT COALESCE(jsonb_agg(f),'[]'::jsonb) FROM jsonb_array_elements(job.payload->'storedFiles') f WHERE f->>'messageId'=page.value->>'sourceId')) ORDER BY page.ordinality),'[]'::jsonb),max(page.ordinality::integer)
 INTO rows,last_row FROM(SELECT value,ordinality FROM jsonb_array_elements(job.payload->'messages') WITH ORDINALITY WHERE ordinality>p_after ORDER BY ordinality LIMIT 20) page;
 RETURN jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'revision',job.revision,'total',jsonb_array_length(job.payload->'messages'),'rows',rows,
 'next',CASE WHEN last_row<jsonb_array_length(job.payload->'messages') THEN last_row END);
END $$;

CREATE FUNCTION public.read_native_history_file(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_file_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;file jsonb;
BEGIN
 IF p_file_id IS NULL OR p_file_id !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 PERFORM public.read_native_history_archive(p_workspace_id,p_actor_id,p_id);
 SELECT * INTO job FROM public.native_history_archives WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id;
 IF job.state NOT IN ('ready','confirmed') THEN RAISE EXCEPTION 'native_history_archive_changed';END IF;
 SELECT value INTO file FROM jsonb_array_elements(job.payload->'storedFiles') WHERE value->>'fileId'=p_file_id;
 IF file IS NULL THEN RAISE EXCEPTION 'native_history_archive_not_found';END IF;RETURN file;
END $$;

CREATE FUNCTION public.purge_native_history_archives() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.native_history_archives;changed integer=0;failure text;
BEGIN
 FOR job IN SELECT * FROM public.native_history_archives WHERE state IN ('queued','fetching','ready','confirmed') ORDER BY privacy_checked_at,id LIMIT 500 FOR UPDATE SKIP LOCKED LOOP
  failure=NULL;
  BEGIN PERFORM public.contact_migration_guard(job.workspace_id,job.actor_id,false);
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'contact_migration_not_found' THEN RAISE;END IF;failure='source_access_revoked';END;
  IF failure IS NOT NULL OR NOT public.native_history_targets_valid(job) OR job.state<>'confirmed' AND job.expires_at<=clock_timestamp() THEN
   UPDATE public.native_history_archives SET state='expired',payload=NULL,credential_ciphertext=NULL,confirmed_at=NULL,lease_id=NULL,lease_until=NULL,error_code=COALESCE(failure,'source_expired'),updated_at=clock_timestamp() WHERE id=job.id;changed=changed+1;
  ELSE UPDATE public.native_history_archives SET privacy_checked_at=clock_timestamp() WHERE id=job.id;END IF;
 END LOOP;
 WITH candidates AS(SELECT id FROM public.native_history_archives WHERE state IN ('empty','failed','cancelled','expired') AND updated_at<clock_timestamp()-interval '30 days' ORDER BY updated_at,id LIMIT 500 FOR UPDATE SKIP LOCKED)
 DELETE FROM public.native_history_archives j USING candidates c WHERE j.id=c.id;RETURN changed;
END $$;

CREATE FUNCTION public.list_native_history_orphans(p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 RETURN(SELECT COALESCE(jsonb_agg(jsonb_build_object('path',o.path)),'[]'::jsonb) FROM(SELECT o.path FROM public.native_history_archive_objects o WHERE o.created_at<clock_timestamp()-interval '120 seconds'
 AND NOT EXISTS(SELECT 1 FROM public.native_history_archives j WHERE j.id=o.job_id AND j.state IN ('queued','fetching','ready','confirmed')
 AND (EXISTS(SELECT 1 FROM jsonb_array_elements(j.payload->'storedFiles') f WHERE f->>'path'=o.path) OR j.state='fetching' AND j.lease_id=o.lease_id AND j.lease_until>clock_timestamp())) ORDER BY o.created_at,o.path LIMIT p_limit) o);
END $$;
CREATE FUNCTION public.forget_native_history_orphan(p_path text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE deleted integer;
BEGIN
 IF p_path IS NULL THEN RAISE EXCEPTION 'invalid_native_history_archive';END IF;
 DELETE FROM public.native_history_archive_objects o WHERE o.path=p_path AND o.created_at<clock_timestamp()-interval '120 seconds'
 AND NOT EXISTS(SELECT 1 FROM public.native_history_archives j WHERE j.id=o.job_id AND j.state IN ('queued','fetching','ready','confirmed')
 AND (EXISTS(SELECT 1 FROM jsonb_array_elements(j.payload->'storedFiles') f WHERE f->>'path'=o.path) OR j.state='fetching' AND j.lease_id=o.lease_id AND j.lease_until>clock_timestamp()));
 GET DIAGNOSTICS deleted=ROW_COUNT;RETURN deleted=1;
END $$;

REVOKE ALL ON FUNCTION public.native_history_targets_valid(public.native_history_archives),public.read_native_history_archive(uuid,uuid,uuid),public.create_native_history_archive(uuid,uuid,uuid,uuid,jsonb,text,text,text),
 public.claim_native_history_archives(integer),public.authorize_native_history_step(uuid,uuid),public.register_native_history_object(uuid,uuid,text,text),public.record_native_history_step(uuid,uuid,integer,jsonb),
 public.fail_native_history_archive(uuid,uuid,text),public.confirm_native_history_archive(uuid,uuid,uuid,text),public.cancel_native_history_archive(uuid,uuid,uuid,boolean),public.read_native_history_messages(uuid,uuid,uuid,integer),
 public.read_native_history_file(uuid,uuid,uuid,text),public.purge_native_history_archives(),public.list_native_history_orphans(integer),public.forget_native_history_orphan(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.native_history_targets_valid(public.native_history_archives),public.read_native_history_archive(uuid,uuid,uuid),public.create_native_history_archive(uuid,uuid,uuid,uuid,jsonb,text,text,text),
 public.claim_native_history_archives(integer),public.authorize_native_history_step(uuid,uuid),public.register_native_history_object(uuid,uuid,text,text),public.record_native_history_step(uuid,uuid,integer,jsonb),
 public.fail_native_history_archive(uuid,uuid,text),public.confirm_native_history_archive(uuid,uuid,uuid,text),public.cancel_native_history_archive(uuid,uuid,uuid,boolean),public.read_native_history_messages(uuid,uuid,uuid,integer),
 public.read_native_history_file(uuid,uuid,uuid,text),public.purge_native_history_archives(),public.list_native_history_orphans(integer),public.forget_native_history_orphan(text) TO service_role;

CREATE FUNCTION public.native_history_archive_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.native_contact_review_ready() AND EXISTS(SELECT 1 FROM storage.buckets WHERE id='migration-archives' AND public=false AND file_size_limit=8388608)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='storage.objects'::regclass AND polname='native_history_bucket_private' AND NOT polpermissive
 AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='anon')=ANY(polroles) AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')=ANY(polroles)
 AND position('migration-archives' IN pg_catalog.pg_get_expr(polqual,polrelid))>0 AND position('migration-archives' IN pg_catalog.pg_get_expr(polwithcheck,polrelid))>0)
 AND (SELECT count(*)=2 AND bool_and(relrowsecurity) FROM pg_catalog.pg_class WHERE oid=ANY(ARRAY['public.native_history_archives'::regclass,'public.native_history_archive_objects'::regclass]))
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r,unnest(ARRAY['public.native_history_archives','public.native_history_archive_objects']) t
 WHERE has_table_privilege(r,t,'SELECT') OR has_table_privilege(r,t,'INSERT'))
 AND(SELECT count(*)=15 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE'))
 FROM pg_catalog.pg_proc p WHERE p.oid=ANY(ARRAY['public.native_history_targets_valid(public.native_history_archives)'::regprocedure,'public.read_native_history_archive(uuid,uuid,uuid)'::regprocedure,
 'public.create_native_history_archive(uuid,uuid,uuid,uuid,jsonb,text,text,text)'::regprocedure,'public.claim_native_history_archives(integer)'::regprocedure,'public.authorize_native_history_step(uuid,uuid)'::regprocedure,
 'public.register_native_history_object(uuid,uuid,text,text)'::regprocedure,'public.record_native_history_step(uuid,uuid,integer,jsonb)'::regprocedure,'public.fail_native_history_archive(uuid,uuid,text)'::regprocedure,
 'public.confirm_native_history_archive(uuid,uuid,uuid,text)'::regprocedure,'public.cancel_native_history_archive(uuid,uuid,uuid,boolean)'::regprocedure,'public.read_native_history_messages(uuid,uuid,uuid,integer)'::regprocedure,
 'public.read_native_history_file(uuid,uuid,uuid,text)'::regprocedure,'public.purge_native_history_archives()'::regprocedure,'public.list_native_history_orphans(integer)'::regprocedure,'public.forget_native_history_orphan(text)'::regprocedure]));
$$;
REVOKE ALL ON FUNCTION public.native_history_archive_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.native_history_archive_ready() TO service_role;

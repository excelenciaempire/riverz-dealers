-- X2: private, reviewed, atomic contact import. No customer transport in SQL.
-- Imported identities remain asserted, opted out and unlinked. No customer transport in SQL.
CREATE TABLE public.contact_migration_jobs(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('kommo','leadsales','manychat','chatwoot','gorgias','zendesk')),
 account text NOT NULL CHECK(length(account) BETWEEN 1 AND 160 AND account !~ '[[:cntrl:]]'),
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),revision text NOT NULL CHECK(revision ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('prepared','completed','expired')),
 payload jsonb,results jsonb,
 total integer NOT NULL CHECK(total BETWEEN 1 AND 5000),new_count integer NOT NULL CHECK(new_count BETWEEN 0 AND 5000),
 existing_count integer NOT NULL CHECK(existing_count BETWEEN 0 AND 5000),excluded_count integer NOT NULL CHECK(excluded_count BETWEEN 0 AND 5000),
 created_count integer NOT NULL DEFAULT 0 CHECK(created_count BETWEEN 0 AND 5000),
 prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',completed_at timestamptz,
 UNIQUE(id,workspace_id,provider,account),
 CHECK(total=new_count+existing_count+excluded_count),
 CHECK((state='prepared' AND payload IS NOT NULL AND created_count=0 AND completed_at IS NULL)
  OR (state='completed' AND payload IS NULL AND created_count=new_count AND completed_at IS NOT NULL)
  OR (state='expired' AND payload IS NULL AND created_count=0 AND completed_at IS NULL))
);
CREATE TABLE public.contact_migration_sources(
 workspace_id uuid NOT NULL,provider text NOT NULL,account text NOT NULL,source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 4096),phone_key text NOT NULL CHECK(phone_key ~ '^[1-9][0-9]{5,14}$'),
 job_id uuid NOT NULL,contact_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,provider,account,source_hash),
 FOREIGN KEY(job_id,workspace_id,provider,account) REFERENCES public.contact_migration_jobs(id,workspace_id,provider,account) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,contact_id) REFERENCES public.contacts(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX contact_migration_jobs_actor ON public.contact_migration_jobs(workspace_id,actor_id,prepared_at DESC,id DESC);
ALTER TABLE public.contact_migration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_migration_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_migration_jobs,public.contact_migration_sources FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.contact_migration_guard(p_workspace_id uuid,p_actor_id uuid,p_write boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid;member public.workspace_members;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_write IS NULL THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 SELECT owner_id INTO owner FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact_migration_not_found';END IF;
 IF owner IS DISTINCT FROM p_actor_id THEN
  SELECT * INTO member FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
  IF NOT FOUND OR member.role IS DISTINCT FROM 'admin' OR (member.allowed_sections IS NOT NULL AND
   (jsonb_typeof(to_jsonb(member.allowed_sections)) IS DISTINCT FROM 'array' OR NOT(to_jsonb(member.allowed_sections) ? '/contactos')))
  THEN RAISE EXCEPTION 'contact_migration_not_found';END IF;
 END IF;
 IF p_write THEN
  PERFORM 1 FROM public.workspace_subscriptions WHERE workspace_id=p_workspace_id FOR SHARE;
  PERFORM 1 FROM public.workspace_billing_invoices WHERE workspace_id=p_workspace_id FOR SHARE;
  IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'contact_migration_read_only';END IF;
 END IF;
END $$;

CREATE FUNCTION public.read_contact_migration(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_after integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.contact_migration_jobs;rows jsonb;last_row integer;next_row integer;
BEGIN
 IF p_id IS NULL OR p_after IS NULL OR p_after NOT BETWEEN 0 AND 5001 THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 SELECT * INTO job FROM public.contact_migration_jobs WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact_migration_not_found';END IF;
 IF job.state='prepared' AND job.expires_at<=clock_timestamp() THEN
  UPDATE public.contact_migration_jobs SET state='expired',payload=NULL WHERE id=job.id RETURNING * INTO job;
 END IF;
 rows='[]'::jsonb;next_row=NULL;
 IF job.state='prepared' THEN
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->>'row')::integer),'[]'::jsonb),max((value->>'row')::integer)
  INTO rows,last_row FROM (SELECT value FROM jsonb_array_elements(job.payload) WHERE (value->>'row')::integer>p_after ORDER BY (value->>'row')::integer LIMIT 25) page;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(job.payload) WHERE (value->>'row')::integer>last_row) THEN next_row=last_row;END IF;
 END IF;
 RETURN jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'provider',job.provider,'account',job.account,'revision',job.revision,
  'state',job.state,'prepared_at',job.prepared_at,'expires_at',job.expires_at,'completed_at',job.completed_at,
  'counts',jsonb_build_object('total',job.total,'new',job.new_count,'existing',job.existing_count,'excluded',job.excluded_count,'created',job.created_count),
  'rows',rows,'next',next_row);
END $$;

REVOKE ALL ON FUNCTION public.contact_migration_guard(uuid,uuid,boolean),public.read_contact_migration(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contact_migration_guard(uuid,uuid,boolean),public.read_contact_migration(uuid,uuid,uuid,integer) TO service_role;

-- Classification has no identity-link side effects. A matching email is not proof.
CREATE FUNCTION public.classify_contact_migration(p_workspace_id uuid,p_provider text,p_account text,p_rows jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 WITH input AS (
  SELECT r.value AS item,regexp_replace(r.value->>'phone','[^0-9]','','g') AS phone_key,
   COALESCE((SELECT jsonb_agg(i.value ORDER BY i.ordinality) FROM jsonb_array_elements(r.value->'issues') WITH ORDINALITY i
    WHERE i.value NOT IN ('"existing_contact"'::jsonb,'"source_changed"'::jsonb)),'[]'::jsonb) AS base_issues
  FROM jsonb_array_elements(p_rows) r
 ), keys AS (SELECT DISTINCT phone_key FROM input WHERE phone_key<>''),
 contact_keys AS MATERIALIZED (
  SELECT regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g') AS phone_key FROM public.contacts c WHERE c.workspace_id=p_workspace_id
  UNION ALL SELECT c.external_id FROM public.contacts c WHERE c.workspace_id=p_workspace_id AND c.channel='whatsapp' AND c.external_id IS NOT NULL
  UNION ALL SELECT c.wa_id FROM public.contacts c WHERE c.workspace_id=p_workspace_id AND c.channel='whatsapp' AND c.wa_id IS NOT NULL
 ),
 existing AS (
  SELECT DISTINCT k.phone_key FROM keys k JOIN contact_keys c ON c.phone_key=k.phone_key
 ), checked AS (
  SELECT i.*,s.contact_id,s.phone_key AS source_phone,c.phone AS current_phone,e.phone_key AS existing_phone
  FROM input i LEFT JOIN public.contact_migration_sources s ON s.workspace_id=p_workspace_id AND s.provider=p_provider AND s.account=p_account
   AND s.source_hash=encode(pg_catalog.sha256(convert_to(i.item->>'sourceId','UTF8')),'hex')
  LEFT JOIN public.contacts c ON c.id=s.contact_id AND c.workspace_id=p_workspace_id
  LEFT JOIN existing e ON e.phone_key=i.phone_key
 ), classified AS (
  SELECT *,CASE WHEN jsonb_array_length(base_issues)>0 THEN 'excluded'
    WHEN contact_id IS NOT NULL AND (source_phone IS DISTINCT FROM phone_key OR regexp_replace(COALESCE(current_phone,''),'[^0-9]','','g') IS DISTINCT FROM phone_key) THEN 'excluded'
    WHEN contact_id IS NOT NULL OR existing_phone IS NOT NULL THEN 'existing' ELSE 'new' END AS row_state
  FROM checked
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('row',(item->>'row')::integer,'sourceId',item->>'sourceId','phone',item->>'phone',
  'name',item->>'name','email',item->>'email','company',item->>'company','state',row_state,'contact_id',NULL,
  'issues',CASE WHEN jsonb_array_length(base_issues)>0 THEN base_issues WHEN row_state='existing' THEN '["existing_contact"]'::jsonb
   WHEN row_state='excluded' THEN '["source_changed"]'::jsonb ELSE '[]'::jsonb END) ORDER BY (item->>'row')::integer),'[]'::jsonb) FROM classified;
$$;

CREATE FUNCTION public.prepare_contact_migration(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_provider text,p_account text,p_input_hash text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.contact_migration_jobs;item jsonb;position integer;classified jsonb;new_rows integer;existing_rows integer;excluded_rows integer;revision_hash text;
BEGIN
 IF p_id IS NULL OR p_provider IS NULL OR p_provider NOT IN ('kommo','leadsales','manychat','chatwoot','gorgias','zendesk')
  OR p_account IS NULL OR length(p_account) NOT BETWEEN 1 AND 160 OR p_account !~ '[^[:space:]]' OR p_account ~ '[[:cntrl:]]'
  OR p_input_hash IS NULL OR p_input_hash !~ '^[0-9a-f]{64}$' OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 OR octet_length(p_rows::text)>8388608 THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 FOR item,position IN SELECT value,ordinality::integer FROM jsonb_array_elements(p_rows) WITH ORDINALITY LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>7 OR NOT(item ?& ARRAY['row','sourceId','phone','name','email','company','issues'])
   OR jsonb_typeof(item->'row') IS DISTINCT FROM 'number' OR item->>'row' IS DISTINCT FROM (position+1)::text
   OR jsonb_typeof(item->'issues') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['sourceId','phone','name','email','company']) field
   WHERE jsonb_typeof(item->field) IS DISTINCT FROM 'string' OR length(item->>field)>4096)
   OR length(item->>'phone')>32 OR jsonb_array_length(item->'issues')>6
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'issues') i WHERE jsonb_typeof(i) IS DISTINCT FROM 'string' OR i#>>'{}' NOT IN
    ('source_id_missing','phone_invalid','email_invalid','source_conflict','phone_conflict','duplicate'))
   OR (SELECT count(DISTINCT i) FROM jsonb_array_elements(item->'issues') i)<>jsonb_array_length(item->'issues')
  THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
  IF jsonb_array_length(item->'issues')=0 AND (length(btrim(item->>'sourceId'))=0 OR item->>'phone' !~ '^\+[1-9][0-9]{5,14}$'
   OR (item->>'email'<>'' AND item->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE jsonb_array_length(r->'issues')=0 GROUP BY r->>'phone' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE jsonb_array_length(r->'issues')=0 GROUP BY r->>'sourceId' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-migration-job:'||p_id::text,0));
 SELECT * INTO job FROM public.contact_migration_jobs WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF job.workspace_id IS DISTINCT FROM p_workspace_id OR job.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'contact_migration_not_found';END IF;
  IF job.provider IS DISTINCT FROM p_provider OR job.account IS DISTINCT FROM p_account OR job.input_hash IS DISTINCT FROM p_input_hash
   THEN RAISE EXCEPTION 'contact_migration_changed';END IF;
  RETURN public.read_contact_migration(p_workspace_id,p_actor_id,p_id,0);
 END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 -- Limit retained private previews, including abandoned browser attempts.
 UPDATE public.contact_migration_jobs SET state='expired',payload=NULL WHERE workspace_id=p_workspace_id AND state='prepared' AND expires_at<=clock_timestamp();
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-identity:'||p_workspace_id::text,0));
 IF (SELECT count(*) FROM public.contact_migration_jobs WHERE workspace_id=p_workspace_id AND state='prepared')>=10 THEN RAISE EXCEPTION 'contact_migration_limit';END IF;
 classified=public.classify_contact_migration(p_workspace_id,p_provider,p_account,p_rows);
 SELECT count(*) FILTER(WHERE value->>'state'='new'),count(*) FILTER(WHERE value->>'state'='existing'),count(*) FILTER(WHERE value->>'state'='excluded')
 INTO new_rows,existing_rows,excluded_rows FROM jsonb_array_elements(classified);
 revision_hash=encode(pg_catalog.sha256(convert_to(jsonb_build_object('workspace',p_workspace_id,'actor',p_actor_id,'id',p_id,'provider',p_provider,
  'account',p_account,'input',p_input_hash,'rows',classified)::text,'UTF8')),'hex');
 INSERT INTO public.contact_migration_jobs(id,workspace_id,actor_id,provider,account,input_hash,revision,state,payload,total,new_count,existing_count,excluded_count)
 VALUES(p_id,p_workspace_id,p_actor_id,p_provider,p_account,p_input_hash,revision_hash,'prepared',classified,jsonb_array_length(classified),new_rows,existing_rows,excluded_rows);
 RETURN public.read_contact_migration(p_workspace_id,p_actor_id,p_id,0);
END $$;

CREATE FUNCTION public.confirm_contact_migration(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_revision text,p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.contact_migration_jobs;item jsonb;contact uuid;receipt jsonb='[]'::jsonb;
BEGIN
 IF p_id IS NULL OR p_revision IS NULL OR p_revision !~ '^[0-9a-f]{64}$' OR p_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 SELECT * INTO job FROM public.contact_migration_jobs WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact_migration_not_found';END IF;
 IF job.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'contact_migration_changed';END IF;
 IF job.state='completed' THEN RETURN public.read_contact_migration(p_workspace_id,p_actor_id,p_id,0);END IF;
 IF job.state='expired' OR job.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'contact_migration_expired';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,true);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-identity:'||p_workspace_id::text,0));
 -- Re-read the cohort before any contact INSERT. Drift requires a fresh review.
 IF public.classify_contact_migration(p_workspace_id,job.provider,job.account,job.payload) IS DISTINCT FROM job.payload THEN RAISE EXCEPTION 'contact_migration_changed';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(job.payload) ORDER BY (value->>'row')::integer LOOP
  contact=NULL;
  IF item->>'state'='new' THEN
   INSERT INTO public.contacts(workspace_id,channel,external_id,wa_id,phone,name,email,company,phone_origen,email_origen,union_bloqueada,opted_out,opted_out_at,opted_out_reason)
   VALUES(p_workspace_id,'whatsapp',NULL,NULL,item->>'phone',NULLIF(item->>'name',''),NULLIF(item->>'email',''),NULLIF(item->>'company',''),
    'afirmado',CASE WHEN item->>'email'<>'' THEN 'afirmado' END,true,true,clock_timestamp(),'migration_consent_unverified') RETURNING id INTO contact;
   INSERT INTO public.contact_migration_sources(workspace_id,provider,account,source_hash,source_id,phone_key,job_id,contact_id)
   VALUES(p_workspace_id,job.provider,job.account,encode(pg_catalog.sha256(convert_to(item->>'sourceId','UTF8')),'hex'),item->>'sourceId',substring(item->>'phone' FROM 2),p_id,contact);
  END IF;
 END LOOP;
 -- One aggregation avoids repeatedly copying a 5,000-row JSON array.
 -- Receipt keeps outcomes/source references, not copied names or emails.
 SELECT jsonb_agg(jsonb_build_object('row',(r.value->>'row')::integer,'sourceId',r.value->>'sourceId',
  'state',CASE WHEN r.value->>'state'='new' THEN 'created' ELSE r.value->>'state' END,'issues',r.value->'issues',
  'contact_id',CASE WHEN r.value->>'state'='new' THEN s.contact_id END) ORDER BY (r.value->>'row')::integer)
 INTO receipt FROM jsonb_array_elements(job.payload) r LEFT JOIN public.contact_migration_sources s
 ON s.workspace_id=p_workspace_id AND s.provider=job.provider AND s.account=job.account AND s.job_id=p_id
 AND s.source_hash=encode(pg_catalog.sha256(convert_to(r.value->>'sourceId','UTF8')),'hex');
 UPDATE public.contact_migration_jobs SET state='completed',payload=NULL,results=receipt,created_count=new_count,completed_at=clock_timestamp() WHERE id=p_id;
 RETURN public.read_contact_migration(p_workspace_id,p_actor_id,p_id,0);
END $$;

CREATE FUNCTION public.read_contact_migration_results(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_after integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.contact_migration_jobs;rows jsonb;last_row integer;next_row integer;
BEGIN
 IF p_id IS NULL OR p_after IS NULL OR p_after NOT BETWEEN 0 AND 5001 THEN RAISE EXCEPTION 'invalid_contact_migration';END IF;
 PERFORM public.contact_migration_guard(p_workspace_id,p_actor_id,false);
 SELECT * INTO job FROM public.contact_migration_jobs WHERE id=p_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact_migration_not_found';END IF;
 IF job.state IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'contact_migration_changed';END IF;
 IF job.results IS NULL THEN RAISE EXCEPTION 'contact_migration_expired';END IF;
 SELECT COALESCE(jsonb_agg(value ORDER BY (value->>'row')::integer),'[]'::jsonb),max((value->>'row')::integer) INTO rows,last_row
 FROM(SELECT value FROM jsonb_array_elements(job.results) WHERE (value->>'row')::integer>p_after ORDER BY (value->>'row')::integer LIMIT 25) page;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(job.results) WHERE (value->>'row')::integer>last_row) THEN next_row=last_row;END IF;
 RETURN jsonb_build_object('id',job.id,'workspace_id',job.workspace_id,'actor_id',job.actor_id,'revision',job.revision,'total',job.total,'rows',rows,'next',next_row);
END $$;

REVOKE ALL ON FUNCTION public.classify_contact_migration(uuid,text,text,jsonb),public.prepare_contact_migration(uuid,uuid,uuid,text,text,text,jsonb),
 public.confirm_contact_migration(uuid,uuid,uuid,text,boolean),public.read_contact_migration_results(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.classify_contact_migration(uuid,text,text,jsonb),public.prepare_contact_migration(uuid,uuid,uuid,text,text,text,jsonb),
 public.confirm_contact_migration(uuid,uuid,uuid,text,boolean),public.read_contact_migration_results(uuid,uuid,uuid,integer) TO service_role;

CREATE FUNCTION public.contact_migration_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='public.contact_migration_jobs'::regclass AND c.relrowsecurity)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='public.contact_migration_sources'::regclass AND c.relrowsecurity)
 AND NOT has_table_privilege('anon','public.contact_migration_jobs','SELECT') AND NOT has_table_privilege('authenticated','public.contact_migration_jobs','SELECT')
 AND NOT has_table_privilege('service_role','public.contact_migration_jobs','INSERT')
 AND NOT has_table_privilege('anon','public.contact_migration_sources','SELECT') AND NOT has_table_privilege('authenticated','public.contact_migration_sources','SELECT')
 AND NOT has_table_privilege('service_role','public.contact_migration_sources','INSERT')
 AND NOT has_function_privilege('anon','public.confirm_contact_migration(uuid,uuid,uuid,text,boolean)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.prepare_contact_migration(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE')
 AND (SELECT count(*)=7 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND
  NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')) FROM pg_catalog.pg_proc p WHERE p.oid=ANY(ARRAY[
  'public.contact_migration_guard(uuid,uuid,boolean)'::regprocedure,'public.classify_contact_migration(uuid,text,text,jsonb)'::regprocedure,
  'public.prepare_contact_migration(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure,'public.confirm_contact_migration(uuid,uuid,uuid,text,boolean)'::regprocedure,
  'public.read_contact_migration(uuid,uuid,uuid,integer)'::regprocedure,'public.read_contact_migration_results(uuid,uuid,uuid,integer)'::regprocedure,
  pg_catalog.to_regprocedure('public.purge_contact_migration_payloads()')]));
$$;
REVOKE ALL ON FUNCTION public.contact_migration_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contact_migration_ready() TO service_role;

-- Physical deletion follows the existing daily privacy sweep. Read access and
-- confirmation expire at 30 minutes independently of that scheduler.
CREATE FUNCTION public.purge_contact_migration_payloads() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cleared integer;
BEGIN
 WITH targets AS (
  SELECT j.id FROM public.contact_migration_jobs j JOIN public.workspaces w ON w.id=j.workspace_id
  WHERE j.state='prepared' AND j.expires_at<=clock_timestamp()
   OR j.results IS NOT NULL AND (j.completed_at<clock_timestamp()-interval '30 days' OR w.deleted_at IS NOT NULL)
   OR j.payload IS NOT NULL AND w.deleted_at IS NOT NULL
  ORDER BY j.prepared_at,j.id LIMIT 500 FOR UPDATE OF j SKIP LOCKED
 ), purged AS (
  UPDATE public.contact_migration_jobs j SET state=CASE WHEN j.state='prepared' THEN 'expired' ELSE j.state END,payload=NULL,results=NULL
  FROM targets t WHERE j.id=t.id RETURNING j.id
 ) SELECT count(*) INTO cleared FROM purged;
 RETURN cleared;
END $$;
REVOKE ALL ON FUNCTION public.purge_contact_migration_payloads() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_contact_migration_payloads() TO service_role;

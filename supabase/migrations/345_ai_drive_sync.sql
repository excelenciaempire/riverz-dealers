CREATE TABLE public.ai_drive_connections (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, account_id text NOT NULL, email text NOT NULL,
 credential_ciphertext text, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('active','disconnected')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.ai_drive_oauth (
 state_hash text PRIMARY KEY CHECK(state_hash ~ '^[0-9a-f]{64}$'),
 cookie_hash text NOT NULL CHECK(cookie_hash ~ '^[0-9a-f]{64}$'),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, verifier_ciphertext text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes', consumed_at timestamptz
);
CREATE TABLE public.ai_drive_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 file_id text NOT NULL CHECK(file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
 connection_revision integer NOT NULL CHECK(connection_revision>0),
 source_id uuid UNIQUE REFERENCES public.ai_document_sources(id) ON DELETE SET NULL,
 source_revision integer, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','ready','failed','removed','denied')),
 lease_id uuid, lease_until timestamptz,
 next_sync_at timestamptz NOT NULL DEFAULT clock_timestamp(), verified_until timestamptz,
 remote_version text, remote_modified_at timestamptz, synced_at timestamptz, error_code text,
 UNIQUE(workspace_id,agent_id,file_id)
);
CREATE INDEX ai_drive_sync_due ON public.ai_drive_sources(next_sync_at) WHERE state<>'removed';
ALTER TABLE public.ai_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_drive_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_drive_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_drive_connections,public.ai_drive_oauth,public.ai_drive_sources FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ai_drive_connections,public.ai_drive_oauth,public.ai_drive_sources TO service_role;

CREATE FUNCTION public.ai_drive_admin(p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_workspace_id IS NOT NULL AND p_actor_id IS NOT NULL AND p_agent_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id
 AND role IN ('owner','admin') AND (allowed_sections IS NULL OR to_jsonb(allowed_sections) ? '/asistente'));
$$;
REVOKE ALL ON FUNCTION public.ai_drive_admin(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_drive_admin(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.start_ai_drive_oauth(p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid,p_state_hash text,p_cookie_hash text,p_verifier_ciphertext text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.ai_drive_admin(p_workspace_id,p_actor_id,p_agent_id) THEN RAISE EXCEPTION 'document_admin_required';END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' OR p_cookie_hash IS NULL OR p_cookie_hash !~ '^[0-9a-f]{64}$'
 OR p_verifier_ciphertext IS NULL OR length(p_verifier_ciphertext) NOT BETWEEN 10 AND 4096 THEN RAISE EXCEPTION 'document_invalid';END IF;
 DELETE FROM public.ai_drive_oauth WHERE expires_at<clock_timestamp()-interval '1 day';
 INSERT INTO public.ai_drive_oauth(state_hash,cookie_hash,workspace_id,agent_id,actor_id,verifier_ciphertext)
 VALUES(p_state_hash,p_cookie_hash,p_workspace_id,p_agent_id,p_actor_id,p_verifier_ciphertext);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.start_ai_drive_oauth(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_ai_drive_oauth(uuid,uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.consume_ai_drive_oauth(p_actor_id uuid,p_state_hash text,p_cookie_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.ai_drive_oauth;
BEGIN
 SELECT * INTO s FROM public.ai_drive_oauth WHERE state_hash=p_state_hash FOR UPDATE;
 IF NOT FOUND OR s.actor_id IS DISTINCT FROM p_actor_id OR s.cookie_hash IS DISTINCT FROM p_cookie_hash
 OR s.consumed_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR NOT public.ai_drive_admin(s.workspace_id,p_actor_id,s.agent_id) THEN RAISE EXCEPTION 'invalid_document_context';END IF;
 IF NOT public.workspace_billing_write_allowed(s.workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 UPDATE public.ai_drive_oauth SET consumed_at=clock_timestamp() WHERE state_hash=s.state_hash;
 RETURN jsonb_build_object('workspace_id',s.workspace_id,'agent_id',s.agent_id,'verifier_ciphertext',s.verifier_ciphertext);
END $$;
REVOKE ALL ON FUNCTION public.consume_ai_drive_oauth(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_drive_oauth(uuid,text,text) TO service_role;

CREATE FUNCTION public.connect_ai_drive(p_actor_id uuid,p_state_hash text,p_account_id text,p_email text,p_credential_ciphertext text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.ai_drive_oauth;c public.ai_drive_connections;new_revision integer;link record;
BEGIN
 SELECT * INTO s FROM public.ai_drive_oauth WHERE state_hash=p_state_hash FOR UPDATE;
 IF NOT FOUND OR s.actor_id IS DISTINCT FROM p_actor_id OR s.consumed_at IS NULL OR s.consumed_at<clock_timestamp()-interval '2 minutes'
 OR NOT public.ai_drive_admin(s.workspace_id,p_actor_id,s.agent_id) THEN RAISE EXCEPTION 'invalid_document_context';END IF;
 IF NOT public.workspace_billing_write_allowed(s.workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_account_id IS NULL OR length(p_account_id) NOT BETWEEN 1 AND 255 OR p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 255
 OR p_credential_ciphertext IS NULL OR length(p_credential_ciphertext) NOT BETWEEN 10 AND 65536 THEN RAISE EXCEPTION 'document_invalid';END IF;
 PERFORM 1 FROM public.workspaces WHERE id=s.workspace_id FOR UPDATE;
 SELECT * INTO c FROM public.ai_drive_connections WHERE workspace_id=s.workspace_id FOR UPDATE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=s.workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND OR NOT public.ai_drive_admin(s.workspace_id,p_actor_id,s.agent_id) THEN RAISE EXCEPTION 'document_admin_required';END IF;
 new_revision=COALESCE(c.revision,0)+1;
 -- A changed account never inherits the previous account's selected sources or activation.
 FOR link IN SELECT d.* FROM public.ai_drive_sources d WHERE d.workspace_id=s.workspace_id AND d.state<>'removed' FOR UPDATE LOOP
  IF c.account_id IS DISTINCT FROM p_account_id THEN
   UPDATE public.ai_drive_sources SET state='removed',revision=revision+1,lease_id=NULL,lease_until=NULL,verified_until=NULL WHERE id=link.id;
   UPDATE public.ai_document_sources SET status='withdrawn',revision=revision+1,updated_at=clock_timestamp(),actor_id=p_actor_id
    WHERE id=link.source_id AND workspace_id=s.workspace_id AND status<>'withdrawn';
  ELSE
   UPDATE public.ai_drive_sources SET state='queued',revision=revision+1,connection_revision=new_revision,lease_id=NULL,lease_until=NULL,
    verified_until=NULL,next_sync_at=clock_timestamp(),error_code=NULL WHERE id=link.id;
  END IF;
 END LOOP;
 INSERT INTO public.ai_drive_connections(workspace_id,actor_id,account_id,email,credential_ciphertext,revision,state)
 VALUES(s.workspace_id,p_actor_id,p_account_id,p_email,p_credential_ciphertext,new_revision,'active')
 ON CONFLICT(workspace_id) DO UPDATE SET actor_id=EXCLUDED.actor_id,account_id=EXCLUDED.account_id,email=EXCLUDED.email,
 credential_ciphertext=EXCLUDED.credential_ciphertext,revision=EXCLUDED.revision,state='active',updated_at=clock_timestamp();
 DELETE FROM public.ai_drive_oauth WHERE state_hash=p_state_hash;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.connect_ai_drive(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.connect_ai_drive(uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.manage_ai_drive_source(p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid,p_action text,
 p_file_id text DEFAULT NULL,p_id uuid DEFAULT NULL,p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ai_drive_connections;d public.ai_drive_sources;answer jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('list','add','remove','retry','disconnect') OR NOT public.ai_drive_admin(p_workspace_id,p_actor_id,p_agent_id)
 THEN RAISE EXCEPTION 'document_admin_required';END IF;
 PERFORM 1 FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id FOR UPDATE;
 SELECT * INTO c FROM public.ai_drive_connections WHERE workspace_id=p_workspace_id FOR UPDATE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND OR NOT public.ai_drive_admin(p_workspace_id,p_actor_id,p_agent_id) THEN RAISE EXCEPTION 'document_admin_required';END IF;
 IF p_action='list' THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',ds.id,'file_id',ds.file_id,'source_id',ds.source_id,'revision',ds.revision,'state',ds.state,
   'name',(SELECT name FROM public.ai_document_sources WHERE id=ds.source_id AND workspace_id=p_workspace_id AND agent_id=p_agent_id),
   'synced_at',ds.synced_at,'remote_modified_at',ds.remote_modified_at,'error_code',ds.error_code) ORDER BY ds.id),'[]') INTO answer
   FROM public.ai_drive_sources ds WHERE ds.workspace_id=p_workspace_id AND ds.agent_id=p_agent_id AND ds.state<>'removed';
  RETURN jsonb_build_object('connected',COALESCE(c.state='active' AND public.ai_drive_admin(p_workspace_id,c.actor_id,p_agent_id),false),
   'email',CASE WHEN c.state='active' AND public.ai_drive_admin(p_workspace_id,c.actor_id,p_agent_id) THEN c.email END,'sources',answer);
 END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_action='disconnect' THEN
  UPDATE public.ai_drive_connections SET state='disconnected',credential_ciphertext=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=p_workspace_id;
  UPDATE public.ai_drive_sources SET state='removed',revision=revision+1,lease_id=NULL,lease_until=NULL,verified_until=NULL WHERE workspace_id=p_workspace_id AND state<>'removed';
  UPDATE public.ai_document_sources s SET status='withdrawn',revision=s.revision+1,updated_at=clock_timestamp(),actor_id=p_actor_id
   WHERE s.workspace_id=p_workspace_id AND s.status<>'withdrawn' AND EXISTS(SELECT 1 FROM public.ai_drive_sources ds WHERE ds.source_id=s.id AND ds.workspace_id=p_workspace_id);
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_action='add' THEN
  IF c.state IS DISTINCT FROM 'active' OR p_file_id IS NULL OR p_file_id !~ '^[A-Za-z0-9_-]{10,200}$' THEN RAISE EXCEPTION 'document_invalid';END IF;
  SELECT * INTO d FROM public.ai_drive_sources WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id AND file_id=p_file_id FOR UPDATE;
  IF FOUND AND d.state<>'removed' THEN RETURN jsonb_build_object('ok',true,'id',d.id,'replayed',true);END IF;
  IF (SELECT count(*) FROM public.ai_drive_sources WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id AND state<>'removed')>=20 THEN RAISE EXCEPTION 'document_limit';END IF;
  INSERT INTO public.ai_drive_sources(workspace_id,agent_id,file_id,connection_revision) VALUES(p_workspace_id,p_agent_id,p_file_id,c.revision)
  ON CONFLICT(workspace_id,agent_id,file_id) DO UPDATE SET state='queued',revision=ai_drive_sources.revision+1,
   connection_revision=EXCLUDED.connection_revision,lease_id=NULL,lease_until=NULL,verified_until=NULL,next_sync_at=clock_timestamp(),error_code=NULL RETURNING * INTO d;
 ELSE
  SELECT * INTO d FROM public.ai_drive_sources WHERE id=p_id AND workspace_id=p_workspace_id AND agent_id=p_agent_id FOR UPDATE;
  IF NOT FOUND OR d.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'document_changed';END IF;
  IF p_action='remove' THEN
   UPDATE public.ai_drive_sources SET state='removed',revision=revision+1,lease_id=NULL,lease_until=NULL,verified_until=NULL WHERE id=d.id;
   UPDATE public.ai_document_sources SET status='withdrawn',revision=revision+1,updated_at=clock_timestamp(),actor_id=p_actor_id
    WHERE id=d.source_id AND workspace_id=p_workspace_id AND status<>'withdrawn';
  ELSE
   IF c.state IS DISTINCT FROM 'active' OR d.state='removed' THEN RAISE EXCEPTION 'document_changed';END IF;
   UPDATE public.ai_drive_sources SET state='queued',revision=revision+1,connection_revision=c.revision,lease_id=NULL,lease_until=NULL,
    verified_until=NULL,next_sync_at=clock_timestamp(),error_code=NULL WHERE id=d.id;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'id',d.id);
END $$;
REVOKE ALL ON FUNCTION public.manage_ai_drive_source(uuid,uuid,uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_ai_drive_source(uuid,uuid,uuid,text,text,uuid,integer) TO service_role;

CREATE FUNCTION public.claim_ai_drive_sources(p_limit integer DEFAULT 6) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE answer jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>6 THEN RAISE EXCEPTION 'document_invalid';END IF;
 WITH due AS (
  SELECT d.id FROM public.ai_drive_sources d JOIN public.ai_drive_connections c ON c.workspace_id=d.workspace_id
  WHERE d.state<>'removed' AND d.next_sync_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<clock_timestamp())
  AND c.state='active' AND c.revision=d.connection_revision AND public.ai_drive_admin(d.workspace_id,c.actor_id,d.agent_id)
  AND public.workspace_billing_write_allowed(d.workspace_id)
  ORDER BY d.next_sync_at,d.id LIMIT p_limit FOR UPDATE OF d SKIP LOCKED
 ), claimed AS (
  UPDATE public.ai_drive_sources d SET state='processing',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',
   source_revision=(SELECT s.revision FROM public.ai_document_sources s WHERE s.id=d.source_id)
  FROM due WHERE d.id=due.id RETURNING d.*
 ) SELECT jsonb_agg(to_jsonb(claimed)||jsonb_build_object('actor_id',c.actor_id,'credential_ciphertext',c.credential_ciphertext)) INTO answer
  FROM claimed JOIN public.ai_drive_connections c ON c.workspace_id=claimed.workspace_id;
 RETURN COALESCE(answer,'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.claim_ai_drive_sources(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_drive_sources(integer) TO service_role;

CREATE FUNCTION public.finish_ai_drive_source(p_id uuid,p_lease_id uuid,p_connection_revision integer,p_document jsonb,p_remote_version text,p_modified_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.ai_drive_sources;c public.ai_drive_connections;s public.ai_document_sources;saved jsonb;
BEGIN
 SELECT * INTO d FROM public.ai_drive_sources WHERE id=p_id;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM public.ai_agents WHERE id=d.agent_id AND workspace_id=d.workspace_id FOR UPDATE;
 SELECT * INTO c FROM public.ai_drive_connections WHERE workspace_id=d.workspace_id FOR SHARE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=d.workspace_id AND user_id=c.actor_id FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO d FROM public.ai_drive_sources WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'processing' OR d.lease_id IS DISTINCT FROM p_lease_id OR d.lease_until<=clock_timestamp()
 OR d.connection_revision IS DISTINCT FROM p_connection_revision THEN RETURN false;END IF;
 IF c.state IS DISTINCT FROM 'active' OR c.revision IS DISTINCT FROM p_connection_revision
 OR NOT public.ai_drive_admin(d.workspace_id,c.actor_id,d.agent_id) THEN RETURN false;END IF;
 IF NOT public.workspace_billing_write_allowed(d.workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_document IS NULL OR jsonb_typeof(p_document)<>'object' OR p_remote_version IS NULL OR p_remote_version !~ '^[0-9]{1,100}$'
 OR p_modified_at IS NULL THEN RAISE EXCEPTION 'document_invalid';END IF;
 IF d.source_id IS NOT NULL THEN
  SELECT * INTO s FROM public.ai_document_sources WHERE id=d.source_id AND workspace_id=d.workspace_id AND agent_id=d.agent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_document_context';END IF;
  IF s.revision IS DISTINCT FROM d.source_revision THEN RAISE EXCEPTION 'document_changed';END IF;
 END IF;
 IF d.source_id IS NULL AND EXISTS(SELECT 1 FROM public.ai_document_sources existing
  WHERE existing.workspace_id=d.workspace_id AND existing.agent_id=d.agent_id AND existing.name=p_document->>'name'
   AND existing.sha256=p_document->>'sha256' AND existing.text=btrim(p_document->>'text')
   AND existing.format=p_document->>'format' AND existing.bytes=(p_document->>'bytes')::integer)
 THEN RAISE EXCEPTION 'document_changed';END IF;
 -- Keep a reviewed local edit while the provider's revision has not changed.
 -- Export metadata can vary without changing text; do not create spurious drafts.
 IF d.source_id IS NULL OR s.name IS DISTINCT FROM p_document->>'name' OR s.format IS DISTINCT FROM p_document->>'format'
 OR (d.remote_version IS DISTINCT FROM p_remote_version AND s.text IS DISTINCT FROM btrim(p_document->>'text')) THEN
  saved=public.manage_ai_document_source(d.workspace_id,c.actor_id,d.agent_id,CASE WHEN d.source_id IS NULL THEN 'create' ELSE 'replace' END,
   d.source_id,s.revision,p_document->>'name',p_document->>'text',p_document->>'format',(p_document->>'bytes')::integer,p_document->>'sha256');
  IF EXISTS(SELECT 1 FROM public.ai_drive_sources WHERE source_id=(saved->>'id')::uuid AND id<>d.id)
  THEN RAISE EXCEPTION 'document_changed';END IF;
  -- Do not take ownership of an unrelated local source returned by import deduplication.
  IF d.source_id IS NULL AND (saved->>'status'<>'draft' OR EXISTS(SELECT 1 FROM public.ai_document_sources WHERE id=(saved->>'id')::uuid AND actor_id IS DISTINCT FROM c.actor_id))
  THEN RAISE EXCEPTION 'document_changed';END IF;
 ELSE saved=to_jsonb(s);END IF;
 UPDATE public.ai_drive_sources SET state='ready',source_id=(saved->>'id')::uuid,source_revision=(saved->>'revision')::integer,
  remote_version=p_remote_version,remote_modified_at=p_modified_at,synced_at=clock_timestamp(),verified_until=clock_timestamp()+interval '20 minutes',
  next_sync_at=clock_timestamp()+interval '15 minutes',lease_id=NULL,lease_until=NULL,error_code=NULL WHERE id=d.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_ai_drive_source(uuid,uuid,integer,jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_ai_drive_source(uuid,uuid,integer,jsonb,text,timestamptz) TO service_role;

CREATE FUNCTION public.fail_ai_drive_source(p_id uuid,p_lease_id uuid,p_error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.ai_drive_sources;
BEGIN
 IF p_error_code IS NULL OR p_error_code NOT IN ('drive_denied','drive_unavailable','drive_changed','drive_unsupported','document_too_large',
 'document_no_text','document_text_limit','document_formulas','document_unreadable','document_invalid','document_changed','document_limit','document_busy','subscription_read_only')
 THEN RAISE EXCEPTION 'document_invalid';END IF;
 SELECT * INTO d FROM public.ai_drive_sources WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'processing' OR d.lease_id IS DISTINCT FROM p_lease_id THEN RETURN false;END IF;
 UPDATE public.ai_drive_sources SET state=CASE WHEN p_error_code='drive_denied' THEN 'denied' ELSE 'failed' END,
  error_code=p_error_code,verified_until=NULL,lease_id=NULL,lease_until=NULL,next_sync_at=clock_timestamp()+interval '15 minutes' WHERE id=d.id;
 IF p_error_code='drive_denied' THEN
  UPDATE public.ai_document_sources SET status='withdrawn',revision=revision+1,updated_at=clock_timestamp(),actor_id=NULL
   WHERE id=d.source_id AND workspace_id=d.workspace_id AND status<>'withdrawn';
  UPDATE public.ai_drive_sources SET source_revision=(SELECT revision FROM public.ai_document_sources WHERE id=d.source_id) WHERE id=d.id;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fail_ai_drive_source(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_ai_drive_source(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.update_ai_drive_credentials(p_id uuid,p_lease_id uuid,p_connection_revision integer,p_previous text,p_next text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.ai_drive_sources;c public.ai_drive_connections;
BEGIN
 IF p_next IS NULL OR length(p_next) NOT BETWEEN 10 AND 65536 THEN RAISE EXCEPTION 'document_invalid';END IF;
 SELECT * INTO d FROM public.ai_drive_sources WHERE id=p_id;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO c FROM public.ai_drive_connections WHERE workspace_id=d.workspace_id FOR UPDATE;
 SELECT * INTO d FROM public.ai_drive_sources WHERE id=p_id FOR SHARE;
 IF d.state<>'processing' OR d.lease_id IS DISTINCT FROM p_lease_id OR d.lease_until<=clock_timestamp()
 OR d.connection_revision IS DISTINCT FROM p_connection_revision OR c.revision IS DISTINCT FROM p_connection_revision
 OR c.state<>'active' OR c.credential_ciphertext IS DISTINCT FROM p_previous
 OR NOT public.ai_drive_admin(d.workspace_id,c.actor_id,d.agent_id) THEN RETURN false;END IF;
 UPDATE public.ai_drive_connections SET credential_ciphertext=p_next,updated_at=clock_timestamp() WHERE workspace_id=d.workspace_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.update_ai_drive_credentials(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_ai_drive_credentials(uuid,uuid,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.active_ai_document_sources(p_workspace_id uuid,p_agent_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM (
  SELECT s.id,s.name,s.format,s.bytes,s.sha256,s.text,s.status,s.revision,s.updated_at
  FROM public.ai_document_sources s JOIN public.ai_agents a ON a.id=s.agent_id AND a.workspace_id=s.workspace_id AND a.deleted_at IS NULL
  WHERE s.workspace_id=p_workspace_id AND s.agent_id=p_agent_id AND s.status='active'
  AND (NOT EXISTS(SELECT 1 FROM public.ai_drive_sources WHERE source_id=s.id)
   OR EXISTS(SELECT 1 FROM public.ai_drive_sources ds JOIN public.ai_drive_connections c ON c.workspace_id=ds.workspace_id
    WHERE ds.source_id=s.id AND ds.workspace_id=p_workspace_id AND ds.agent_id=p_agent_id
    AND ds.state IN ('ready','queued','processing') AND ds.verified_until>clock_timestamp()
    AND c.state='active' AND c.revision=ds.connection_revision AND public.ai_drive_admin(p_workspace_id,c.actor_id,p_agent_id)))
 ) d;
$$;
REVOKE ALL ON FUNCTION public.active_ai_document_sources(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.active_ai_document_sources(uuid,uuid) TO service_role;

CREATE FUNCTION public.ai_drive_sync_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT count(*)=3 AND bool_and(c.relrowsecurity AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND has_table_privilege('service_role',c.oid,'SELECT')
  AND NOT has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE')) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('ai_drive_connections','ai_drive_oauth','ai_drive_sources'))
 AND (SELECT count(*)=10 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""']
  AND NOT has_function_privilege('anon',p.oid,'execute') AND NOT has_function_privilege('authenticated',p.oid,'execute')
  AND has_function_privilege('service_role',p.oid,'execute')) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('ai_drive_admin','start_ai_drive_oauth','consume_ai_drive_oauth','connect_ai_drive','manage_ai_drive_source',
  'claim_ai_drive_sources','finish_ai_drive_source','fail_ai_drive_source','update_ai_drive_credentials','active_ai_document_sources'));
$$;
REVOKE ALL ON FUNCTION public.ai_drive_sync_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_drive_sync_ready() TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_document_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 format text NOT NULL CHECK(format IN ('pdf','docx','xlsx')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 text text NOT NULL CHECK(length(btrim(text)) > 0 AND length(text)<=32000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','withdrawn')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid
);
CREATE INDEX IF NOT EXISTS ai_document_sources_context_idx ON public.ai_document_sources(workspace_id,agent_id,status);
CREATE TABLE IF NOT EXISTS public.ai_document_source_versions (
 source_id uuid NOT NULL REFERENCES public.ai_document_sources(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL,
 name text NOT NULL,
 format text NOT NULL,
 bytes integer NOT NULL,
 sha256 text NOT NULL,
 text text NOT NULL,
 status text NOT NULL,
 actor_id uuid,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_id,revision)
);
ALTER TABLE public.ai_document_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_document_source_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_member_read ON public.ai_document_sources;
CREATE POLICY document_member_read ON public.ai_document_sources FOR SELECT TO authenticated USING (
 public.is_workspace_member(workspace_id) AND EXISTS(SELECT 1 FROM public.ai_agents a WHERE a.id=ai_document_sources.agent_id AND a.workspace_id=ai_document_sources.workspace_id AND a.deleted_at IS NULL)
);
DROP POLICY IF EXISTS document_version_member_read ON public.ai_document_source_versions;
CREATE POLICY document_version_member_read ON public.ai_document_source_versions FOR SELECT TO authenticated USING (
 public.is_workspace_member(workspace_id) AND EXISTS(SELECT 1 FROM public.ai_agents a WHERE a.id=ai_document_source_versions.agent_id AND a.workspace_id=ai_document_source_versions.workspace_id AND a.deleted_at IS NULL)
);
REVOKE ALL ON public.ai_document_sources,public.ai_document_source_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ai_document_sources,public.ai_document_source_versions TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.audit_ai_document_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.ai_document_source_versions(source_id,revision,workspace_id,agent_id,name,format,bytes,sha256,text,status,actor_id,observed_at)
 VALUES(NEW.id,NEW.revision,NEW.workspace_id,NEW.agent_id,NEW.name,NEW.format,NEW.bytes,NEW.sha256,NEW.text,NEW.status,NEW.actor_id,NEW.updated_at);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_document_source_audit ON public.ai_document_sources;
CREATE TRIGGER ai_document_source_audit AFTER INSERT OR UPDATE ON public.ai_document_sources FOR EACH ROW EXECUTE FUNCTION public.audit_ai_document_source();
REVOKE ALL ON FUNCTION public.audit_ai_document_source() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.manage_ai_document_source(
 p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid,p_action text,
 p_source_id uuid DEFAULT NULL,p_revision integer DEFAULT NULL,p_name text DEFAULT NULL,
 p_text text DEFAULT NULL,p_format text DEFAULT NULL,p_bytes integer DEFAULT NULL,p_sha256 text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.ai_document_sources;payload jsonb;n integer;total integer;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_agent_id IS NULL OR p_action IS NULL
 OR p_action NOT IN ('list','history','create','replace','edit','activate','withdraw') THEN RAISE EXCEPTION 'invalid_document_context';END IF;
 -- A per-agent lock serializes version edits and the combined active-text budget.
 PERFORM 1 FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_document_context';END IF;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_document_context';END IF;
 IF p_action='list' THEN
  SELECT COALESCE(jsonb_agg(to_jsonb(d)-'workspace_id'-'agent_id'-'actor_id' ORDER BY d.updated_at DESC,d.id),'[]'::jsonb) INTO payload
  FROM public.ai_document_sources d WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id;
  RETURN jsonb_build_object('sources',payload);
 END IF;
 IF p_action<>'create' THEN
  SELECT * INTO s FROM public.ai_document_sources WHERE id=p_source_id AND workspace_id=p_workspace_id AND agent_id=p_agent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_document_context';END IF;
 END IF;
 IF p_action='history' THEN
  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.revision DESC),'[]'::jsonb) INTO payload FROM (
   SELECT revision,name,status,sha256,observed_at FROM public.ai_document_source_versions WHERE source_id=s.id AND workspace_id=p_workspace_id AND agent_id=p_agent_id ORDER BY revision DESC LIMIT 50
  ) v;
  RETURN jsonb_build_object('history',payload);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'document_admin_required';END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_action IN ('create','replace') THEN
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160 OR p_name ~ '[\x00-\x1f/\\]'
    OR p_text IS NULL OR length(btrim(p_text))=0 OR length(p_text)>32000
    OR p_format IS NULL OR p_format NOT IN ('pdf','docx','xlsx') OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 5242880
    OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'document_invalid';END IF;
  IF p_action='create' THEN
   SELECT * INTO s FROM public.ai_document_sources WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id AND name=btrim(p_name) AND sha256=p_sha256 AND text=btrim(p_text) AND format=p_format AND bytes=p_bytes ORDER BY id LIMIT 1;
   IF FOUND THEN RETURN to_jsonb(s)-'workspace_id'-'agent_id'-'actor_id';END IF;
   SELECT count(*) INTO n FROM public.ai_document_sources WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id;
   IF n>=20 THEN RAISE EXCEPTION 'document_limit';END IF;
   INSERT INTO public.ai_document_sources(workspace_id,agent_id,name,format,bytes,sha256,text,actor_id)
    VALUES(p_workspace_id,p_agent_id,btrim(p_name),p_format,p_bytes,p_sha256,btrim(p_text),p_actor_id) RETURNING * INTO s;
  ELSE
   IF p_revision IS NULL OR p_revision<>s.revision THEN RAISE EXCEPTION 'document_changed';END IF;
   UPDATE public.ai_document_sources SET name=btrim(p_name),format=p_format,bytes=p_bytes,sha256=p_sha256,text=btrim(p_text),status='draft',revision=revision+1,updated_at=clock_timestamp(),actor_id=p_actor_id WHERE id=s.id RETURNING * INTO s;
  END IF;
 ELSE
  IF p_revision IS NULL OR p_revision<>s.revision THEN RAISE EXCEPTION 'document_changed';END IF;
  IF p_action='edit' THEN
   IF p_text IS NULL OR length(btrim(p_text))=0 OR length(p_text)>32000 THEN RAISE EXCEPTION 'document_invalid';END IF;
   IF s.text=btrim(p_text) THEN RETURN to_jsonb(s)-'workspace_id'-'agent_id'-'actor_id';END IF;
   UPDATE public.ai_document_sources SET text=btrim(p_text),status='draft',revision=revision+1,updated_at=clock_timestamp(),actor_id=p_actor_id WHERE id=s.id RETURNING * INTO s;
  ELSIF p_action='activate' THEN
   IF s.status='active' THEN RETURN to_jsonb(s)-'workspace_id'-'agent_id'-'actor_id';END IF;
   SELECT count(*),COALESCE(sum(octet_length(text)),0) INTO n,total FROM public.ai_document_sources
    WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id AND status='active' AND id<>s.id;
   IF n>=10 OR total+octet_length(s.text)>48000 THEN RAISE EXCEPTION 'document_limit';END IF;
   UPDATE public.ai_document_sources SET status='active',revision=revision+1,updated_at=clock_timestamp(),actor_id=p_actor_id WHERE id=s.id RETURNING * INTO s;
  ELSE
   IF s.status='withdrawn' THEN RETURN to_jsonb(s)-'workspace_id'-'agent_id'-'actor_id';END IF;
   UPDATE public.ai_document_sources SET status='withdrawn',revision=revision+1,updated_at=clock_timestamp(),actor_id=p_actor_id WHERE id=s.id RETURNING * INTO s;
  END IF;
 END IF;
 RETURN to_jsonb(s)-'workspace_id'-'agent_id'-'actor_id';
END $$;
REVOKE ALL ON FUNCTION public.manage_ai_document_source(uuid,uuid,uuid,text,uuid,integer,text,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_ai_document_source(uuid,uuid,uuid,text,uuid,integer,text,text,text,integer,text) TO service_role;

-- A single statement checks the agent binding and returns only currently active versions.
CREATE OR REPLACE FUNCTION public.active_ai_document_sources(p_workspace_id uuid,p_agent_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM (
  SELECT s.id,s.name,s.format,s.bytes,s.sha256,s.text,s.status,s.revision,s.updated_at
  FROM public.ai_document_sources s JOIN public.ai_agents a ON a.id=s.agent_id AND a.workspace_id=s.workspace_id AND a.deleted_at IS NULL
  WHERE s.workspace_id=p_workspace_id AND s.agent_id=p_agent_id AND s.status='active'
 ) d;
$$;
REVOKE ALL ON FUNCTION public.active_ai_document_sources(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.active_ai_document_sources(uuid,uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.http_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=16384),
 credential_ciphertext text CHECK(credential_ciphertext IS NULL OR (length(credential_ciphertext)<=20000 AND credential_ciphertext ~ '^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$')),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','withdrawn')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 actor_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS http_actions_workspace_idx ON public.http_actions(workspace_id,state);
CREATE TABLE IF NOT EXISTS public.http_action_versions (
 action_id uuid NOT NULL REFERENCES public.http_actions(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 definition jsonb NOT NULL,
 state text NOT NULL,
 credential_present boolean NOT NULL,
 actor_id uuid NOT NULL,
 observed_at timestamptz NOT NULL,
 PRIMARY KEY(action_id,revision)
);
ALTER TABLE public.http_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.http_action_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.http_actions,public.http_action_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.http_actions,public.http_action_versions TO service_role;

CREATE OR REPLACE FUNCTION public.audit_http_action_configuration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.http_action_versions(action_id,workspace_id,revision,definition,state,credential_present,actor_id,observed_at)
 VALUES(NEW.id,NEW.workspace_id,NEW.revision,NEW.definition,NEW.state,NEW.credential_ciphertext IS NOT NULL,NEW.actor_id,NEW.updated_at);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS http_action_configuration_audit ON public.http_actions;
CREATE TRIGGER http_action_configuration_audit AFTER INSERT OR UPDATE ON public.http_actions FOR EACH ROW EXECUTE FUNCTION public.audit_http_action_configuration();
REVOKE ALL ON FUNCTION public.audit_http_action_configuration() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.manage_http_action(
 p_workspace_id uuid,p_actor_id uuid,p_operation text,p_action_id uuid DEFAULT NULL,
 p_revision integer DEFAULT NULL,p_definition jsonb DEFAULT NULL,p_ciphertext text DEFAULT NULL,p_replace_credential boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.http_actions;owner_id uuid;member_role text;sections jsonb;payload jsonb;kind text;sealed text;n integer;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('list','history','create','save','activate','withdraw')
 THEN RAISE EXCEPTION 'invalid_http_action_context';END IF;
 SELECT w.owner_id INTO owner_id FROM public.workspaces w WHERE w.id=p_workspace_id AND w.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_action_context';END IF;
 IF owner_id IS DISTINCT FROM p_actor_id THEN
  SELECT m.role,to_jsonb(m.allowed_sections) INTO member_role,sections FROM public.workspace_members m WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id FOR SHARE;
  IF NOT FOUND OR member_role IS NULL OR member_role NOT IN ('admin','owner') OR (sections IS NOT NULL AND (jsonb_typeof(sections)<>'array' OR NOT (sections ? '/ajustes'))) THEN RAISE EXCEPTION 'http_action_admin_required';END IF;
 END IF;
 IF p_operation='list' THEN
  SELECT COALESCE(jsonb_agg((to_jsonb(h)-'workspace_id'-'actor_id'-'credential_ciphertext')||jsonb_build_object('has_secret',h.credential_ciphertext IS NOT NULL) ORDER BY h.updated_at DESC,h.id),'[]'::jsonb)
  INTO payload FROM public.http_actions h WHERE h.workspace_id=p_workspace_id;
  RETURN jsonb_build_object('actions',payload);
 END IF;
 -- Serialize the workspace budget as well as writes to an individual action.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('http-actions:'||p_workspace_id::text,0));
 IF p_operation<>'create' THEN
  SELECT * INTO a FROM public.http_actions WHERE id=p_action_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_http_action_context';END IF;
 END IF;
 IF p_operation='history' THEN
  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.revision DESC),'[]'::jsonb) INTO payload FROM (
   SELECT revision,definition,state,credential_present,observed_at FROM public.http_action_versions WHERE action_id=a.id AND workspace_id=p_workspace_id ORDER BY revision DESC LIMIT 50
  ) v;RETURN jsonb_build_object('history',payload);
 END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_operation<>'create' AND (p_revision IS NULL OR p_revision<>a.revision) THEN RAISE EXCEPTION 'http_action_changed';END IF;
 IF p_operation IN ('create','save') THEN
  IF p_definition IS NULL OR jsonb_typeof(p_definition)<>'object' OR octet_length(p_definition::text)>16384
   OR p_definition->>'method' IS NULL OR p_definition->>'method' NOT IN ('GET','POST')
   OR p_definition->>'credential_kind' IS NULL OR p_definition->>'credential_kind' NOT IN ('none','bearer','api-key')
   OR p_definition->>'name' IS NULL OR length(btrim(p_definition->>'name')) NOT BETWEEN 1 AND 80
   OR p_definition->>'url' IS NULL OR length(p_definition->>'url')>2048 OR p_definition->>'url' !~ '^https://'
  THEN RAISE EXCEPTION 'http_action_invalid';END IF;
  kind=p_definition->>'credential_kind';
  sealed=CASE WHEN kind='none' THEN NULL WHEN p_operation='create' OR p_replace_credential THEN p_ciphertext ELSE a.credential_ciphertext END;
  IF kind<>'none' AND (sealed IS NULL OR length(sealed)>20000 OR sealed !~ '^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$') THEN RAISE EXCEPTION 'http_action_credential_required';END IF;
  IF p_operation='create' THEN
   IF p_action_id IS NULL OR p_revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'http_action_invalid';END IF;
   SELECT count(*) INTO n FROM public.http_actions WHERE workspace_id=p_workspace_id;
   IF n>=20 THEN RAISE EXCEPTION 'http_action_limit';END IF;
   INSERT INTO public.http_actions(id,workspace_id,definition,credential_ciphertext,actor_id) VALUES(p_action_id,p_workspace_id,p_definition,sealed,p_actor_id) RETURNING * INTO a;
  ELSE
   UPDATE public.http_actions SET definition=p_definition,credential_ciphertext=sealed,state='draft',revision=revision+1,actor_id=p_actor_id,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
  END IF;
 ELSE
  IF p_operation='activate' AND a.definition->>'credential_kind'<>'none' AND a.credential_ciphertext IS NULL THEN RAISE EXCEPTION 'http_action_credential_required';END IF;
  IF a.state<>(CASE WHEN p_operation='activate' THEN 'active' ELSE 'withdrawn' END) THEN
   UPDATE public.http_actions SET state=CASE WHEN p_operation='activate' THEN 'active' ELSE 'withdrawn' END,revision=revision+1,actor_id=p_actor_id,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
  END IF;
 END IF;
 RETURN (to_jsonb(a)-'workspace_id'-'actor_id'-'credential_ciphertext')||jsonb_build_object('has_secret',a.credential_ciphertext IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.manage_http_action(uuid,uuid,text,uuid,integer,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_http_action(uuid,uuid,text,uuid,integer,jsonb,text,boolean) TO service_role;

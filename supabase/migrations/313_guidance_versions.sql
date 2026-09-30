-- Preserve existing live rules and every current source of supervised knowledge.
ALTER TABLE public.agent_guidance DROP CONSTRAINT IF EXISTS agent_guidance_origen_check;
ALTER TABLE public.agent_guidance ADD CONSTRAINT agent_guidance_origen_check CHECK(origen IN ('comercio','pliego','base','hueco'));
ALTER TABLE public.agent_guidance ADD COLUMN IF NOT EXISTS live_revision integer NOT NULL DEFAULT 1 CHECK(live_revision>0);
CREATE TABLE IF NOT EXISTS public.guidance_live_versions (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(rule_id,revision)
);
CREATE TABLE IF NOT EXISTS public.guidance_drafts (
  rule_id uuid PRIMARY KEY REFERENCES public.agent_guidance(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  base_revision integer NOT NULL,
  draft_revision integer NOT NULL DEFAULT 1 CHECK(draft_revision>0),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','test')),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.guidance_live_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guidance_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guidance_live_versions,public.guidance_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.guidance_live_versions,public.guidance_drafts TO authenticated;
GRANT ALL ON public.guidance_live_versions,public.guidance_drafts TO service_role;
DROP POLICY IF EXISTS guidance_versions_read ON public.guidance_live_versions;
CREATE POLICY guidance_versions_read ON public.guidance_live_versions FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS guidance_drafts_read ON public.guidance_drafts;
CREATE POLICY guidance_drafts_read ON public.guidance_drafts FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION public.guidance_snapshot(r public.agent_guidance) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('titulo',r.titulo,'cuando',r.cuando,'hacer',r.hacer,'activa',r.activa,'agent_id',r.agent_id,'orden',r.orden,'origen',r.origen,'clave',r.clave)
$$;
CREATE OR REPLACE FUNCTION public.guidance_version_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws uuid;changes boolean;global_count integer;
BEGIN
 ws=CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws) THEN RETURN OLD;END IF;
 IF TG_OP='INSERT' THEN changes=true;NEW.live_revision=1;
 ELSIF TG_OP='DELETE' THEN changes=true;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
  changes=public.guidance_snapshot(NEW) IS DISTINCT FROM public.guidance_snapshot(OLD);
  NEW.live_revision=OLD.live_revision+CASE WHEN changes THEN 1 ELSE 0 END;
 END IF;
 IF changes AND current_user IN ('authenticated','anon') AND NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=auth.uid() AND m.role IN ('owner','admin')) THEN RAISE EXCEPTION 'guidance_admin_required';END IF;
 IF changes AND (TG_OP<>'DELETE' OR current_user IN ('authenticated','anon')) AND public.workspace_billing_write_allowed(ws) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ai_agents a WHERE a.id=NEW.agent_id AND a.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'invalid_guidance_agent';END IF;
 IF NEW.activa AND (TG_OP='INSERT' OR NOT OLD.activa OR NEW.agent_id IS DISTINCT FROM OLD.agent_id) THEN
  PERFORM 1 FROM public.workspaces WHERE id=ws FOR UPDATE;
  SELECT count(*) INTO global_count FROM public.agent_guidance WHERE workspace_id=ws AND activa AND agent_id IS NULL AND id<>NEW.id;
  IF NEW.agent_id IS NULL THEN
   IF global_count>=50 OR EXISTS(SELECT 1 FROM public.agent_guidance WHERE workspace_id=ws AND activa AND agent_id IS NOT NULL AND id<>NEW.id GROUP BY agent_id HAVING count(*)+global_count>=50) THEN RAISE EXCEPTION 'guidance_capacity';END IF;
  ELSIF global_count+(SELECT count(*) FROM public.agent_guidance WHERE workspace_id=ws AND activa AND agent_id=NEW.agent_id AND id<>NEW.id)>=50 THEN RAISE EXCEPTION 'guidance_capacity';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guidance_version_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor=coalesce(nullif(current_setting('riverz.guidance_actor',true),'')::uuid,auth.uid());
 IF actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN actor=NULL;END IF;
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id) THEN RETURN NULL;END IF;
  INSERT INTO public.guidance_live_versions(workspace_id,rule_id,revision,snapshot,actor_id,source)
   VALUES(OLD.workspace_id,OLD.id,OLD.live_revision+1,public.guidance_snapshot(OLD)||jsonb_build_object('deleted',true),actor,'delete');
 ELSIF TG_OP='INSERT' OR NEW.live_revision<>OLD.live_revision THEN
  INSERT INTO public.guidance_live_versions(workspace_id,rule_id,revision,snapshot,actor_id,source)
   VALUES(NEW.workspace_id,NEW.id,NEW.live_revision,public.guidance_snapshot(NEW),actor,NEW.origen);
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS guidance_version_before ON public.agent_guidance;
CREATE TRIGGER guidance_version_before BEFORE INSERT OR UPDATE OR DELETE ON public.agent_guidance FOR EACH ROW EXECUTE FUNCTION public.guidance_version_before();
DROP TRIGGER IF EXISTS guidance_version_after ON public.agent_guidance;
CREATE TRIGGER guidance_version_after AFTER INSERT OR UPDATE OR DELETE ON public.agent_guidance FOR EACH ROW EXECUTE FUNCTION public.guidance_version_after();
INSERT INTO public.guidance_live_versions(workspace_id,rule_id,revision,snapshot,source)
 SELECT workspace_id,id,live_revision,public.guidance_snapshot(g),'baseline' FROM public.agent_guidance g ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_guidance_draft(p_workspace_id uuid,p_rule_id uuid,p_actor_id uuid,p_live_revision integer,p_draft_revision integer,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.agent_guidance;d public.guidance_drafts;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 SELECT * INTO r FROM public.agent_guidance WHERE id=p_rule_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 IF r.live_revision IS DISTINCT FROM p_live_revision THEN RAISE EXCEPTION 'guidance_changed';END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR (p_snapshot-'titulo'-'cuando'-'hacer')<>'{}'::jsonb
 OR jsonb_typeof(p_snapshot->'titulo') IS DISTINCT FROM 'string' OR length(trim(p_snapshot->>'titulo')) NOT BETWEEN 1 AND 120
 OR jsonb_typeof(p_snapshot->'hacer') IS DISTINCT FROM 'string' OR length(trim(p_snapshot->>'hacer')) NOT BETWEEN 1 AND 4000
 OR (jsonb_typeof(p_snapshot->'cuando') NOT IN ('string','null')) OR length(coalesce(p_snapshot->>'cuando',''))>4000 THEN RAISE EXCEPTION 'invalid_guidance_draft';END IF;
 SELECT * INTO d FROM public.guidance_drafts WHERE rule_id=p_rule_id FOR UPDATE;
 IF FOUND THEN
  IF d.draft_revision IS DISTINCT FROM p_draft_revision THEN RAISE EXCEPTION 'guidance_changed';END IF;
  UPDATE public.guidance_drafts SET snapshot=p_snapshot,base_revision=p_live_revision,draft_revision=draft_revision+1,state='draft',updated_by=p_actor_id,updated_at=now() WHERE rule_id=p_rule_id RETURNING * INTO d;
 ELSE
  IF p_draft_revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'guidance_changed';END IF;
  INSERT INTO public.guidance_drafts(rule_id,workspace_id,base_revision,snapshot,updated_by) VALUES(p_rule_id,p_workspace_id,p_live_revision,p_snapshot,p_actor_id) RETURNING * INTO d;
 END IF;
 RETURN to_jsonb(d);
END $$;
CREATE OR REPLACE FUNCTION public.publish_guidance_draft(p_workspace_id uuid,p_rule_id uuid,p_actor_id uuid,p_live_revision integer,p_draft_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.agent_guidance;d public.guidance_drafts;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'guidance_admin_required';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 SELECT * INTO r FROM public.agent_guidance WHERE id=p_rule_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 SELECT * INTO d FROM public.guidance_drafts WHERE rule_id=p_rule_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR r.live_revision IS DISTINCT FROM p_live_revision OR d.base_revision IS DISTINCT FROM p_live_revision OR d.draft_revision IS DISTINCT FROM p_draft_revision THEN RAISE EXCEPTION 'guidance_changed';END IF;
 PERFORM set_config('riverz.guidance_actor',p_actor_id::text,true);
 UPDATE public.agent_guidance SET titulo=d.snapshot->>'titulo',cuando=d.snapshot->>'cuando',hacer=d.snapshot->>'hacer',activa=true WHERE id=p_rule_id RETURNING * INTO r;
 DELETE FROM public.guidance_drafts WHERE rule_id=p_rule_id;
 RETURN to_jsonb(r);
END $$;
CREATE OR REPLACE FUNCTION public.rollback_guidance_version(p_workspace_id uuid,p_rule_id uuid,p_actor_id uuid,p_live_revision integer,p_target_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.agent_guidance;v public.guidance_live_versions;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'guidance_admin_required';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 SELECT * INTO r FROM public.agent_guidance WHERE id=p_rule_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 IF r.live_revision IS DISTINCT FROM p_live_revision THEN RAISE EXCEPTION 'guidance_changed';END IF;
 SELECT * INTO v FROM public.guidance_live_versions WHERE rule_id=p_rule_id AND workspace_id=p_workspace_id AND revision=p_target_revision;
 IF NOT FOUND OR v.snapshot->'deleted'='true'::jsonb THEN RAISE EXCEPTION 'invalid_guidance_version';END IF;
 PERFORM set_config('riverz.guidance_actor',p_actor_id::text,true);
 UPDATE public.agent_guidance SET titulo=v.snapshot->>'titulo',cuando=v.snapshot->>'cuando',hacer=v.snapshot->>'hacer',activa=(v.snapshot->>'activa')::boolean,
  agent_id=(v.snapshot->>'agent_id')::uuid,orden=(v.snapshot->>'orden')::integer,origen=v.snapshot->>'origen',clave=v.snapshot->>'clave' WHERE id=p_rule_id RETURNING * INTO r;
 -- A draft based on another live version remains visible but cannot publish without a fresh save.
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.save_guidance_draft(uuid,uuid,uuid,integer,integer,jsonb),public.publish_guidance_draft(uuid,uuid,uuid,integer,integer),public.rollback_guidance_version(uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_guidance_draft(uuid,uuid,uuid,integer,integer,jsonb),public.publish_guidance_draft(uuid,uuid,uuid,integer,integer),public.rollback_guidance_version(uuid,uuid,uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.create_guidance_rule(p_workspace_id uuid,p_actor_id uuid,p_id uuid,p_agent_id uuid,p_snapshot jsonb,p_draft boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.agent_guidance;
BEGIN
 IF p_id IS NULL OR p_draft IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND (p_draft OR role IN ('admin','owner'))) THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR (p_snapshot-'titulo'-'cuando'-'hacer')<>'{}'::jsonb
 OR jsonb_typeof(p_snapshot->'titulo') IS DISTINCT FROM 'string' OR length(trim(p_snapshot->>'titulo')) NOT BETWEEN 1 AND 120
 OR jsonb_typeof(p_snapshot->'hacer') IS DISTINCT FROM 'string' OR length(trim(p_snapshot->>'hacer')) NOT BETWEEN 1 AND 4000
 OR jsonb_typeof(p_snapshot->'cuando') NOT IN ('string','null') OR length(coalesce(p_snapshot->>'cuando',''))>4000 THEN RAISE EXCEPTION 'invalid_guidance_draft';END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF (SELECT count(*) FROM public.agent_guidance WHERE workspace_id=p_workspace_id)>=50 THEN RAISE EXCEPTION 'guidance_capacity';END IF;
 PERFORM set_config('riverz.guidance_actor',p_actor_id::text,true);
 INSERT INTO public.agent_guidance(id,workspace_id,agent_id,titulo,cuando,hacer,activa,orden)
 VALUES(p_id,p_workspace_id,p_agent_id,p_snapshot->>'titulo',p_snapshot->>'cuando',p_snapshot->>'hacer',NOT p_draft,(SELECT coalesce(max(orden),-1)+1 FROM public.agent_guidance WHERE workspace_id=p_workspace_id)) RETURNING * INTO r;
 IF p_draft THEN PERFORM public.save_guidance_draft(p_workspace_id,p_id,p_actor_id,r.live_revision,0,p_snapshot);END IF;
 RETURN to_jsonb(r);
END $$;
CREATE OR REPLACE FUNCTION public.discard_guidance_draft(p_workspace_id uuid,p_rule_id uuid,p_actor_id uuid,p_draft_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 PERFORM 1 FROM public.agent_guidance WHERE id=p_rule_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_guidance_context';END IF;
 DELETE FROM public.guidance_drafts WHERE rule_id=p_rule_id AND workspace_id=p_workspace_id AND draft_revision=p_draft_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'guidance_changed';END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.create_guidance_rule(uuid,uuid,uuid,uuid,jsonb,boolean),public.discard_guidance_draft(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_guidance_rule(uuid,uuid,uuid,uuid,jsonb,boolean),public.discard_guidance_draft(uuid,uuid,uuid,integer) TO service_role;

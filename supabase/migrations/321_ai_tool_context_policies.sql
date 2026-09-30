CREATE OR REPLACE FUNCTION public.ai_tool_context_policy_valid(p_policy jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE channel record;tool record;
BEGIN
 IF p_policy IS NULL OR jsonb_typeof(p_policy) IS DISTINCT FROM 'object' OR length(p_policy::text)>32000 THEN RETURN false;END IF;
 FOR channel IN SELECT * FROM jsonb_each(p_policy) LOOP
  IF channel.key NOT IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','webchat') OR jsonb_typeof(channel.value) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  FOR tool IN SELECT * FROM jsonb_each(channel.value) LOOP
   IF tool.key NOT IN ('buscar_producto','ver_producto','crear_checkout','crear_link_de_pago','ofrecer_descuento','crear_pedido','lookup_order','registrar_pago','editar_pedido','cancelar_pedido','reembolsar','abrir_devolucion','escalar_llamada','enviar_proactivo','buscar_en_internet','no_se_la_respuesta','ver_contacto','gestionar_recompra','etiquetar_contacto','cerrar_conversacion')
   OR tool.value NOT IN ('"off"'::jsonb,'"aprobacion"'::jsonb)
   OR (tool.value='"aprobacion"'::jsonb AND tool.key NOT IN ('crear_checkout','crear_link_de_pago','ofrecer_descuento','crear_pedido','registrar_pago','editar_pedido','cancelar_pedido','reembolsar','abrir_devolucion')) THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ai_tool_context_policy_valid(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tool_context_policy_valid(jsonb) TO service_role;
CREATE TABLE IF NOT EXISTS public.ai_tool_context_policies(
 agent_id uuid PRIMARY KEY REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),
 policy jsonb NOT NULL CHECK(public.ai_tool_context_policy_valid(policy)),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_tool_context_policy_versions(
 id uuid PRIMARY KEY,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),
 policy jsonb NOT NULL CHECK(public.ai_tool_context_policy_valid(policy)),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agent_id,revision)
);
ALTER TABLE public.ai_tool_context_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tool_context_policy_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_tool_context_policies,public.ai_tool_context_policy_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_tool_context_policies,public.ai_tool_context_policy_versions TO authenticated;
GRANT ALL ON public.ai_tool_context_policies,public.ai_tool_context_policy_versions TO service_role;
DROP POLICY IF EXISTS ai_tool_context_read ON public.ai_tool_context_policies;
CREATE POLICY ai_tool_context_read ON public.ai_tool_context_policies FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS ai_tool_context_versions_read ON public.ai_tool_context_policy_versions;
CREATE POLICY ai_tool_context_versions_read ON public.ai_tool_context_policy_versions FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));
CREATE OR REPLACE FUNCTION public.ai_tool_context_version_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (to_jsonb(NEW)-'actor_id') IS DISTINCT FROM (to_jsonb(OLD)-'actor_id') OR (NEW.actor_id IS NOT NULL AND NEW.actor_id IS DISTINCT FROM OLD.actor_id) THEN RAISE EXCEPTION 'invalid_tool_context';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_tool_context_version_immutable ON public.ai_tool_context_policy_versions;
CREATE TRIGGER ai_tool_context_version_immutable BEFORE UPDATE ON public.ai_tool_context_policy_versions FOR EACH ROW EXECUTE FUNCTION public.ai_tool_context_version_immutable();
REVOKE ALL ON FUNCTION public.ai_tool_context_version_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tool_context_version_immutable() TO service_role;
CREATE OR REPLACE FUNCTION public.save_ai_tool_context_policy(p_id uuid,p_workspace_id uuid,p_actor_id uuid,p_agent_id uuid,p_expected_revision integer,p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE live public.ai_tool_context_policies;prior public.ai_tool_context_policy_versions;next_revision integer;saved_at timestamptz;
BEGIN
 IF p_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_expected_revision>=1000000 OR public.ai_tool_context_policy_valid(p_policy) IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_tool_context';END IF;
 PERFORM 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_tool_context';END IF;
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id FOR UPDATE;
 PERFORM 1 FROM ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_tool_context';END IF;
 SELECT * INTO live FROM ai_tool_context_policies WHERE agent_id=p_agent_id AND workspace_id=p_workspace_id FOR UPDATE;
 SELECT * INTO prior FROM ai_tool_context_policy_versions WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.agent_id IS DISTINCT FROM p_agent_id OR prior.actor_id IS DISTINCT FROM p_actor_id OR prior.policy IS DISTINCT FROM p_policy OR prior.revision<>p_expected_revision+1 OR live.revision IS DISTINCT FROM prior.revision OR live.policy IS DISTINCT FROM prior.policy THEN RAISE EXCEPTION 'tool_context_changed';END IF;
  RETURN jsonb_build_object('ok',true,'id',prior.id,'created_at',prior.created_at,'revision',live.revision,'policy',live.policy,'replayed',true);
 END IF;
 IF coalesce(live.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'tool_context_changed';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 next_revision=p_expected_revision+1;
 INSERT INTO ai_tool_context_policies(agent_id,workspace_id,revision,policy,updated_by) VALUES(p_agent_id,p_workspace_id,next_revision,p_policy,p_actor_id)
 ON CONFLICT(agent_id) DO UPDATE SET revision=EXCLUDED.revision,policy=EXCLUDED.policy,updated_by=EXCLUDED.updated_by,updated_at=now();
 INSERT INTO ai_tool_context_policy_versions(id,agent_id,workspace_id,revision,policy,actor_id) VALUES(p_id,p_agent_id,p_workspace_id,next_revision,p_policy,p_actor_id) RETURNING created_at INTO saved_at;
 RETURN jsonb_build_object('ok',true,'id',p_id,'created_at',saved_at,'revision',next_revision,'policy',p_policy,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.save_ai_tool_context_policy(uuid,uuid,uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_ai_tool_context_policy(uuid,uuid,uuid,uuid,integer,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';

ALTER TABLE public.conversations ADD COLUMN case_reason_source text CHECK(case_reason_source IN ('manual','assistant'));
-- Extend the current policy validator without editing the applied migration 321.
CREATE OR REPLACE FUNCTION public.ai_tool_context_policy_valid(p_policy jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE channel record;tool record;
BEGIN
 IF p_policy IS NULL OR jsonb_typeof(p_policy) IS DISTINCT FROM 'object' OR length(p_policy::text)>32000 THEN RETURN false;END IF;
 FOR channel IN SELECT * FROM jsonb_each(p_policy) LOOP
  IF channel.key NOT IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','webchat') OR jsonb_typeof(channel.value) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  FOR tool IN SELECT * FROM jsonb_each(channel.value) LOOP
   IF tool.key NOT IN ('buscar_producto','ver_producto','crear_checkout','crear_link_de_pago','ofrecer_descuento','crear_pedido','lookup_order','registrar_pago','editar_pedido','cancelar_pedido','reembolsar','abrir_devolucion','escalar_llamada','enviar_proactivo','buscar_en_internet','no_se_la_respuesta','ver_contacto','gestionar_recompra','etiquetar_contacto','cerrar_conversacion','clasificar_motivo')
   OR tool.value NOT IN ('"off"'::jsonb,'"aprobacion"'::jsonb)
   OR (tool.value='"aprobacion"'::jsonb AND tool.key NOT IN ('crear_checkout','crear_link_de_pago','ofrecer_descuento','crear_pedido','registrar_pago','editar_pedido','cancelar_pedido','reembolsar','abrir_devolucion')) THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ai_tool_context_policy_valid(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tool_context_policy_valid(jsonb) TO service_role;
-- No invented attribution for historical categories.
CREATE TABLE public.assistant_case_reason_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
 message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(reason IN ('purchase','delivery','payment','return','other')),
 quote_hash text NOT NULL CHECK(quote_hash ~ '^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(conversation_id)
);
ALTER TABLE public.assistant_case_reason_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_case_reason_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.assistant_case_reason_events TO service_role;

CREATE FUNCTION public.case_reason_manual_choice() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 -- Service-side manual editors and direct authenticated edits cannot forge assistant provenance.
 IF current_user IN ('authenticated','service_role') AND
  (TG_OP='UPDATE' OR NEW.case_reason IS NOT NULL OR NEW.case_reason_source IS NOT NULL)
 THEN NEW.case_reason_source='manual';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.case_reason_manual_choice() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_reason_manual_choice() TO service_role;
CREATE TRIGGER case_reason_manual_choice BEFORE INSERT OR UPDATE OF case_reason,case_reason_source ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.case_reason_manual_choice();

CREATE FUNCTION public.classify_conversation_reason(p_workspace_id uuid,p_agent_id uuid,p_conversation_id uuid,p_contact_id uuid,p_message_id uuid,p_reason text,p_quote text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.conversations;m public.messages;a public.ai_agents;policy jsonb;
BEGIN
 IF p_reason IS NULL OR p_reason NOT IN ('purchase','delivery','payment','return','other') OR p_quote IS NULL OR length(btrim(p_quote)) NOT BETWEEN 10 AND 500
 THEN RAISE EXCEPTION 'invalid_case_classification';END IF;
 SELECT * INTO a FROM public.ai_agents WHERE id=p_agent_id AND workspace_id=p_workspace_id AND deleted_at IS NULL AND is_active
  AND tools->>'clasificar_motivo'='auto' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL)
 OR public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_case_classification_context';END IF;
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND contact_id=p_contact_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR COALESCE(c.is_spam,false) THEN RAISE EXCEPTION 'invalid_case_classification_context';END IF;
 IF c.channel::text IN ('ig_comment','fb_comment','tiktok_comment','voice')
 OR (c.assigned_ai_agent_id IS NOT NULL AND c.assigned_ai_agent_id<>p_agent_id)
 OR (COALESCE(a.assigned_only,false) AND c.assigned_ai_agent_id IS DISTINCT FROM p_agent_id)
 OR (a.scope::text IS DISTINCT FROM 'workspace' AND NOT EXISTS(SELECT 1 FROM public.ai_agent_channels WHERE agent_id=p_agent_id AND channel=c.channel))
 THEN RAISE EXCEPTION 'invalid_case_classification_context';END IF;
 SELECT p.policy INTO policy FROM public.ai_tool_context_policies p WHERE workspace_id=p_workspace_id AND agent_id=p_agent_id FOR SHARE;
 IF FOUND AND (jsonb_typeof(policy) IS DISTINCT FROM 'object'
  OR (policy ? c.channel::text AND jsonb_typeof(policy->c.channel::text) IS DISTINCT FROM 'object')
  OR policy->c.channel::text ? 'clasificar_motivo') THEN RAISE EXCEPTION 'invalid_case_classification_context';END IF;
 IF c.case_reason IS NOT NULL OR c.case_reason_source='manual' THEN RETURN jsonb_build_object('status','preserved','reason',c.case_reason);END IF;
 SELECT * INTO m FROM public.messages WHERE id=p_message_id AND conversation_id=c.id AND sender_type='customer' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR m.id IS DISTINCT FROM (SELECT id FROM public.messages WHERE conversation_id=c.id AND sender_type='customer' AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1)
 OR NOT (position(btrim(p_quote) IN COALESCE(m.content_text,''))>0 OR position(btrim(p_quote) IN COALESCE(m.media_transcription,''))>0)
 THEN RAISE EXCEPTION 'invalid_case_classification_evidence';END IF;
 IF EXISTS(SELECT 1 FROM public.assistant_case_reason_events WHERE conversation_id=c.id) THEN RETURN jsonb_build_object('status','preserved','reason',c.case_reason);END IF;
 INSERT INTO public.assistant_case_reason_events(workspace_id,conversation_id,agent_id,message_id,reason,quote_hash)
 VALUES(p_workspace_id,c.id,p_agent_id,m.id,p_reason,encode(sha256(convert_to(btrim(p_quote),'UTF8')),'hex'));
 UPDATE public.conversations SET case_reason=p_reason,case_reason_source='assistant' WHERE id=c.id AND workspace_id=p_workspace_id;
 RETURN jsonb_build_object('status','recorded','reason',p_reason);
END $$;
REVOKE ALL ON FUNCTION public.classify_conversation_reason(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.classify_conversation_reason(uuid,uuid,uuid,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.assistant_case_reasons_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.assistant_case_reason_events'::regclass)
 AND NOT has_table_privilege('anon','public.assistant_case_reason_events','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('authenticated','public.assistant_case_reason_events','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('service_role','public.assistant_case_reason_events','INSERT,UPDATE,DELETE')
 AND (SELECT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.classify_conversation_reason(uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure)
 AND NOT has_function_privilege('anon','public.classify_conversation_reason(uuid,uuid,uuid,uuid,uuid,text,text)','execute')
 AND NOT has_function_privilege('authenticated','public.classify_conversation_reason(uuid,uuid,uuid,uuid,uuid,text,text)','execute')
 AND has_function_privilege('service_role','public.classify_conversation_reason(uuid,uuid,uuid,uuid,uuid,text,text)','execute')
 AND (SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.ai_tool_context_policy_valid(jsonb)'::regprocedure)
 AND public.ai_tool_context_policy_valid('{"whatsapp":{"clasificar_motivo":"off"}}')
 AND NOT public.ai_tool_context_policy_valid('{"whatsapp":{"clasificar_motivo":"auto"}}')
 AND NOT public.ai_tool_context_policy_valid('{"whatsapp":{"clasificar_motivo":"aprobacion"}}')
 AND (SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.case_reason_manual_choice()'::regprocedure)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.conversations'::regclass AND tgname='case_reason_manual_choice' AND tgenabled='O');
$$;
REVOKE ALL ON FUNCTION public.assistant_case_reasons_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_case_reasons_ready() TO service_role;

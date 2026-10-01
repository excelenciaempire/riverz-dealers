-- A draft review binds the selected template to the stored recipient snapshot.
-- Neither saving nor reviewing a draft calls a provider.
ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS draft_review jsonb;

CREATE OR REPLACE FUNCTION public.protect_broadcast_draft_review() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user NOT IN ('postgres','service_role','supabase_admin') AND
 ((TG_OP='INSERT' AND NEW.draft_review IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.draft_review IS DISTINCT FROM OLD.draft_review))
 THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_broadcast_draft_review ON public.broadcasts;
CREATE TRIGGER protect_broadcast_draft_review BEFORE INSERT OR UPDATE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION public.protect_broadcast_draft_review();
REVOKE ALL ON FUNCTION public.protect_broadcast_draft_review() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protect_broadcast_draft_review() TO service_role;

CREATE OR REPLACE FUNCTION public.broadcast_draft_config_hash(b public.broadcasts) RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('name',b.name,'template_name',b.template_name,'template_language',b.template_language,
 'voice_note',b.voice_note,'template_variables',b.template_variables,'variable_mapping',b.variable_mapping,
 'audience_filter',b.audience_filter,'scheduled_at',extract(epoch FROM b.scheduled_at),'create_conversations',b.create_conversations)::text,'UTF8')),'hex')
$$;

CREATE OR REPLACE FUNCTION public.save_broadcast_draft(
 p_workspace_id uuid,p_broadcast_id uuid,p_actor_id uuid,p_expected_updated_at timestamptz,
 p_config jsonb,p_recipients jsonb,p_template jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.broadcasts;member_role text;tpl jsonb;rec jsonb;n integer;stamp timestamptz;
BEGIN
 IF p_actor_id IS NULL OR p_expected_updated_at IS NULL OR p_config IS NULL OR jsonb_typeof(p_config)<>'object'
 OR p_recipients IS NULL OR jsonb_typeof(p_recipients)<>'array' OR jsonb_array_length(p_recipients)>10000
 OR length(p_config::text)>300000 OR length(p_recipients::text)>20000000 THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 SELECT role INTO member_role FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 SELECT * INTO b FROM broadcasts WHERE id=p_broadcast_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR (b.user_id<>p_actor_id AND member_role NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 IF b.status<>'draft' OR b.updated_at IS DISTINCT FROM p_expected_updated_at
 OR coalesce(b.sent_count,0)+coalesce(b.delivered_count,0)+coalesce(b.read_count,0)+coalesce(b.replied_count,0)>0
 OR EXISTS(SELECT 1 FROM broadcast_delivery_receipts WHERE broadcast_id=b.id)
 THEN RAISE EXCEPTION 'broadcast_draft_changed'; END IF;
 PERFORM 1 FROM broadcast_recipients WHERE broadcast_id=b.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM broadcast_recipients WHERE broadcast_id=b.id AND (status<>'pending' OR whatsapp_message_id IS NOT NULL)) THEN RAISE EXCEPTION 'broadcast_draft_changed'; END IF;
 IF nullif(trim(p_config->>'name'),'') IS NULL OR length(p_config->>'name')>200
 OR nullif(p_config->>'template_name','') IS NULL OR nullif(p_config->>'template_language','') IS NULL
 OR jsonb_typeof(p_config->'template_variables')<>'object' OR jsonb_typeof(p_config->'audience_filter')<>'object'
 OR p_config->'audience_filter'->>'type' NOT IN ('all','tags','segment')
 THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 IF p_config->'voice_note' IS NULL OR p_config->'voice_note'='null'::jsonb THEN
  SELECT jsonb_build_object('id',id,'name',name,'language',language,'category',category,'status',status,'body_text',body_text,'header_type',header_type,'header_content',header_content,'footer_text',footer_text,'buttons',buttons,'waba_id',waba_id,'user_id',user_id)
   INTO tpl FROM message_templates WHERE id=(p_template->>'id')::uuid AND workspace_id=p_workspace_id
   AND name=p_config->>'template_name' AND language=p_config->>'template_language' AND lower(status)='approved'
   AND (user_id=b.user_id OR EXISTS(SELECT 1 FROM whatsapp_config WHERE workspace_id=p_workspace_id AND status='connected' AND waba_id=message_templates.waba_id))
   AND (waba_id IS NULL OR EXISTS(SELECT 1 FROM whatsapp_config WHERE workspace_id=p_workspace_id AND status='connected' AND waba_id=message_templates.waba_id)) FOR SHARE;
  IF tpl IS NULL OR tpl IS DISTINCT FROM p_template THEN RAISE EXCEPTION 'broadcast_draft_template'; END IF;
 ELSE
  IF jsonb_typeof(p_config->'voice_note')<>'object' OR p_template IS NOT NULL THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 END IF;
 -- Lock every destination before replacing pending rows. A late opt-out or
 -- cross-business destination aborts the whole save; it does not shrink silently.
 PERFORM 1 FROM contacts WHERE id IN (SELECT (v->>'contact_id')::uuid FROM jsonb_array_elements(p_recipients) v) ORDER BY id FOR SHARE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_recipients) v LEFT JOIN contacts c ON c.id=(v->>'contact_id')::uuid
   WHERE c.id IS NULL OR c.workspace_id IS DISTINCT FROM p_workspace_id OR coalesce(c.opted_out,false)
   OR jsonb_typeof(v->'params') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'params') val WHERE jsonb_typeof(val)<>'string' OR length(val#>>'{}')>4096)
   OR EXISTS(SELECT 1 FROM contact_tags ct WHERE ct.contact_id=c.id AND ct.tag_id::text IN (SELECT jsonb_array_elements_text(coalesce(p_config->'audience_filter'->'excludeTagIds','[]'::jsonb)))))
 THEN RAISE EXCEPTION 'broadcast_draft_changed'; END IF;
 IF (SELECT count(DISTINCT v->>'contact_id') FROM jsonb_array_elements(p_recipients) v)<>jsonb_array_length(p_recipients) THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 DELETE FROM broadcast_recipients WHERE broadcast_id=b.id;
 INSERT INTO broadcast_recipients(broadcast_id,contact_id,status,params)
  SELECT b.id,(v->>'contact_id')::uuid,'pending',v->'params' FROM jsonb_array_elements(p_recipients) v;
 n:=jsonb_array_length(p_recipients);
 UPDATE broadcasts SET name=p_config->>'name',template_name=p_config->>'template_name',template_language=p_config->>'template_language',
  template_variables=p_config->'template_variables',variable_mapping=nullif(p_config->'variable_mapping','null'::jsonb),
  voice_note=nullif(p_config->'voice_note','null'::jsonb),audience_filter=p_config->'audience_filter',
  scheduled_at=(p_config->>'scheduled_at')::timestamptz,create_conversations=(p_config->>'create_conversations')::boolean,
  total_recipients=n,sent_count=0,delivered_count=0,read_count=0,replied_count=0,failed_count=0,error_message=NULL,
  draft_review=NULL,updated_at=clock_timestamp()
 WHERE id=b.id RETURNING * INTO b;
 UPDATE broadcasts SET draft_review=jsonb_build_object('template',p_template,'recipients',n,'config_hash',public.broadcast_draft_config_hash(b),
  'recipients_hash',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('contact_id',contact_id,'params',params) ORDER BY contact_id),'[]'::jsonb)::text,'UTF8')),'hex') FROM broadcast_recipients WHERE broadcast_id=b.id))
 WHERE id=b.id RETURNING updated_at INTO stamp;
 RETURN jsonb_build_object('id',b.id,'updated_at',stamp,'total_recipients',n,'status','draft');
END $$;

CREATE OR REPLACE FUNCTION public.launch_reviewed_broadcast_draft(
 p_workspace_id uuid,p_broadcast_id uuid,p_actor_id uuid,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.broadcasts;member_role text;tpl jsonb;n integer;stamp timestamptz;
BEGIN
 IF p_actor_id IS NULL OR p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 SELECT role INTO member_role FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id AND suspended_at IS NULL AND motor_apagado_at IS NULL FOR SHARE;
 IF NOT FOUND OR public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'broadcast_draft_paused'; END IF;
 SELECT * INTO b FROM broadcasts WHERE id=p_broadcast_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR (b.user_id<>p_actor_id AND member_role NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'broadcast_draft_invalid'; END IF;
 IF b.status<>'draft' OR b.updated_at IS DISTINCT FROM p_expected_updated_at OR b.draft_review IS NULL
 OR public.broadcast_draft_config_hash(b) IS DISTINCT FROM b.draft_review->>'config_hash'
 OR EXISTS(SELECT 1 FROM broadcast_delivery_receipts WHERE broadcast_id=b.id) THEN RAISE EXCEPTION 'broadcast_draft_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_config WHERE workspace_id=p_workspace_id AND status='connected') THEN RAISE EXCEPTION 'broadcast_draft_paused'; END IF;
 IF b.voice_note IS NULL THEN
  SELECT jsonb_build_object('id',id,'name',name,'language',language,'category',category,'status',status,'body_text',body_text,'header_type',header_type,'header_content',header_content,'footer_text',footer_text,'buttons',buttons,'waba_id',waba_id,'user_id',user_id)
   INTO tpl FROM message_templates WHERE id=(b.draft_review->'template'->>'id')::uuid AND workspace_id=p_workspace_id AND lower(status)='approved'
   AND (user_id=b.user_id OR EXISTS(SELECT 1 FROM whatsapp_config WHERE workspace_id=p_workspace_id AND status='connected' AND waba_id=message_templates.waba_id))
   AND (waba_id IS NULL OR EXISTS(SELECT 1 FROM whatsapp_config WHERE workspace_id=p_workspace_id AND status='connected' AND waba_id=message_templates.waba_id)) FOR SHARE;
  IF tpl IS NULL OR tpl IS DISTINCT FROM b.draft_review->'template' OR tpl->>'name'<>b.template_name OR tpl->>'language'<>b.template_language THEN RAISE EXCEPTION 'broadcast_draft_template'; END IF;
 END IF;
 PERFORM 1 FROM broadcast_recipients WHERE broadcast_id=b.id ORDER BY id FOR SHARE;
 SELECT count(*) INTO n FROM broadcast_recipients WHERE broadcast_id=b.id AND status='pending' AND whatsapp_message_id IS NULL;
 IF n=0 OR n<>b.total_recipients OR n IS DISTINCT FROM (b.draft_review->>'recipients')::integer
 OR (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('contact_id',contact_id,'params',params) ORDER BY contact_id),'[]'::jsonb)::text,'UTF8')),'hex') FROM broadcast_recipients WHERE broadcast_id=b.id) IS DISTINCT FROM b.draft_review->>'recipients_hash'
 OR EXISTS(SELECT 1 FROM broadcast_recipients WHERE broadcast_id=b.id AND (status<>'pending' OR whatsapp_message_id IS NOT NULL)) THEN RAISE EXCEPTION 'broadcast_draft_changed'; END IF;
 UPDATE broadcasts SET status='scheduled',scheduled_at=coalesce(b.scheduled_at,clock_timestamp()),error_message=NULL,updated_at=clock_timestamp()
 WHERE id=b.id RETURNING updated_at INTO stamp;
 RETURN jsonb_build_object('id',b.id,'updated_at',stamp,'total_recipients',n,'status','scheduled');
END $$;
REVOKE ALL ON FUNCTION public.save_broadcast_draft(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.broadcast_draft_config_hash(public.broadcasts) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.launch_reviewed_broadcast_draft(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_broadcast_draft(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_draft_config_hash(public.broadcasts) TO service_role;
GRANT EXECUTE ON FUNCTION public.launch_reviewed_broadcast_draft(uuid,uuid,uuid,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';

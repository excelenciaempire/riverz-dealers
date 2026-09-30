-- Reserve a persisted campaign destination before calling a provider. No lease
-- expiration grants another send: an abandoned attempt becomes uncertain.
CREATE TABLE IF NOT EXISTS public.broadcast_delivery_receipts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
 recipient_key uuid NOT NULL UNIQUE,
 recipient_id uuid REFERENCES public.broadcast_recipients(id) ON DELETE SET NULL,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 destination_hash text NOT NULL CHECK(destination_hash ~ '^[a-f0-9]{64}$'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'sending' CHECK(state IN ('sending','accepted','rejected','uncertain')),
 provider_message_id text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(broadcast_id,destination_hash),
 CHECK((state='accepted')=(provider_message_id IS NOT NULL)),
 CHECK(state<>'accepted' OR error_code IS NULL),
 CHECK(provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 500)
);
ALTER TABLE public.broadcast_delivery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.broadcast_delivery_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.broadcast_delivery_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.broadcast_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['recipient_id','actor_id','state','provider_message_id','error_code','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['recipient_id','actor_id','state','provider_message_id','error_code','updated_at'])
 OR (NEW.recipient_id IS DISTINCT FROM OLD.recipient_id AND NEW.recipient_id IS NOT NULL)
 OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL)
 OR (NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state='sending' OR (OLD.state='uncertain' AND NEW.state='accepted')))
 OR (OLD.state='accepted' AND (NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id OR NEW.error_code IS DISTINCT FROM OLD.error_code))
 THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS broadcast_receipt_immutable ON public.broadcast_delivery_receipts;
CREATE TRIGGER broadcast_receipt_immutable BEFORE UPDATE ON public.broadcast_delivery_receipts
 FOR EACH ROW EXECUTE FUNCTION public.broadcast_receipt_immutable();
REVOKE ALL ON FUNCTION public.broadcast_receipt_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_receipt_immutable() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_broadcast_delivery(
 p_id uuid,p_workspace_id uuid,p_broadcast_id uuid,p_recipient_id uuid,p_actor_id uuid,
 p_destination_hash text,p_payload_hash text,p_source jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.broadcasts;r public.broadcast_recipients;c public.contacts;
 prior public.broadcast_delivery_receipts;current_source jsonb;tpl jsonb;member_role text;
BEGIN
 IF p_id IS NULL OR p_workspace_id IS NULL OR p_broadcast_id IS NULL OR p_recipient_id IS NULL
 OR p_destination_hash IS NULL OR p_destination_hash !~ '^[a-f0-9]{64}$'
 OR p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$'
 OR p_source IS NULL OR jsonb_typeof(p_source)<>'object' OR length(p_source::text)>120000
 THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 IF p_actor_id IS NOT NULL THEN
  SELECT role INTO member_role FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 END IF;
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id FOR SHARE;
 SELECT * INTO b FROM broadcasts WHERE id=p_broadcast_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR (p_actor_id IS NOT NULL AND b.user_id IS DISTINCT FROM p_actor_id AND member_role NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 SELECT * INTO prior FROM broadcast_delivery_receipts WHERE recipient_key=p_recipient_id FOR UPDATE;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.broadcast_id IS DISTINCT FROM p_broadcast_id THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
  IF prior.recipient_id IS NULL THEN RETURN jsonb_build_object('claimed',false,'state','duplicate'); END IF;
  IF prior.destination_hash IS DISTINCT FROM p_destination_hash OR prior.payload_hash IS DISTINCT FROM p_payload_hash THEN
   RETURN jsonb_build_object('claimed',false,'state','changed');
  END IF;
  IF prior.state='sending' AND prior.created_at<now()-interval '10 minutes' THEN
   UPDATE broadcast_delivery_receipts SET state='uncertain',error_code='broadcast_delivery_uncertain',updated_at=now() WHERE id=prior.id;
   UPDATE broadcast_recipients SET status='failed',error_message='broadcast_delivery_uncertain' WHERE id=prior.recipient_id AND broadcast_id=p_broadcast_id AND status='pending';
   prior.state:='uncertain';
  END IF;
  RETURN jsonb_build_object('claimed',false,'state',prior.state,'message_id',prior.provider_message_id,'receipt_id',prior.id);
 END IF;
 PERFORM 1 FROM broadcast_delivery_receipts WHERE broadcast_id=p_broadcast_id AND destination_hash=p_destination_hash;
 IF FOUND THEN RETURN jsonb_build_object('claimed',false,'state','duplicate'); END IF;
 SELECT * INTO r FROM broadcast_recipients WHERE id=p_recipient_id AND broadcast_id=p_broadcast_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 SELECT * INTO c FROM contacts WHERE id=r.contact_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 IF r.status IN ('sent','delivered','read','replied') OR r.whatsapp_message_id IS NOT NULL THEN
  RETURN jsonb_build_object('claimed',false,'state','already_sent');
 END IF;
 IF b.status<>'sending' OR r.status<>'pending' THEN RETURN jsonb_build_object('claimed',false,'state','not_pending'); END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RETURN jsonb_build_object('claimed',false,'state','paused'); END IF;
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id AND suspended_at IS NULL AND motor_apagado_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'state','paused'); END IF;
 IF coalesce(c.opted_out,false) THEN
  UPDATE broadcast_recipients SET status='skipped_opt_out',error_message=NULL WHERE id=r.id;
  RETURN jsonb_build_object('claimed',false,'state','opted_out');
 END IF;
 IF EXISTS(SELECT 1 FROM contact_tags ct WHERE ct.contact_id=c.id AND ct.tag_id::text IN
  (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.audience_filter->'excludeTagIds')='array' THEN b.audience_filter->'excludeTagIds' ELSE '[]'::jsonb END))) THEN
  UPDATE broadcast_recipients SET status='failed',error_message='broadcast_delivery_excluded' WHERE id=r.id;
  RETURN jsonb_build_object('claimed',false,'state','excluded');
 END IF;
 IF b.voice_note IS NULL THEN
  SELECT jsonb_build_object('id',id,'category',category,'status',status,'body_text',body_text) INTO tpl
   FROM message_templates WHERE workspace_id=p_workspace_id AND user_id=b.user_id AND name=b.template_name AND language=coalesce(b.template_language,'en_US')
   AND (waba_id IS NULL OR EXISTS(SELECT 1 FROM whatsapp_config wc WHERE wc.workspace_id=p_workspace_id AND wc.status='connected' AND wc.waba_id=message_templates.waba_id))
   AND lower(status)='approved' AND lower(category) IN ('marketing','utility','authentication');
  IF (SELECT count(*) FROM message_templates WHERE workspace_id=p_workspace_id AND user_id=b.user_id AND name=b.template_name AND language=coalesce(b.template_language,'en_US'))=0 THEN
   SELECT jsonb_build_object('id',t.id,'category',t.category,'status',t.status,'body_text',t.body_text) INTO tpl
   FROM message_templates t JOIN whatsapp_config wc ON wc.workspace_id=t.workspace_id AND wc.waba_id=t.waba_id AND wc.status='connected'
   WHERE t.workspace_id=p_workspace_id AND t.name=b.template_name AND t.language=coalesce(b.template_language,'en_US')
   ORDER BY t.id LIMIT 1;
   IF (SELECT count(*) FROM message_templates t JOIN whatsapp_config wc ON wc.workspace_id=t.workspace_id AND wc.waba_id=t.waba_id AND wc.status='connected'
    WHERE t.workspace_id=p_workspace_id AND t.name=b.template_name AND t.language=coalesce(b.template_language,'en_US'))>100
    OR (SELECT count(DISTINCT jsonb_build_object('category',lower(t.category),'status',lower(t.status),'body_text',t.body_text))
    FROM message_templates t JOIN whatsapp_config wc ON wc.workspace_id=t.workspace_id AND wc.waba_id=t.waba_id AND wc.status='connected'
    WHERE t.workspace_id=p_workspace_id AND t.name=b.template_name AND t.language=coalesce(b.template_language,'en_US'))<>1 THEN tpl:=NULL; END IF;
  ELSIF (SELECT count(*) FROM message_templates WHERE workspace_id=p_workspace_id AND user_id=b.user_id AND name=b.template_name AND language=coalesce(b.template_language,'en_US'))<>1 THEN tpl:=NULL;
  END IF;
  IF tpl IS NULL OR lower(tpl->>'status')<>'approved' OR lower(tpl->>'category') NOT IN ('marketing','utility','authentication') THEN
   RETURN jsonb_build_object('claimed',false,'state','template_unavailable');
  END IF;
 END IF;
 current_source:=jsonb_build_object('template_name',b.template_name,'template_language',coalesce(b.template_language,'en_US'),
  'voice_note',b.voice_note,'variable_mapping',b.variable_mapping,'audience_filter',b.audience_filter,
  'contact_id',r.contact_id,'params',r.params,'phone',c.phone,'template',tpl);
 IF current_source IS DISTINCT FROM p_source THEN RETURN jsonb_build_object('claimed',false,'state','changed'); END IF;
 INSERT INTO broadcast_delivery_receipts(id,workspace_id,broadcast_id,recipient_key,recipient_id,actor_id,destination_hash,payload_hash)
 VALUES(p_id,p_workspace_id,p_broadcast_id,p_recipient_id,p_recipient_id,p_actor_id,p_destination_hash,p_payload_hash);
 RETURN jsonb_build_object('claimed',true,'state','sending','receipt_id',p_id);
END $$;

CREATE OR REPLACE FUNCTION public.finish_broadcast_delivery(p_id uuid,p_state text,p_message_id text,p_error_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.broadcast_delivery_receipts;bid uuid;
BEGIN
 IF p_id IS NULL OR p_state IS NULL OR p_state NOT IN ('accepted','rejected','uncertain')
 OR (p_state='accepted' AND (p_message_id IS NULL OR length(p_message_id) NOT BETWEEN 1 AND 500))
 OR (p_state<>'accepted' AND p_message_id IS NOT NULL)
 OR (p_state='accepted' AND p_error_code IS NOT NULL)
 OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_]{1,80}$') THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 SELECT broadcast_id INTO bid FROM broadcast_delivery_receipts WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 -- Same parent -> receipt lock order as claims and recipient count triggers.
 PERFORM 1 FROM broadcasts WHERE id=bid FOR UPDATE;
 SELECT * INTO prior FROM broadcast_delivery_receipts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 IF prior.state='accepted' THEN
  IF p_state<>'accepted' OR prior.provider_message_id IS DISTINCT FROM p_message_id THEN RAISE EXCEPTION 'broadcast_receipt_changed'; END IF;
 ELSIF prior.state='rejected' OR (prior.state='uncertain' AND p_state<>'accepted') THEN
  IF prior.state IS DISTINCT FROM p_state THEN RAISE EXCEPTION 'broadcast_receipt_changed'; END IF;
 ELSE
  UPDATE broadcast_delivery_receipts SET state=p_state,provider_message_id=p_message_id,error_code=p_error_code,updated_at=now() WHERE id=p_id;
 END IF;
 IF p_state='accepted' THEN
  UPDATE broadcast_recipients SET status=CASE WHEN status IN ('delivered','read','replied') THEN status ELSE 'sent' END,
   whatsapp_message_id=p_message_id,sent_at=coalesce(sent_at,now()),error_message=NULL
   WHERE id=prior.recipient_id AND broadcast_id=prior.broadcast_id AND (whatsapp_message_id IS NULL OR whatsapp_message_id=p_message_id);
 ELSE
  UPDATE broadcast_recipients SET status='failed',error_message=coalesce(p_error_code,'broadcast_delivery_uncertain')
   WHERE id=prior.recipient_id AND broadcast_id=prior.broadcast_id AND status='pending' AND whatsapp_message_id IS NULL;
 END IF;
 RETURN jsonb_build_object('ok',true,'state',p_state);
END $$;
REVOKE ALL ON FUNCTION public.claim_broadcast_delivery(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),public.finish_broadcast_delivery(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_delivery(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),public.finish_broadcast_delivery(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_broadcast_delivery_progress(p_workspace_id uuid,p_broadcast_id uuid,p_actor_id uuid,p_defer_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.broadcasts;member_role text;total bigint;pending bigint;failed bigint;next_status text;
BEGIN
 IF p_workspace_id IS NULL OR p_broadcast_id IS NULL OR p_defer_seconds IS NULL OR p_defer_seconds NOT BETWEEN 60 AND 3600 THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 IF p_actor_id IS NOT NULL THEN
  SELECT role INTO member_role FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 END IF;
 SELECT * INTO b FROM broadcasts WHERE id=p_broadcast_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR (p_actor_id IS NOT NULL AND b.user_id IS DISTINCT FROM p_actor_id AND member_role NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'invalid_broadcast_receipt'; END IF;
 IF b.status<>'sending' THEN RETURN jsonb_build_object('status',b.status,'changed',false); END IF;
 SELECT count(*),count(*) FILTER(WHERE status='pending'),count(*) FILTER(WHERE status='failed') INTO total,pending,failed
  FROM broadcast_recipients WHERE broadcast_id=p_broadcast_id;
 next_status:=CASE WHEN pending>0 THEN 'scheduled' WHEN total=0 OR failed=total THEN 'failed' ELSE 'sent' END;
 UPDATE broadcasts SET status=next_status,scheduled_at=CASE WHEN next_status='scheduled' THEN now()+make_interval(secs=>p_defer_seconds) ELSE scheduled_at END WHERE id=p_broadcast_id;
 RETURN jsonb_build_object('status',next_status,'changed',true);
END $$;
REVOKE ALL ON FUNCTION public.finalize_broadcast_delivery_progress(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_broadcast_delivery_progress(uuid,uuid,uuid,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst,'reload schema';

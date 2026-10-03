-- Independent Dealers: tenant configuration, safe intake, evidence and self-service.
BEGIN;
CREATE TABLE public.dealer_settings (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 settings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(settings)='object'),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.dealer_validate_settings() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE section text; key text; value jsonb; n numeric;
BEGIN
 FOR section,key,value IN SELECT s.key,f.key,f.value FROM jsonb_each(NEW.settings) s CROSS JOIN LATERAL jsonb_each(s.value) f LOOP
  IF section NOT IN ('business','leads','inventory','appointments','follow_up','coach','metrics','pipeline') THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  IF key IN ('enabled','capture_enabled','webhook_enabled','retire_missing','allow_status_updates','match_enabled','self_service','allow_reschedule','require_seller_confirmation') AND jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  IF key IN ('response_minutes','follow_up_hours','interval_minutes','freshness_hours','minimum_units','duration_minutes','notice_hours','horizon_days','reminder_hours','link_days','start_hour','end_hour','outcome_hours','days','target_contact_percent','target_show_percent','target_close_percent') THEN
   IF jsonb_typeof(value)<>'number' THEN RAISE EXCEPTION 'dealer_reference'; END IF;
   n:=value::text::numeric; IF n<>trunc(n) OR n<(CASE WHEN key IN ('notice_hours','start_hour','target_contact_percent','target_show_percent','target_close_percent') THEN 0 WHEN key IN ('interval_minutes','duration_minutes') THEN 15 ELSE 1 END)
    OR n>(CASE key WHEN 'response_minutes' THEN 120 WHEN 'follow_up_hours' THEN 720 WHEN 'interval_minutes' THEN 1440 WHEN 'freshness_hours' THEN 168 WHEN 'minimum_units' THEN 5000 WHEN 'duration_minutes' THEN 240 WHEN 'notice_hours' THEN 168 WHEN 'horizon_days' THEN 90 WHEN 'reminder_hours' THEN 72 WHEN 'link_days' THEN 90 WHEN 'start_hour' THEN 23 WHEN 'end_hour' THEN 24 WHEN 'outcome_hours' THEN 72 WHEN 'days' THEN 365 ELSE 100 END) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  END IF;
 END LOOP;
 IF NEW.settings#>>'{business,timezone}' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.settings#>>'{business,timezone}') THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 IF jsonb_typeof(coalesce(NEW.settings#>'{appointments,weekdays}','[1,2,3,4,5,6]'::jsonb))<>'array' OR jsonb_typeof(coalesce(NEW.settings#>'{follow_up,weekdays}','[1,2,3,4,5,6]'::jsonb))<>'array' THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dealer_validate_settings BEFORE INSERT OR UPDATE ON public.dealer_settings FOR EACH ROW EXECUTE FUNCTION public.dealer_validate_settings();
CREATE FUNCTION public.dealer_is_manager(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace AND owner_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=auth.uid() AND role='admin');
$$;
REVOKE ALL ON FUNCTION public.dealer_is_manager(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dealer_is_manager(uuid) TO authenticated,service_role;
ALTER TABLE public.dealer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY dealer_settings_read ON public.dealer_settings FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));
GRANT SELECT ON public.dealer_settings TO authenticated;
GRANT ALL ON public.dealer_settings TO service_role;
CREATE FUNCTION public.dealer_save_settings(p_workspace uuid,p_version integer,p_settings jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_version integer; seller uuid;
BEGIN
 IF NOT public.dealer_is_manager(p_workspace) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('dealer-settings:'||p_workspace));
 SELECT version INTO current_version FROM public.dealer_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF coalesce(current_version,0)<>p_version THEN RAISE EXCEPTION 'dealer_conflict'; END IF;
 IF jsonb_typeof(p_settings)<>'object' THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 seller:=(p_settings#>>'{leads,default_seller_id}')::uuid;
 IF seller IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=seller) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 INSERT INTO public.dealer_settings(workspace_id,settings,version) VALUES(p_workspace,p_settings,1)
 ON CONFLICT(workspace_id) DO UPDATE SET settings=excluded.settings,version=dealer_settings.version+1,updated_at=now()
 RETURNING version INTO current_version;
 RETURN current_version;
END $$;
REVOKE ALL ON FUNCTION public.dealer_save_settings(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dealer_save_settings(uuid,integer,jsonb) TO authenticated;

CREATE TABLE public.dealer_credentials (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 lead_secret_hash text, inventory_token_encrypted text, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dealer_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealer_credentials FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dealer_credentials TO service_role;
ALTER TABLE public.dealer_opportunities ADD COLUMN assigned_seller_id uuid REFERENCES auth.users(id),
 ADD COLUMN first_response_at timestamptz, ADD COLUMN lost_reason text NOT NULL DEFAULT '' CHECK(length(lost_reason)<=120);
ALTER TABLE public.dealer_vehicles ADD COLUMN source_id text, ADD COLUMN source_checked_at timestamptz,
 ADD COLUMN source_changed_at timestamptz;
CREATE TABLE public.dealer_stage_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 opportunity_id uuid NOT NULL, from_stage text, to_stage text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,opportunity_id) REFERENCES public.dealer_opportunities(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE public.dealer_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('running','ok','error')), source text NOT NULL, units integer NOT NULL DEFAULT 0,
 created_count integer NOT NULL DEFAULT 0, changed_count integer NOT NULL DEFAULT 0, retired_count integer NOT NULL DEFAULT 0,
 error_code text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX dealer_one_sync ON public.dealer_sync_runs(workspace_id) WHERE status='running';
CREATE TABLE public.dealer_lead_receipts (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE, external_id text NOT NULL,
 source text NOT NULL, contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
 opportunity_id uuid, consent boolean NOT NULL DEFAULT false, consent_at timestamptz,
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,external_id)
);
ALTER TABLE public.dealer_appointments ADD CONSTRAINT dealer_appointment_tenant_identity UNIQUE(workspace_id,id);
CREATE TABLE public.dealer_appointment_links (
 token_hash text PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 appointment_id uuid NOT NULL, expires_at timestamptz NOT NULL, schedule_revision timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,appointment_id) REFERENCES public.dealer_appointments(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE public.dealer_coaching (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 opportunity_id uuid, actor_id uuid NOT NULL REFERENCES auth.users(id), mode text NOT NULL CHECK(mode IN ('brief','review','practice')),
 input text NOT NULL DEFAULT '' CHECK(length(input)<=12000), output text NOT NULL CHECK(length(output)<=16000),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,opportunity_id) REFERENCES public.dealer_opportunities(workspace_id,id) ON DELETE CASCADE
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['dealer_stage_history','dealer_sync_runs','dealer_lead_receipts','dealer_coaching'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY dealer_growth_read ON public.%I FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id))',tbl);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tbl);
 END LOOP;
END $$;
ALTER FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) RENAME TO dealer_save_opportunity_v2;
CREATE FUNCTION public.dealer_save_opportunity(p_workspace uuid,p_id uuid,p_data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE saved uuid;
BEGIN
 saved:=public.dealer_save_opportunity_v2(p_workspace,p_id,p_data);
 UPDATE public.dealer_opportunities SET lost_reason=coalesce(p_data->>'lost_reason',lost_reason),
  assigned_seller_id=CASE WHEN p_data ? 'assigned_seller_id' THEN (p_data->>'assigned_seller_id')::uuid ELSE assigned_seller_id END WHERE id=saved AND workspace_id=p_workspace;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) TO authenticated,service_role;
ALTER TABLE public.dealer_appointment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealer_appointment_links FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dealer_appointment_links TO service_role;
CREATE INDEX dealer_history_timeline ON public.dealer_stage_history(workspace_id,changed_at DESC);
CREATE INDEX dealer_sync_recent ON public.dealer_sync_runs(workspace_id,started_at DESC);
CREATE FUNCTION public.dealer_growth_opportunity() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.assigned_seller_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=NEW.workspace_id AND user_id=NEW.assigned_seller_id) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 IF TG_OP='INSERT' AND NEW.assigned_seller_id IS NULL THEN SELECT coalesce((s.settings#>>'{leads,default_seller_id}')::uuid,w.owner_id) INTO NEW.assigned_seller_id FROM public.workspaces w LEFT JOIN public.dealer_settings s ON s.workspace_id=w.id WHERE w.id=NEW.workspace_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dealer_growth_opportunity BEFORE INSERT OR UPDATE ON public.dealer_opportunities FOR EACH ROW EXECUTE FUNCTION public.dealer_growth_opportunity();
CREATE FUNCTION public.dealer_stage_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO public.dealer_stage_history(workspace_id,opportunity_id,to_stage) VALUES(NEW.workspace_id,NEW.id,NEW.stage);
 ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN INSERT INTO public.dealer_stage_history(workspace_id,opportunity_id,from_stage,to_stage) VALUES(NEW.workspace_id,NEW.id,OLD.stage,NEW.stage); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dealer_stage_event AFTER INSERT OR UPDATE OF stage ON public.dealer_opportunities FOR EACH ROW EXECUTE FUNCTION public.dealer_stage_event();
CREATE OR REPLACE FUNCTION public.dealer_capture_contact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE config jsonb;
BEGIN
 SELECT settings INTO config FROM public.dealer_settings WHERE workspace_id=NEW.workspace_id;
 IF coalesce((config#>>'{leads,capture_enabled}')::boolean,true) THEN
  INSERT INTO public.dealer_opportunities(workspace_id,contact_id,lead_source) VALUES(NEW.workspace_id,NEW.id,coalesce(config#>>'{leads,default_source}','direct'));
 END IF;
 RETURN NEW;
END $$;

-- Captured messages provide real response evidence; queued/failed drafts do not.
CREATE FUNCTION public.dealer_message_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.sender_type IN ('agent','bot','ai') AND NEW.status IN ('sent','delivered','read') THEN
  UPDATE public.dealer_opportunities o SET first_response_at=coalesce(o.first_response_at,NEW.created_at),last_contact_at=greatest(o.last_contact_at,NEW.created_at)
  FROM public.conversations c WHERE c.id=NEW.conversation_id AND c.workspace_id=o.workspace_id AND c.contact_id=o.contact_id AND o.stage NOT IN ('won','lost') AND NEW.created_at>=o.created_at;
 ELSIF NEW.sender_type='customer' THEN
  UPDATE public.dealer_opportunities o SET first_contact_at=coalesce(o.first_contact_at,NEW.created_at)
  FROM public.conversations c WHERE c.id=NEW.conversation_id AND c.workspace_id=o.workspace_id AND c.contact_id=o.contact_id AND o.stage NOT IN ('won','lost') AND NEW.created_at>=o.created_at
   AND EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations prior ON prior.id=m.conversation_id WHERE prior.workspace_id=o.workspace_id AND prior.contact_id=o.contact_id AND m.sender_type IN ('agent','bot','ai') AND m.status IN ('sent','delivered','read') AND m.created_at>=o.created_at AND m.created_at<NEW.created_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dealer_message_evidence AFTER INSERT OR UPDATE OF status ON public.messages FOR EACH ROW EXECUTE FUNCTION public.dealer_message_evidence();

-- Service-only atomic intake. Never reverse an existing customer's opt-out.
CREATE FUNCTION public.dealer_ingest_lead(p_workspace uuid,p_lead jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c uuid; o uuid; owner uuid; settings jsonb; receipt public.dealer_lead_receipts;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('dealer-lead:'||p_workspace));
 SELECT * INTO receipt FROM public.dealer_lead_receipts WHERE workspace_id=p_workspace AND external_id=p_lead->>'external_id';
 IF FOUND THEN RETURN jsonb_build_object('contact_id',receipt.contact_id,'opportunity_id',receipt.opportunity_id,'duplicate',true); END IF;
 SELECT w.owner_id,s.settings INTO owner,settings FROM public.workspaces w LEFT JOIN public.dealer_settings s ON s.workspace_id=w.id WHERE w.id=p_workspace;
 IF owner IS NULL OR NOT coalesce((settings#>>'{leads,webhook_enabled}')::boolean,false) THEN RAISE EXCEPTION 'dealer_closed'; END IF;
 IF coalesce(p_lead->>'phone','') !~ '^\+[1-9][0-9]{7,14}$' OR coalesce(length(p_lead->>'external_id'),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 SELECT id INTO c FROM public.contacts WHERE workspace_id=p_workspace AND regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_lead->>'phone','[^0-9]','','g') ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF c IS NULL THEN
  INSERT INTO public.contacts(workspace_id,user_id,phone,name,email) VALUES(p_workspace,owner,p_lead->>'phone',p_lead->>'name',nullif(p_lead->>'email','')) RETURNING id INTO c;
 END IF;
 SELECT id INTO o FROM public.dealer_opportunities WHERE workspace_id=p_workspace AND contact_id=c AND stage NOT IN ('won','lost') FOR UPDATE;
 IF o IS NULL AND coalesce((settings#>>'{leads,capture_enabled}')::boolean,true) AND NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=c AND opted_out) THEN
  INSERT INTO public.dealer_opportunities(workspace_id,contact_id) VALUES(p_workspace,c) RETURNING id INTO o;
 END IF;
 IF o IS NOT NULL THEN
  UPDATE public.dealer_opportunities SET lead_source=CASE WHEN lead_source IN ('','direct') THEN p_lead->>'source' ELSE lead_source END,
   preferences=CASE WHEN preferences='' THEN coalesce(p_lead->>'preferences','') ELSE preferences END,
   next_follow_up_at=CASE WHEN next_follow_up_at IS NULL AND NOT follow_up_paused AND coalesce((p_lead->>'consent')::boolean,false) THEN now()+make_interval(hours=>coalesce((settings#>>'{leads,follow_up_hours}')::integer,24)) ELSE next_follow_up_at END
  WHERE id=o AND workspace_id=p_workspace;
 END IF;
 INSERT INTO public.dealer_lead_receipts(workspace_id,external_id,source,contact_id,opportunity_id,consent,consent_at)
 VALUES(p_workspace,p_lead->>'external_id',p_lead->>'source',c,o,(p_lead->>'consent')::boolean,(p_lead->>'consent_at')::timestamptz);
 RETURN jsonb_build_object('contact_id',c,'opportunity_id',o,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.dealer_ingest_lead(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_ingest_lead(uuid,jsonb) TO service_role;

-- Import is a single transaction. Failed/empty/truncated feeds never retire inventory.
CREATE FUNCTION public.dealer_import_inventory(p_workspace uuid,p_run uuid,p_rows jsonb,p_source text,p_retire boolean,p_status boolean,p_minimum integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row jsonb; existing public.dealer_vehicles; inserted integer:=0; changed integer:=0; retired integer:=0; qty integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.dealer_sync_runs WHERE id=p_run AND workspace_id=p_workspace AND status='running' AND source=p_source FOR UPDATE) THEN RAISE EXCEPTION 'dealer_conflict'; END IF;
 qty:=jsonb_array_length(p_rows);
 IF qty<greatest(p_minimum,1) OR qty>5000 THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  SELECT * INTO existing FROM public.dealer_vehicles WHERE workspace_id=p_workspace AND stock_number=row->>'stock_number' FOR UPDATE;
  IF FOUND THEN
   IF existing.source_id IS NOT NULL AND existing.source_id<>p_source THEN RAISE EXCEPTION 'dealer_conflict'; END IF;
   IF existing.vin IS NOT NULL AND existing.vin IS DISTINCT FROM nullif(row->>'vin','') THEN RAISE EXCEPTION 'dealer_reference'; END IF;
   IF existing.price IS DISTINCT FROM (row->>'price')::numeric OR existing.photos IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(row->'photos')) OR existing.model<>row->>'model' OR (p_status AND existing.status<>row->>'status') THEN changed:=changed+1; END IF;
   UPDATE public.dealer_vehicles SET vin=nullif(row->>'vin',''),make=row->>'make',model=row->>'model',year=(row->>'year')::integer,mileage=(row->>'mileage')::integer,mileage_unit=row->>'mileage_unit',price=(row->>'price')::numeric,currency=row->>'currency',
    status=CASE WHEN p_status THEN row->>'status' ELSE status END,photos=ARRAY(SELECT jsonb_array_elements_text(row->'photos')),notes=row->>'notes',source_id=p_source,source_checked_at=now(),
    source_changed_at=CASE WHEN existing.price IS DISTINCT FROM (row->>'price')::numeric OR (p_status AND existing.status<>row->>'status') THEN now() ELSE source_changed_at END WHERE id=existing.id;
  ELSE
   INSERT INTO public.dealer_vehicles(workspace_id,stock_number,vin,make,model,year,mileage,mileage_unit,price,currency,status,photos,notes,source_id,source_checked_at,source_changed_at)
   VALUES(p_workspace,row->>'stock_number',nullif(row->>'vin',''),row->>'make',row->>'model',(row->>'year')::integer,(row->>'mileage')::integer,row->>'mileage_unit',(row->>'price')::numeric,row->>'currency',row->>'status',ARRAY(SELECT jsonb_array_elements_text(row->'photos')),row->>'notes',p_source,now(),now());
   inserted:=inserted+1;
  END IF;
 END LOOP;
 IF p_retire THEN
  UPDATE public.dealer_vehicles SET status='reserved',source_checked_at=now(),source_changed_at=now()
  WHERE workspace_id=p_workspace AND source_id=p_source AND status='available' AND stock_number NOT IN (SELECT value->>'stock_number' FROM jsonb_array_elements(p_rows));
  GET DIAGNOSTICS retired=ROW_COUNT;
 END IF;
 UPDATE public.dealer_sync_runs SET status='ok',units=qty,created_count=inserted,changed_count=changed,retired_count=retired,finished_at=now() WHERE id=p_run;
 RETURN jsonb_build_object('units',qty,'created',inserted,'changed',changed,'retired',retired);
END $$;
REVOKE ALL ON FUNCTION public.dealer_import_inventory(uuid,uuid,jsonb,text,boolean,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_import_inventory(uuid,uuid,jsonb,text,boolean,boolean,integer) TO service_role;

-- Link actions remain atomic and enforce current slot/vehicle/contact invariants.
CREATE FUNCTION public.dealer_appointment_action(p_hash text,p_action text,p_starts timestamptz DEFAULT NULL,p_ends timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE link public.dealer_appointment_links; ap public.dealer_appointments; config jsonb; day integer; hour integer; end_hour integer;
BEGIN
 SELECT * INTO link FROM public.dealer_appointment_links WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 SELECT * INTO ap FROM public.dealer_appointments WHERE id=link.appointment_id AND workspace_id=link.workspace_id FOR UPDATE;
 SELECT settings INTO config FROM public.dealer_settings WHERE workspace_id=link.workspace_id;
 IF NOT coalesce((config#>>'{appointments,self_service}')::boolean,true) OR ap.status NOT IN ('requested','confirmed') OR ap.starts_at<=now() OR ap.starts_at<>link.schedule_revision THEN RAISE EXCEPTION 'dealer_closed'; END IF;
 IF p_action='confirm' THEN
  UPDATE public.dealer_appointments SET customer_confirmed=true WHERE id=ap.id;
 ELSIF p_action='cancel' THEN
  UPDATE public.dealer_appointments SET status='cancelled',customer_confirmed=false WHERE id=ap.id;
 ELSIF p_action='reschedule' THEN
  IF NOT coalesce((config#>>'{appointments,allow_reschedule}')::boolean,true) THEN RAISE EXCEPTION 'dealer_closed'; END IF;
  day:=extract(dow FROM p_starts AT TIME ZONE coalesce(config#>>'{business,timezone}','America/New_York'));
  hour:=extract(hour FROM p_starts AT TIME ZONE coalesce(config#>>'{business,timezone}','America/New_York'));
  end_hour:=extract(hour FROM (p_ends-interval '1 millisecond') AT TIME ZONE coalesce(config#>>'{business,timezone}','America/New_York'));
  IF p_starts IS NULL OR p_ends IS NULL OR p_starts<now()+make_interval(hours=>coalesce((config#>>'{appointments,notice_hours}')::integer,2)) OR p_starts>now()+make_interval(days=>coalesce((config#>>'{appointments,horizon_days}')::integer,30))
   OR p_ends-p_starts<>make_interval(mins=>coalesce((config#>>'{appointments,duration_minutes}')::integer,30))
   OR NOT coalesce(config#>'{appointments,weekdays}','[1,2,3,4,5,6]'::jsonb) @> to_jsonb(day)
   OR hour<coalesce((config#>>'{appointments,start_hour}')::integer,9) OR end_hour>=coalesce((config#>>'{appointments,end_hour}')::integer,19)
   OR (p_starts AT TIME ZONE coalesce(config#>>'{business,timezone}','America/New_York'))::date<>(p_ends AT TIME ZONE coalesce(config#>>'{business,timezone}','America/New_York'))::date THEN RAISE EXCEPTION 'dealer_conflict'; END IF;
  UPDATE public.dealer_appointments SET starts_at=p_starts,ends_at=p_ends,status=CASE WHEN coalesce((config#>>'{appointments,require_seller_confirmation}')::boolean,true) THEN 'requested' ELSE 'confirmed' END WHERE id=ap.id;
  UPDATE public.dealer_appointment_links SET schedule_revision=p_starts WHERE token_hash=p_hash;
 ELSE RAISE EXCEPTION 'dealer_reference'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.dealer_appointment_action(text,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_appointment_action(text,text,timestamptz,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

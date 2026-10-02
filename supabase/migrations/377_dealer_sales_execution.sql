-- Independent dealer database: evidence of seller actions and bounded recovery.
BEGIN;
ALTER TABLE public.dealer_opportunities
  ADD COLUMN buying_reason text NOT NULL DEFAULT '' CHECK(length(buying_reason)<=1000),
  ADD COLUMN objection text NOT NULL DEFAULT '' CHECK(length(objection)<=1000),
  ADD COLUMN buyer_type text NOT NULL DEFAULT 'unknown' CHECK(buyer_type IN ('unknown','first_time','replacement','additional')),
  ADD COLUMN lead_source text NOT NULL DEFAULT '' CHECK(length(lead_source)<=200),
  ADD COLUMN first_contact_at timestamptz,
  ADD COLUMN last_contact_at timestamptz,
  ADD COLUMN follow_up_set_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION public.dealer_followup_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.next_follow_up_at IS DISTINCT FROM OLD.next_follow_up_at THEN NEW.follow_up_set_at:=now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dealer_followup_revision BEFORE UPDATE ON public.dealer_opportunities FOR EACH ROW EXECUTE FUNCTION public.dealer_followup_revision();
CREATE FUNCTION public.dealer_capture_contact() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  INSERT INTO public.dealer_opportunities(workspace_id,contact_id) VALUES(NEW.workspace_id,NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER dealer_capture_contact AFTER INSERT ON public.contacts FOR EACH ROW WHEN(NEW.workspace_id IS NOT NULL) EXECUTE FUNCTION public.dealer_capture_contact();
ALTER TABLE public.dealer_appointments
  ADD COLUMN customer_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN vehicle_prepared boolean NOT NULL DEFAULT false,
  ADD COLUMN directions_sent boolean NOT NULL DEFAULT false;
CREATE TABLE public.dealer_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK(kind IN ('call_connected','call_no_answer','message_sent','video_sent','finance_handoff','visit_recap')),
  note text NOT NULL DEFAULT '' CHECK(length(note)<=2000), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,opportunity_id) REFERENCES public.dealer_opportunities(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX dealer_activity_timeline ON public.dealer_activities(workspace_id,opportunity_id,created_at DESC);
ALTER TABLE public.dealer_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY dealer_activity_read ON public.dealer_activities FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));
CREATE POLICY dealer_activity_add ON public.dealer_activities FOR INSERT TO authenticated
  WITH CHECK(public.is_workspace_member(workspace_id) AND actor_id=auth.uid());
GRANT SELECT,INSERT ON public.dealer_activities TO authenticated;
GRANT ALL ON public.dealer_activities TO service_role;

CREATE FUNCTION public.dealer_log_activity(p_workspace uuid,p_opportunity uuid,p_kind text,p_note text,p_next_at timestamptz,p_next_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE saved uuid; buyer uuid;
BEGIN
  SELECT contact_id INTO buyer FROM public.dealer_opportunities WHERE id=p_opportunity AND workspace_id=p_workspace AND stage NOT IN ('won','lost') FOR UPDATE;
  IF buyer IS NULL THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  IF EXISTS(SELECT 1 FROM public.contacts WHERE id=buyer AND opted_out) THEN RAISE EXCEPTION 'dealer_closed'; END IF;
  IF p_next_at IS NOT NULL AND p_next_at<=now() THEN RAISE EXCEPTION 'dealer_past'; END IF;
  IF p_next_at IS NOT NULL AND coalesce(length(trim(p_next_note)),0)=0 THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  INSERT INTO public.dealer_activities(workspace_id,opportunity_id,actor_id,kind,note)
    VALUES(p_workspace,p_opportunity,auth.uid(),p_kind,p_note) RETURNING id INTO saved;
  UPDATE public.dealer_opportunities SET
    first_contact_at=CASE WHEN p_kind='call_connected' THEN coalesce(first_contact_at,now()) ELSE first_contact_at END,
    last_contact_at=CASE WHEN p_kind IN ('call_connected','message_sent','video_sent','visit_recap') THEN now() ELSE last_contact_at END,
    next_follow_up_at=p_next_at,follow_up_note=coalesce(p_next_note,''),follow_up_paused=(p_next_at IS NULL)
    WHERE id=p_opportunity;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.dealer_log_activity(uuid,uuid,text,text,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dealer_log_activity(uuid,uuid,text,text,timestamptz,text) TO authenticated;

-- Preserve the atomic inventory/interest save and enrich only supplied fields.
ALTER FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) RENAME TO dealer_save_opportunity_v1;
CREATE FUNCTION public.dealer_save_opportunity(p_workspace uuid,p_id uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE saved uuid; target uuid:=p_id;
BEGIN
  IF target IS NULL THEN
    PERFORM 1 FROM public.contacts WHERE id=(p_data->>'contact_id')::uuid AND workspace_id=p_workspace FOR UPDATE;
    SELECT id INTO target FROM public.dealer_opportunities WHERE workspace_id=p_workspace AND contact_id=(p_data->>'contact_id')::uuid AND stage NOT IN ('won','lost');
  END IF;
  saved:=public.dealer_save_opportunity_v1(p_workspace,target,p_data);
  UPDATE public.dealer_opportunities SET buying_reason=coalesce(p_data->>'buying_reason',buying_reason),
    objection=coalesce(p_data->>'objection',objection),buyer_type=coalesce(p_data->>'buyer_type',buyer_type),
    lead_source=coalesce(p_data->>'lead_source',lead_source) WHERE id=saved AND workspace_id=p_workspace;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.dealer_appointment_execution_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status IN ('completed','no_show') AND NEW.starts_at>now() THEN RAISE EXCEPTION 'dealer_past'; END IF;
  IF TG_OP='UPDATE' AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.location IS DISTINCT FROM OLD.location) THEN
    NEW.customer_confirmed:=false; NEW.vehicle_prepared:=false; NEW.directions_sent:=false;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dealer_appointment_execution BEFORE INSERT OR UPDATE ON public.dealer_appointments FOR EACH ROW EXECUTE FUNCTION public.dealer_appointment_execution_guard();

ALTER TABLE public.automation_event_jobs DROP CONSTRAINT automation_event_jobs_event_type_check;
ALTER TABLE public.automation_event_jobs ADD CONSTRAINT automation_event_jobs_event_type_check
  CHECK(event_type IN ('tag_added','time_based','dealer_follow_up_due','dealer_appointment_reminder','dealer_no_show','dealer_post_visit'));
ALTER FUNCTION public.enqueue_dealer_automation_events() RENAME TO enqueue_dealer_automation_events_v1;
CREATE FUNCTION public.enqueue_dealer_automation_events() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE total integer; n integer;
BEGIN
  total:=public.enqueue_dealer_automation_events_v1();
  INSERT INTO public.automation_event_jobs(workspace_id,automation_id,contact_id,event_type,event_key,context,expires_at)
  SELECT ap.workspace_id,a.id,o.contact_id,a.trigger_type,'dealer:outcome:'||ap.id||':'||ap.status||':'||extract(epoch from ap.starts_at),
    jsonb_build_object('vars',jsonb_build_object('dealer_opportunity_id',o.id,'dealer_appointment_id',ap.id,
      'dealer_starts_at',to_char(ap.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'vehicle',v.year||' '||v.make||' '||v.model,'appointment_location',ap.location,
      'appointment_at',to_char(ap.starts_at AT TIME ZONE coalesce(w.timezone,'UTC'),'YYYY-MM-DD HH24:MI')||' ('||coalesce(w.timezone,'UTC')||')')),ap.ends_at+interval '1 day'
  FROM public.dealer_appointments ap
  JOIN public.dealer_opportunities o ON o.id=ap.opportunity_id AND o.workspace_id=ap.workspace_id
  JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
  JOIN public.dealer_vehicles v ON v.id=ap.vehicle_id AND v.workspace_id=ap.workspace_id
  JOIN public.workspaces w ON w.id=ap.workspace_id
  JOIN public.automations a ON a.workspace_id=ap.workspace_id AND
    a.trigger_type=CASE ap.status WHEN 'no_show' THEN 'dealer_no_show' WHEN 'completed' THEN 'dealer_post_visit' END
  WHERE a.is_active AND a.deleted_at IS NULL AND NOT c.opted_out AND NOT o.follow_up_paused AND o.stage NOT IN ('won','lost')
    AND v.status='available' AND ap.ends_at<=now() AND ap.ends_at>now()-interval '1 day'
    AND coalesce(o.last_contact_at,'-infinity')<ap.ends_at
    AND NOT EXISTS(SELECT 1 FROM public.dealer_appointments newer WHERE newer.opportunity_id=o.id AND newer.workspace_id=o.workspace_id AND newer.status IN ('requested','confirmed') AND newer.starts_at>ap.starts_at)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN total+n;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_dealer_automation_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dealer_automation_events() TO service_role;
ALTER FUNCTION public.dealer_automation_allowed(uuid,uuid,text,jsonb) RENAME TO dealer_automation_allowed_v1;
CREATE FUNCTION public.dealer_automation_allowed(p_workspace uuid,p_contact uuid,p_event text,p_vars jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN p_event IN ('dealer_no_show','dealer_post_visit') THEN EXISTS(
    SELECT 1 FROM public.dealer_appointments ap
    JOIN public.dealer_opportunities o ON o.id=ap.opportunity_id AND o.workspace_id=ap.workspace_id
    JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
    JOIN public.dealer_vehicles v ON v.id=ap.vehicle_id AND v.workspace_id=ap.workspace_id
    WHERE ap.workspace_id=p_workspace AND o.contact_id=p_contact AND ap.id::text=p_vars->>'dealer_appointment_id'
      AND o.id::text=p_vars->>'dealer_opportunity_id' AND NOT c.opted_out AND NOT o.follow_up_paused AND o.stage NOT IN ('won','lost')
      AND v.status='available' AND ap.status=CASE p_event WHEN 'dealer_no_show' THEN 'no_show' ELSE 'completed' END
      AND ap.ends_at<=now() AND ap.ends_at>now()-interval '1 day' AND coalesce(o.last_contact_at,'-infinity')<ap.ends_at
      AND to_char(ap.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=p_vars->>'dealer_starts_at'
      AND NOT EXISTS(SELECT 1 FROM public.dealer_appointments newer WHERE newer.opportunity_id=o.id AND newer.workspace_id=o.workspace_id AND newer.status IN ('requested','confirmed') AND newer.starts_at>ap.starts_at)
      AND NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations cv ON cv.id=m.conversation_id
        WHERE cv.workspace_id=p_workspace AND cv.contact_id=p_contact AND m.sender_type='customer' AND m.created_at>=ap.ends_at)
  ) ELSE public.dealer_automation_allowed_v1(p_workspace,p_contact,p_event,p_vars) END
  AND NOT EXISTS(SELECT 1 FROM public.dealer_opportunities o
    JOIN public.conversations cv ON cv.workspace_id=o.workspace_id AND cv.contact_id=o.contact_id
    JOIN public.messages m ON m.conversation_id=cv.id AND m.sender_type='customer'
    WHERE o.workspace_id=p_workspace AND o.contact_id=p_contact AND o.id::text=p_vars->>'dealer_opportunity_id'
      AND ((p_event='dealer_follow_up_due' AND m.created_at>=o.follow_up_set_at)
        OR (p_event='dealer_appointment_reminder' AND EXISTS(SELECT 1 FROM public.dealer_appointments ap
          WHERE ap.workspace_id=p_workspace AND ap.opportunity_id=o.id AND ap.id::text=p_vars->>'dealer_appointment_id' AND m.created_at>=ap.created_at))));
$$;
REVOKE ALL ON FUNCTION public.dealer_automation_allowed(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_automation_allowed(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
CREATE FUNCTION public.dealer_setting_number(p_workspace uuid,p_section text,p_key text,p_default integer) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT greatest(1,least(72,coalesce((SELECT (settings->p_section->>p_key)::integer FROM public.dealer_settings WHERE workspace_id=p_workspace),p_default)));
$$;
REVOKE ALL ON FUNCTION public.dealer_setting_number(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_setting_number(uuid,text,text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.enqueue_dealer_automation_events_v1() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer; total integer := 0;
BEGIN
  INSERT INTO public.automation_event_jobs(workspace_id,automation_id,contact_id,event_type,event_key,context,expires_at)
  SELECT o.workspace_id,a.id,o.contact_id,'dealer_follow_up_due',
    'dealer:followup:'||o.id||':'||extract(epoch from o.next_follow_up_at),
    jsonb_build_object('vars',jsonb_build_object('dealer_opportunity_id',o.id,
      'dealer_follow_up_at',to_char(o.next_follow_up_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
    o.next_follow_up_at+make_interval(hours=>public.dealer_setting_number(o.workspace_id,'follow_up','outcome_hours',24))
  FROM public.dealer_opportunities o
  JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
  JOIN public.automations a ON a.workspace_id=o.workspace_id AND a.trigger_type='dealer_follow_up_due'
  WHERE a.is_active AND a.deleted_at IS NULL AND NOT c.opted_out AND NOT o.follow_up_paused
    AND o.stage NOT IN ('won','lost') AND o.next_follow_up_at<=now()
    AND o.next_follow_up_at>now()-make_interval(hours=>public.dealer_setting_number(o.workspace_id,'follow_up','outcome_hours',24))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;

  INSERT INTO public.automation_event_jobs(workspace_id,automation_id,contact_id,event_type,event_key,context,expires_at)
  SELECT ap.workspace_id,a.id,o.contact_id,'dealer_appointment_reminder',
    'dealer:appointment:'||ap.id||':'||extract(epoch from ap.starts_at)||':'||md5(ap.location||'|'||ap.kind),
    jsonb_build_object('vars',jsonb_build_object('dealer_opportunity_id',o.id,'dealer_appointment_id',ap.id,
      'dealer_starts_at',to_char(ap.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'appointment_at',to_char(ap.starts_at AT TIME ZONE coalesce(w.timezone,'UTC'),'YYYY-MM-DD HH24:MI')||' ('||coalesce(w.timezone,'UTC')||')',
      'appointment_location',ap.location,'dealer_appointment_kind',ap.kind,'vehicle',v.year||' '||v.make||' '||v.model)),ap.starts_at
  FROM public.dealer_appointments ap
  JOIN public.dealer_opportunities o ON o.id=ap.opportunity_id AND o.workspace_id=ap.workspace_id
  JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
  JOIN public.dealer_vehicles v ON v.id=ap.vehicle_id AND v.workspace_id=ap.workspace_id
  JOIN public.workspaces w ON w.id=ap.workspace_id
  JOIN public.automations a ON a.workspace_id=ap.workspace_id AND a.trigger_type='dealer_appointment_reminder'
  WHERE a.is_active AND a.deleted_at IS NULL AND NOT c.opted_out AND NOT o.follow_up_paused
    AND o.stage NOT IN ('won','lost') AND ap.status='confirmed' AND v.status='available'
    AND ap.starts_at>now() AND ap.starts_at<=now()+make_interval(hours=>public.dealer_setting_number(ap.workspace_id,'appointments','reminder_hours',24))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN total+n;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_dealer_automation_events_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dealer_automation_events_v1() TO service_role;

-- Recheck live state before EVERY step, including after a wait or a queued retry.
CREATE OR REPLACE FUNCTION public.dealer_automation_allowed_v1(p_workspace uuid,p_contact uuid,p_event text,p_vars jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dealer_opportunities o
    JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
    WHERE o.workspace_id=p_workspace AND o.contact_id=p_contact AND o.id::text=p_vars->>'dealer_opportunity_id'
      AND NOT c.opted_out AND NOT o.follow_up_paused AND o.stage NOT IN ('won','lost')
      AND (
        (p_event='dealer_follow_up_due' AND o.next_follow_up_at<=now() AND o.next_follow_up_at>now()-make_interval(hours=>public.dealer_setting_number(o.workspace_id,'follow_up','outcome_hours',24))
          AND to_char(o.next_follow_up_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=p_vars->>'dealer_follow_up_at')
        OR
        (p_event='dealer_appointment_reminder' AND EXISTS (
          SELECT 1 FROM public.dealer_appointments ap JOIN public.dealer_vehicles v ON v.id=ap.vehicle_id AND v.workspace_id=ap.workspace_id
          WHERE ap.opportunity_id=o.id AND ap.workspace_id=p_workspace AND ap.id::text=p_vars->>'dealer_appointment_id'
            AND ap.status='confirmed' AND v.status='available' AND ap.starts_at>now() AND ap.starts_at<=now()+make_interval(hours=>public.dealer_setting_number(ap.workspace_id,'appointments','reminder_hours',24))
            AND ap.location=p_vars->>'appointment_location' AND ap.kind=p_vars->>'dealer_appointment_kind'
            AND to_char(ap.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=p_vars->>'dealer_starts_at'
        ))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.dealer_automation_allowed_v1(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_automation_allowed_v1(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
CREATE OR REPLACE FUNCTION public.enqueue_dealer_automation_events() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE total integer; n integer;
BEGIN
  total:=public.enqueue_dealer_automation_events_v1();
  INSERT INTO public.automation_event_jobs(workspace_id,automation_id,contact_id,event_type,event_key,context,expires_at)
  SELECT ap.workspace_id,a.id,o.contact_id,a.trigger_type,'dealer:outcome:'||ap.id||':'||ap.status||':'||extract(epoch from ap.starts_at),
    jsonb_build_object('vars',jsonb_build_object('dealer_opportunity_id',o.id,'dealer_appointment_id',ap.id,
      'dealer_starts_at',to_char(ap.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'vehicle',v.year||' '||v.make||' '||v.model,'appointment_location',ap.location,
      'appointment_at',to_char(ap.starts_at AT TIME ZONE coalesce(w.timezone,'UTC'),'YYYY-MM-DD HH24:MI')||' ('||coalesce(w.timezone,'UTC')||')')),ap.ends_at+make_interval(hours=>public.dealer_setting_number(ap.workspace_id,'follow_up','outcome_hours',24))
  FROM public.dealer_appointments ap
  JOIN public.dealer_opportunities o ON o.id=ap.opportunity_id AND o.workspace_id=ap.workspace_id
  JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
  JOIN public.dealer_vehicles v ON v.id=ap.vehicle_id AND v.workspace_id=ap.workspace_id
  JOIN public.workspaces w ON w.id=ap.workspace_id
  JOIN public.automations a ON a.workspace_id=ap.workspace_id AND
    a.trigger_type=CASE ap.status WHEN 'no_show' THEN 'dealer_no_show' WHEN 'completed' THEN 'dealer_post_visit' END
  WHERE a.is_active AND a.deleted_at IS NULL AND NOT c.opted_out AND NOT o.follow_up_paused AND o.stage NOT IN ('won','lost')
    AND v.status='available' AND ap.ends_at<=now() AND ap.ends_at>now()-make_interval(hours=>public.dealer_setting_number(ap.workspace_id,'follow_up','outcome_hours',24))
    AND coalesce(o.last_contact_at,'-infinity')<ap.ends_at
    AND NOT EXISTS(SELECT 1 FROM public.dealer_appointments newer WHERE newer.opportunity_id=o.id AND newer.workspace_id=o.workspace_id AND newer.status IN ('requested','confirmed') AND newer.starts_at>ap.starts_at)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN total+n;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_dealer_automation_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dealer_automation_events() TO service_role;

CREATE OR REPLACE FUNCTION public.dealer_automation_allowed_configured(p_workspace uuid,p_contact uuid,p_event text,p_vars jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN p_event IN ('dealer_no_show','dealer_post_visit') THEN EXISTS(
    SELECT 1 FROM public.dealer_appointments ap
    JOIN public.dealer_opportunities o ON o.id=ap.opportunity_id AND o.workspace_id=ap.workspace_id
    JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
    JOIN public.dealer_vehicles v ON v.id=ap.vehicle_id AND v.workspace_id=ap.workspace_id
    WHERE ap.workspace_id=p_workspace AND o.contact_id=p_contact AND ap.id::text=p_vars->>'dealer_appointment_id'
      AND o.id::text=p_vars->>'dealer_opportunity_id' AND NOT c.opted_out AND NOT o.follow_up_paused AND o.stage NOT IN ('won','lost')
      AND v.status='available' AND ap.status=CASE p_event WHEN 'dealer_no_show' THEN 'no_show' ELSE 'completed' END
      AND ap.ends_at<=now() AND ap.ends_at>now()-make_interval(hours=>public.dealer_setting_number(ap.workspace_id,'follow_up','outcome_hours',24)) AND coalesce(o.last_contact_at,'-infinity')<ap.ends_at
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
REVOKE ALL ON FUNCTION public.dealer_automation_allowed_configured(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_automation_allowed_configured(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';


CREATE OR REPLACE FUNCTION public.dealer_automation_allowed(p_workspace uuid,p_contact uuid,p_event text,p_vars jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.dealer_automation_allowed_configured(p_workspace,p_contact,p_event,p_vars)
 AND NOT EXISTS(SELECT 1 FROM public.dealer_settings s WHERE s.workspace_id=p_workspace AND (
  NOT coalesce((s.settings#>>'{follow_up,enabled}')::boolean,true)

 ));
$$;
REVOKE ALL ON FUNCTION public.dealer_automation_allowed(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_automation_allowed(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

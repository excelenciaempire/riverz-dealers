-- Dealer events reuse Riverz's durable queue, claims, logs and outbound gates.
ALTER TABLE public.automation_event_jobs DROP CONSTRAINT automation_event_jobs_event_type_check;
ALTER TABLE public.automation_event_jobs ADD CONSTRAINT automation_event_jobs_event_type_check
  CHECK (event_type IN ('tag_added','time_based','dealer_follow_up_due','dealer_appointment_reminder'));

CREATE FUNCTION public.enqueue_dealer_automation_events() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer; total integer := 0;
BEGIN
  INSERT INTO public.automation_event_jobs(workspace_id,automation_id,contact_id,event_type,event_key,context,expires_at)
  SELECT o.workspace_id,a.id,o.contact_id,'dealer_follow_up_due',
    'dealer:followup:'||o.id||':'||extract(epoch from o.next_follow_up_at),
    jsonb_build_object('vars',jsonb_build_object('dealer_opportunity_id',o.id,
      'dealer_follow_up_at',to_char(o.next_follow_up_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
    o.next_follow_up_at+interval '1 day'
  FROM public.dealer_opportunities o
  JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
  JOIN public.automations a ON a.workspace_id=o.workspace_id AND a.trigger_type='dealer_follow_up_due'
  WHERE a.is_active AND a.deleted_at IS NULL AND NOT c.opted_out AND NOT o.follow_up_paused
    AND o.stage NOT IN ('won','lost') AND o.next_follow_up_at<=now()
    AND o.next_follow_up_at>now()-interval '1 day'
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
    AND ap.starts_at>now() AND ap.starts_at<=now()+interval '24 hours'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN total+n;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_dealer_automation_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dealer_automation_events() TO service_role;

-- Recheck live state before EVERY step, including after a wait or a queued retry.
CREATE FUNCTION public.dealer_automation_allowed(p_workspace uuid,p_contact uuid,p_event text,p_vars jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dealer_opportunities o
    JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
    WHERE o.workspace_id=p_workspace AND o.contact_id=p_contact AND o.id::text=p_vars->>'dealer_opportunity_id'
      AND NOT c.opted_out AND NOT o.follow_up_paused AND o.stage NOT IN ('won','lost')
      AND (
        (p_event='dealer_follow_up_due' AND o.next_follow_up_at<=now() AND o.next_follow_up_at>now()-interval '1 day'
          AND to_char(o.next_follow_up_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=p_vars->>'dealer_follow_up_at')
        OR
        (p_event='dealer_appointment_reminder' AND EXISTS (
          SELECT 1 FROM public.dealer_appointments ap JOIN public.dealer_vehicles v ON v.id=ap.vehicle_id AND v.workspace_id=ap.workspace_id
          WHERE ap.opportunity_id=o.id AND ap.workspace_id=p_workspace AND ap.id::text=p_vars->>'dealer_appointment_id'
            AND ap.status='confirmed' AND v.status='available' AND ap.starts_at>now() AND ap.starts_at<=now()+interval '24 hours'
            AND ap.location=p_vars->>'appointment_location' AND ap.kind=p_vars->>'dealer_appointment_kind'
            AND to_char(ap.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=p_vars->>'dealer_starts_at'
        ))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.dealer_automation_allowed(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_automation_allowed(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';

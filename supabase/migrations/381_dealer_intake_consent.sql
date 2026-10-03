-- External leads without messaging consent remain paused until the seller authorizes follow-up.
BEGIN;
CREATE OR REPLACE FUNCTION public.dealer_ingest_lead(p_workspace uuid,p_lead jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c uuid; o uuid; owner uuid; settings jsonb; receipt public.dealer_lead_receipts; new_contact boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('dealer-lead:'||p_workspace));
 SELECT * INTO receipt FROM public.dealer_lead_receipts WHERE workspace_id=p_workspace AND external_id=p_lead->>'external_id';
 IF FOUND THEN RETURN jsonb_build_object('contact_id',receipt.contact_id,'opportunity_id',receipt.opportunity_id,'duplicate',true); END IF;
 SELECT w.owner_id,s.settings INTO owner,settings FROM public.workspaces w LEFT JOIN public.dealer_settings s ON s.workspace_id=w.id WHERE w.id=p_workspace;
 IF owner IS NULL OR NOT coalesce((settings#>>'{leads,webhook_enabled}')::boolean,false) THEN RAISE EXCEPTION 'dealer_closed'; END IF;
 IF coalesce(p_lead->>'phone','') !~ '^\+[1-9][0-9]{7,14}$' OR coalesce(length(p_lead->>'external_id'),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'dealer_reference'; END IF;
 SELECT id INTO c FROM public.contacts WHERE workspace_id=p_workspace AND regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_lead->>'phone','[^0-9]','','g') ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF c IS NULL THEN
  new_contact:=true;
  INSERT INTO public.contacts(workspace_id,user_id,phone,name,email) VALUES(p_workspace,owner,p_lead->>'phone',p_lead->>'name',nullif(p_lead->>'email','')) RETURNING id INTO c;
 END IF;
 SELECT id INTO o FROM public.dealer_opportunities WHERE workspace_id=p_workspace AND contact_id=c AND stage NOT IN ('won','lost') FOR UPDATE;
 IF o IS NULL AND coalesce((settings#>>'{leads,capture_enabled}')::boolean,true) AND NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=c AND opted_out) THEN
  INSERT INTO public.dealer_opportunities(workspace_id,contact_id) VALUES(p_workspace,c) RETURNING id INTO o;
 END IF;
 IF o IS NOT NULL THEN
  UPDATE public.dealer_opportunities SET follow_up_paused=CASE WHEN new_contact AND NOT coalesce((p_lead->>'consent')::boolean,false) THEN true ELSE follow_up_paused END, lead_source=CASE WHEN lead_source IN ('','direct') THEN p_lead->>'source' ELSE lead_source END,
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

NOTIFY pgrst,'reload schema';
COMMIT;

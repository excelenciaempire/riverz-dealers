BEGIN;
-- A deadline can be restored later (24 -> 72 -> 24). Archive the previous
-- delivery scope, retaining its original deadline, status and sent timestamp,
-- so an earlier accepted pause/reminder does not suppress the new notice.
CREATE OR REPLACE FUNCTION public.admin_set_billing_grace(p_workspace uuid,p_hours integer,p_actor uuid,p_expected integer,p_actor_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous integer; deadline timestamptz; cycle text:=gen_random_uuid()::text;
BEGIN
 IF p_hours NOT BETWEEN 24 AND 720 OR p_hours IS NULL OR p_actor IS NULL OR nullif(trim(p_actor_email),'') IS NULL THEN RAISE EXCEPTION 'billing_invalid_grace'; END IF;
 SELECT grace_hours INTO previous FROM workspace_subscriptions WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'billing_subscription_missing'; END IF;
 IF p_expected IS NULL OR previous<>p_expected THEN RAISE EXCEPTION 'billing_policy_conflict'; END IF;
 IF previous<>p_hours THEN
  UPDATE workspace_billing_notices n SET schedule_key='previous:'||cycle||':'||n.schedule_key,
   status=CASE WHEN n.status='pending' THEN 'cancelled' ELSE n.status END,lease_id=NULL,lease_until=NULL
   WHERE n.workspace_id=p_workspace AND n.phase<>'active' AND n.schedule_key NOT LIKE 'previous:%'
    AND (EXISTS (SELECT 1 FROM workspace_billing_invoices i WHERE i.invoice_id=n.invoice_id
     AND i.status IN ('open','uncollectible') AND i.amount_remaining>0)
     OR n.invoice_id LIKE 'legacy:'||p_workspace::text||':%');
 END IF;
 UPDATE workspace_subscriptions SET grace_hours=p_hours,updated_at=now() WHERE workspace_id=p_workspace;
 SELECT min(grace_until) INTO deadline FROM workspace_billing_invoices WHERE workspace_id=p_workspace
  AND status IN ('open','uncollectible') AND amount_remaining>0;
 INSERT INTO admin_audit_log(actor_id,actor_email,action,target_type,target_id,meta)
 VALUES(p_actor,p_actor_email,'update.billing_subscription','workspace',p_workspace::text,
  jsonb_build_object('graceHoursBefore',previous,'graceHoursAfter',p_hours,'graceUntil',deadline,'noticeCycle',cycle));
 RETURN jsonb_build_object('graceHours',p_hours,'graceUntil',deadline,'readOnly',NOT workspace_billing_write_allowed(p_workspace));
END $$;
COMMIT;

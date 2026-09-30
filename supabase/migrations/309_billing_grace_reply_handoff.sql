BEGIN;
-- Capture grace-period receipts too: an AI turn may cross the exact expiry.
CREATE OR REPLACE FUNCTION public.defer_billing_inbound_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record;
BEGIN
 IF NEW.sender_type='customer' AND NEW.billing_recovery_eligible THEN
  SELECT workspace_id,connection_id INTO c FROM conversations WHERE id=NEW.conversation_id;
  IF c.workspace_id IS NOT NULL AND (
   EXISTS (SELECT 1 FROM workspace_billing_invoices i WHERE i.workspace_id=c.workspace_id
    AND i.status IN ('open','uncollectible') AND i.amount_remaining>0 AND i.unpaid_since<=now() AND NEW.created_at>=i.unpaid_since)
   OR EXISTS (SELECT 1 FROM workspace_subscriptions s WHERE s.workspace_id=c.workspace_id AND s.estado='vencida'
    AND NEW.created_at>=s.vencida_desde)) THEN
   INSERT INTO billing_reply_backlog(inbound_message_id,workspace_id,conversation_id,connection_id)
    VALUES(NEW.id,c.workspace_id,NEW.conversation_id,c.connection_id) ON CONFLICT(inbound_message_id) DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Grace still has a normal live responder. Recovery owns work only after payment.
CREATE FUNCTION public.billing_recovery_payment_cleared(p_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.workspace_billing_write_allowed(p_workspace)
  AND NOT EXISTS (SELECT 1 FROM workspace_billing_invoices i WHERE i.workspace_id=p_workspace
   AND i.status IN ('open','uncollectible') AND i.amount_remaining>0 AND i.unpaid_since<=now())
  AND NOT EXISTS (SELECT 1 FROM workspace_subscriptions s WHERE s.workspace_id=p_workspace AND s.estado='vencida');
$$;
REVOKE ALL ON FUNCTION public.billing_recovery_payment_cleared(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_recovery_payment_cleared(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_billing_reply_backlog(p_limit integer DEFAULT 4)
RETURNS SETOF public.billing_reply_backlog LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE billing_reply_backlog b SET status='processing',attempts=b.attempts+1,
  lease_id=gen_random_uuid(),lease_until=now()+interval '15 minutes'
 WHERE b.inbound_message_id IN (
  SELECT q.inbound_message_id FROM billing_reply_backlog q
  WHERE q.status IN ('pending','processing') AND q.next_attempt_at<=now()
   AND q.queued_at<now()-interval '1 minute'
   AND (q.lease_until IS NULL OR q.lease_until<=now())
   AND public.billing_recovery_payment_cleared(q.workspace_id)
   AND NOT EXISTS (SELECT 1 FROM billing_reply_backlog running WHERE running.conversation_id=q.conversation_id
    AND running.inbound_message_id<>q.inbound_message_id AND running.status='processing' AND running.lease_until>now())
   AND q.inbound_message_id=(SELECT first.inbound_message_id FROM billing_reply_backlog first
    WHERE first.conversation_id=q.conversation_id AND first.status IN ('pending','processing')
     AND first.next_attempt_at<=now() AND (first.lease_until IS NULL OR first.lease_until<=now())
    ORDER BY first.queued_at,first.inbound_message_id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM workspace_billing_invoices i WHERE i.workspace_id=q.workspace_id
    AND i.status='paid' AND i.paid_confirmed_at>now()-interval '1 minute')
  ORDER BY q.queued_at FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,0),20)
 ) RETURNING b.*;
$$;
REVOKE ALL ON FUNCTION public.defer_billing_inbound_reply() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_billing_reply_backlog(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_reply_backlog(integer) TO service_role;
COMMIT;

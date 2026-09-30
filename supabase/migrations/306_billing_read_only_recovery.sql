BEGIN;

-- A single clock and decision for API writes, authenticated RLS and outbound sends.
CREATE OR REPLACE FUNCTION public.workspace_billing_write_allowed(p_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM workspace_billing_invoices
    WHERE workspace_id = p_workspace AND status IN ('open','uncollectible')
      AND amount_remaining > 0 AND grace_until <= now()
  ) AND NOT EXISTS (
    SELECT 1 FROM workspace_subscriptions s
    WHERE s.workspace_id = p_workspace AND s.estado = 'vencida'
      AND s.vencida_desde + interval '24 hours' <= now()
      AND NOT EXISTS (SELECT 1 FROM workspace_billing_invoices i
        WHERE i.workspace_id = s.workspace_id AND i.status IN ('open','uncollectible') AND i.amount_remaining > 0)
  );
$$;
REVOKE ALL ON FUNCTION public.workspace_billing_write_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_billing_write_allowed(uuid) TO authenticated, service_role;

-- Repeated reconciliation must not restart the short native-echo settling wait.
ALTER TABLE public.workspace_billing_invoices ADD COLUMN paid_confirmed_at timestamptz;
UPDATE public.workspace_billing_invoices SET paid_confirmed_at=updated_at WHERE status='paid';
CREATE FUNCTION public.billing_stamp_paid_invoice()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='paid' THEN
   IF TG_OP='UPDATE' AND OLD.status='paid' THEN NEW.paid_confirmed_at:=coalesce(OLD.paid_confirmed_at,now());
   ELSE NEW.paid_confirmed_at:=now(); END IF;
 ELSE NEW.paid_confirmed_at:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.billing_stamp_paid_invoice() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_stamp_paid BEFORE INSERT OR UPDATE ON public.workspace_billing_invoices
 FOR EACH ROW EXECUTE FUNCTION public.billing_stamp_paid_invoice();

-- Restrictive policies add a billing condition without broadening existing access.
-- SELECT is deliberately unchanged. Service-role webhook ingestion still writes.
DO $$
DECLARE t record; command text; predicate text; parent record;
BEGIN
  FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
  LOOP
    predicate := NULL;
    IF t.relname='workspaces' THEN
      predicate := 'public.workspace_billing_write_allowed(id)';
    ELSIF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='workspace_id' AND NOT attisdropped) THEN
      predicate := 'public.workspace_billing_write_allowed(workspace_id)';
    ELSE
      -- Child tables (messages, comment metadata, agent-channel scopes, etc.)
      -- inherit the guard from their tenant parent, without blocking SELECT.
      FOR parent IN
        SELECT child.attname child_column, pc.relname parent_table, pa.attname parent_column,
          CASE WHEN pc.relname='workspaces' THEN 'id' ELSE 'workspace_id' END workspace_column
        FROM pg_constraint fk
        JOIN pg_attribute child ON child.attrelid=fk.conrelid AND child.attnum=fk.conkey[1]
        JOIN pg_class pc ON pc.oid=fk.confrelid
        JOIN pg_namespace pn ON pn.oid=pc.relnamespace
        JOIN pg_attribute pa ON pa.attrelid=pc.oid AND pa.attnum=fk.confkey[1]
        WHERE fk.contype='f' AND fk.conrelid=t.oid AND array_length(fk.conkey,1)=1 AND pn.nspname='public'
          AND (pc.relname='workspaces' OR EXISTS (SELECT 1 FROM pg_attribute wa
            WHERE wa.attrelid=pc.oid AND wa.attname='workspace_id' AND NOT wa.attisdropped))
      LOOP
        predicate := concat_ws(' AND ',predicate,format(
          'NOT EXISTS (SELECT 1 FROM public.%I billing_parent WHERE billing_parent.%I = %I.%I AND NOT public.workspace_billing_write_allowed(billing_parent.%I))',
          parent.parent_table,parent.parent_column,t.relname,parent.child_column,parent.workspace_column));
      END LOOP;
      IF predicate IS NULL AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='user_id' AND NOT attisdropped)
        AND t.relname NOT IN ('profiles','legal_consents') THEN
        predicate := format('NOT EXISTS (SELECT 1 FROM public.workspaces billing_owner WHERE billing_owner.owner_id = %I.user_id AND NOT public.workspace_billing_write_allowed(billing_owner.id))',t.relname);
      END IF;
    END IF;
    IF predicate IS NOT NULL THEN
      FOREACH command IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I','billing_readonly_'||lower(command),t.relname);
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
          'billing_readonly_'||lower(command),t.relname,command,
          CASE command WHEN 'INSERT' THEN 'WITH CHECK ('||predicate||')'
            WHEN 'UPDATE' THEN 'USING ('||predicate||') WITH CHECK ('||predicate||')'
            ELSE 'USING ('||predicate||')' END);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Browser uploads/deletions use Storage directly; service-role receipt media stays open.
DO $$ DECLARE command text; predicate text :=
  'NOT EXISTS (SELECT 1 FROM public.workspaces billing_upload WHERE billing_upload.owner_id=auth.uid() AND NOT public.workspace_billing_write_allowed(billing_upload.id))';
BEGIN
  FOREACH command IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    EXECUTE format('CREATE POLICY %I ON storage.objects AS RESTRICTIVE FOR %s TO authenticated %s',
      'billing_readonly_'||lower(command),command,
      CASE command WHEN 'INSERT' THEN 'WITH CHECK ('||predicate||')'
        WHEN 'UPDATE' THEN 'USING ('||predicate||') WITH CHECK ('||predicate||')'
        ELSE 'USING ('||predicate||')' END);
  END LOOP;
END $$;

-- Extend to grandchildren, including comment sidecars linked through messages.
DO $$
DECLARE depth integer; t record; parent record; command text; predicate text;
BEGIN
  FOR depth IN 1..6 LOOP
    FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=c.oid AND polname='billing_readonly_insert')
    LOOP
      predicate := NULL;
      FOR parent IN SELECT child.attname child_column,pc.relname parent_table,pa.attname parent_column,
          pg_get_expr(pol.polwithcheck,pol.polrelid) parent_guard
        FROM pg_constraint fk
        JOIN pg_attribute child ON child.attrelid=fk.conrelid AND child.attnum=fk.conkey[1]
        JOIN pg_class pc ON pc.oid=fk.confrelid
        JOIN pg_attribute pa ON pa.attrelid=pc.oid AND pa.attnum=fk.confkey[1]
        JOIN pg_policy pol ON pol.polrelid=pc.oid AND pol.polname='billing_readonly_insert'
        WHERE fk.contype='f' AND fk.conrelid=t.oid AND fk.confrelid<>t.oid AND array_length(fk.conkey,1)=1
      LOOP
        predicate := concat_ws(' AND ',predicate,format(
          'NOT EXISTS (SELECT 1 FROM public.%I WHERE %I.%I = %I.%I AND NOT (%s))',
          parent.parent_table,parent.parent_table,parent.parent_column,t.relname,parent.child_column,parent.parent_guard));
      END LOOP;
      IF predicate IS NOT NULL THEN
        FOREACH command IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
          EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
            'billing_readonly_'||lower(command),t.relname,command,
            CASE command WHEN 'INSERT' THEN 'WITH CHECK ('||predicate||')'
              WHEN 'UPDATE' THEN 'USING ('||predicate||') WITH CHECK ('||predicate||')'
              ELSE 'USING ('||predicate||')' END);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- SECURITY DEFINER RPCs retain the caller's JWT role. Protect their writes too.
CREATE FUNCTION public.billing_enforce_business_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE predicate text; allowed boolean; row_data jsonb;
BEGIN
  IF auth.role()='authenticated' OR current_setting('role',true)='authenticated' THEN
    SELECT pg_get_expr(polwithcheck,polrelid) INTO predicate FROM pg_policy
      WHERE polrelid=TG_RELID AND polname='billing_readonly_insert';
    IF predicate IS NOT NULL THEN
      IF TG_OP IN ('UPDATE','DELETE') THEN
        row_data := to_jsonb(OLD);
        EXECUTE format('SELECT (%s) FROM jsonb_populate_record(NULL::public.%I,$1) AS %I',predicate,TG_TABLE_NAME,TG_TABLE_NAME)
          INTO allowed USING row_data;
        IF NOT coalesce(allowed,false) THEN RAISE EXCEPTION 'subscription_read_only' USING ERRCODE='42501'; END IF;
      END IF;
      IF TG_OP IN ('INSERT','UPDATE') THEN
        row_data := to_jsonb(NEW);
        EXECUTE format('SELECT (%s) FROM jsonb_populate_record(NULL::public.%I,$1) AS %I',predicate,TG_TABLE_NAME,TG_TABLE_NAME)
          INTO allowed USING row_data;
        IF NOT coalesce(allowed,false) THEN RAISE EXCEPTION 'subscription_read_only' USING ERRCODE='42501'; END IF;
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION public.billing_enforce_business_write() FROM PUBLIC,anon,authenticated;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=c.oid AND polname='billing_readonly_insert')
  LOOP
    EXECUTE format('CREATE TRIGGER billing_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.billing_enforce_business_write()',t.relname);
  END LOOP;
END $$;

CREATE TABLE public.billing_reply_backlog (
  inbound_message_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.channel_connections(id) ON DELETE SET NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','review')),
  outcome text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  finished_at timestamptz
);
CREATE INDEX billing_reply_backlog_due ON public.billing_reply_backlog(next_attempt_at)
  WHERE status IN ('pending','processing');
ALTER TABLE public.billing_reply_backlog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_reply_backlog FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_reply_backlog TO service_role;
ALTER TABLE public.messages ADD COLUMN billing_recovery_eligible boolean NOT NULL DEFAULT true;
CREATE FUNCTION public.defer_billing_inbound_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record;
BEGIN
  IF NEW.sender_type='customer' AND NEW.billing_recovery_eligible THEN
    SELECT workspace_id,connection_id INTO c FROM conversations WHERE id=NEW.conversation_id;
    IF c.workspace_id IS NOT NULL AND NOT public.workspace_billing_write_allowed(c.workspace_id)
      AND NEW.created_at>=coalesce(
        (SELECT min(i.grace_until) FROM workspace_billing_invoices i WHERE i.workspace_id=c.workspace_id
          AND i.status IN ('open','uncollectible') AND i.amount_remaining>0 AND i.grace_until<=now()),
        (SELECT s.vencida_desde+interval '24 hours' FROM workspace_subscriptions s WHERE s.workspace_id=c.workspace_id)) THEN
      INSERT INTO billing_reply_backlog(inbound_message_id,workspace_id,conversation_id,connection_id)
        VALUES(NEW.id,c.workspace_id,NEW.conversation_id,c.connection_id)
        ON CONFLICT(inbound_message_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.defer_billing_inbound_reply() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_defer_inbound AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.defer_billing_inbound_reply();

CREATE FUNCTION public.claim_billing_reply_backlog(p_limit integer DEFAULT 4)
RETURNS SETOF public.billing_reply_backlog LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE billing_reply_backlog b SET status='processing', attempts=b.attempts+1,
    lease_id=gen_random_uuid(), lease_until=now()+interval '15 minutes'
  WHERE b.inbound_message_id IN (
    SELECT q.inbound_message_id FROM billing_reply_backlog q
    WHERE q.status IN ('pending','processing') AND q.next_attempt_at <= now()
      AND q.queued_at < now()-interval '1 minute'
      AND (q.lease_until IS NULL OR q.lease_until <= now())
      AND NOT EXISTS (SELECT 1 FROM billing_reply_backlog running WHERE running.conversation_id=q.conversation_id
        AND running.inbound_message_id<>q.inbound_message_id AND running.status='processing' AND running.lease_until>now())
      AND q.inbound_message_id=(SELECT first.inbound_message_id FROM billing_reply_backlog first
        WHERE first.conversation_id=q.conversation_id AND first.status IN ('pending','processing')
          AND first.next_attempt_at<=now() AND (first.lease_until IS NULL OR first.lease_until<=now())
        ORDER BY first.queued_at,first.inbound_message_id LIMIT 1)
      AND public.workspace_billing_write_allowed(q.workspace_id)
      AND NOT EXISTS (SELECT 1 FROM workspace_billing_invoices i WHERE i.workspace_id=q.workspace_id
        AND i.status='paid' AND i.paid_confirmed_at>now()-interval '1 minute')
    ORDER BY q.queued_at FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,0),20)
  ) RETURNING b.*;
$$;
REVOKE ALL ON FUNCTION public.claim_billing_reply_backlog(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_reply_backlog(integer) TO service_role;

CREATE TABLE public.workspace_billing_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('pending','reminder6','reminder1','paused','active')),
  channel text NOT NULL CHECK (channel IN ('whatsapp','email')),
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (workspace_id,invoice_id,phase,channel,recipient)
);
CREATE INDEX workspace_billing_notices_due ON public.workspace_billing_notices(next_attempt_at)
  WHERE status='pending';
ALTER TABLE public.workspace_billing_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_billing_notices FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_billing_notices TO service_role;

CREATE FUNCTION public.claim_billing_notices(p_limit integer DEFAULT 20)
RETURNS SETOF public.workspace_billing_notices LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE workspace_billing_notices b SET attempts=b.attempts+1,
    lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
  WHERE b.id IN (
    SELECT q.id FROM workspace_billing_notices q WHERE q.status='pending'
      AND q.next_attempt_at <= now() AND (q.lease_until IS NULL OR q.lease_until <= now())
    ORDER BY q.created_at FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,0),50)
  ) RETURNING b.*;
$$;
REVOKE ALL ON FUNCTION public.claim_billing_notices(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_notices(integer) TO service_role;
CREATE FUNCTION public.billing_notice_accounts()
RETURNS TABLE(workspace_id uuid,invoice_id text) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT i.workspace_id,i.invoice_id FROM workspace_billing_invoices i
    WHERE i.status IN ('open','uncollectible') AND i.amount_remaining>0 AND i.unpaid_since<=now()
  UNION
  SELECT s.workspace_id,'legacy:'||s.workspace_id::text||':'||to_char(s.vencida_desde AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM workspace_subscriptions s
    WHERE s.estado='vencida' AND s.vencida_desde<=now()-interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM workspace_billing_invoices i WHERE i.workspace_id=s.workspace_id
        AND i.status IN ('open','uncollectible') AND i.amount_remaining>0)
  UNION
  SELECT n.workspace_id,n.invoice_id FROM workspace_billing_notices n WHERE n.phase<>'active'
    AND NOT EXISTS (SELECT 1 FROM workspace_billing_notices a WHERE a.workspace_id=n.workspace_id
      AND a.invoice_id=n.invoice_id AND a.phase='active');
$$;
REVOKE ALL ON FUNCTION public.billing_notice_accounts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_notice_accounts() TO service_role;
COMMIT;

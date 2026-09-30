BEGIN;
-- Legacy overdue rows must have a real clock instead of perpetual grace.
UPDATE public.workspace_subscriptions SET vencida_desde = now()
  WHERE estado = 'vencida' AND vencida_desde IS NULL;
-- Invoice debt is independent of prepaid AI credit and subscription status.
CREATE TABLE public.workspace_billing_invoices (
  invoice_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subscription_id text NOT NULL,
  customer_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','open','paid','void','uncollectible')),
  amount_remaining bigint NOT NULL CHECK (amount_remaining >= 0),
  currency text NOT NULL,
  hosted_invoice_url text,
  unpaid_since timestamptz NOT NULL,
  grace_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (grace_until = unpaid_since + interval '24 hours')
);
CREATE INDEX workspace_billing_invoices_pending ON public.workspace_billing_invoices(workspace_id, unpaid_since)
  WHERE status IN ('open','uncollectible') AND amount_remaining > 0;
ALTER TABLE public.workspace_billing_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_billing_invoices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_billing_invoices TO service_role;

-- Preserve the first deadline across retries and concurrent webhook delivery.
-- Stripe cannot reopen a paid or voided invoice; a late failure cannot either.
CREATE FUNCTION public.record_subscription_invoice(p_invoice jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO workspace_billing_invoices AS existing
    (invoice_id, workspace_id, subscription_id, customer_id, status, amount_remaining,
     currency, hosted_invoice_url, unpaid_since, grace_until)
  VALUES (p_invoice->>'invoice_id', (p_invoice->>'workspace_id')::uuid,
    p_invoice->>'subscription_id', p_invoice->>'customer_id', p_invoice->>'status',
    (p_invoice->>'amount_remaining')::bigint, p_invoice->>'currency', p_invoice->>'hosted_invoice_url',
    (p_invoice->>'unpaid_since')::timestamptz,
    (p_invoice->>'unpaid_since')::timestamptz + interval '24 hours')
  ON CONFLICT (invoice_id) DO UPDATE SET
    status = EXCLUDED.status, amount_remaining = EXCLUDED.amount_remaining,
    hosted_invoice_url = EXCLUDED.hosted_invoice_url,
    unpaid_since = least(existing.unpaid_since, EXCLUDED.unpaid_since),
    grace_until = least(existing.unpaid_since, EXCLUDED.unpaid_since) + interval '24 hours',
    updated_at = now()
  WHERE existing.workspace_id = EXCLUDED.workspace_id
    AND (existing.status NOT IN ('paid','void') OR existing.status = EXCLUDED.status);
$$;
REVOKE ALL ON FUNCTION public.record_subscription_invoice(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_invoice(jsonb) TO service_role;
COMMIT;

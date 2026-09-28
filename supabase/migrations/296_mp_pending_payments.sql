BEGIN;

CREATE TABLE public.mp_pending_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mp_payment_id text NOT NULL,
  payment_created_at timestamptz NOT NULL,
  expires_at timestamptz,
  status text NOT NULL,
  status_detail text,
  payer_name text,
  email text,
  phone text,
  amount numeric(12,2),
  currency text,
  payment_method text,
  external_reference text,
  payment_url text,
  dispatched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, mp_payment_id)
);
CREATE INDEX mp_pending_queue ON public.mp_pending_payments(payment_created_at)
  WHERE dispatched_at IS NULL AND status = 'pending' AND phone IS NOT NULL;
ALTER TABLE public.mp_pending_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read mp pending" ON public.mp_pending_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = mp_pending_payments.workspace_id AND wm.user_id = auth.uid())
);
GRANT SELECT ON public.mp_pending_payments TO authenticated;
GRANT ALL ON public.mp_pending_payments TO service_role;

-- Shared by Shopify and Mercado Pago. Only one reminder sequence per phone
-- can send during its 48-hour window; each sequence can send its own follow-ups.
CREATE TABLE public.pending_payment_sequences (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone text NOT NULL,
  owner_log_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, phone)
);
ALTER TABLE public.pending_payment_sequences ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.pending_payment_sequences TO service_role;

CREATE FUNCTION public.claim_pending_payment_sequence(
  p_workspace_id uuid, p_phone text, p_log_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed uuid;
BEGIN
  IF p_phone !~ '^[0-9]{8,15}$' OR p_phone IS NULL OR p_log_id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.pending_payment_sequences(workspace_id,phone,owner_log_id,expires_at)
  VALUES(p_workspace_id,p_phone,p_log_id,now()+interval '48 hours')
  ON CONFLICT(workspace_id,phone) DO UPDATE
    SET owner_log_id=EXCLUDED.owner_log_id, expires_at=EXCLUDED.expires_at
    WHERE pending_payment_sequences.expires_at <= now()
  RETURNING owner_log_id INTO claimed;
  IF claimed IS NOT NULL THEN RETURN claimed=p_log_id; END IF;
  SELECT owner_log_id INTO claimed FROM public.pending_payment_sequences
    WHERE workspace_id=p_workspace_id AND phone=p_phone;
  RETURN claimed=p_log_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_payment_sequence(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_payment_sequence(uuid,text,uuid) TO service_role;

-- Existing installs of the pending-order recipe receive idempotency metadata,
-- not different steps, templates, prices or activation state.
UPDATE public.automations a SET trigger_config=coalesce(a.trigger_config,'{}'::jsonb)
  || '{"pending_payment_reminder":true}'::jsonb
WHERE a.trigger_type='shopify_order_created' AND a.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.automation_steps s WHERE s.automation_id=a.id
    AND s.step_type='condition' AND s.parent_step_id IS NULL
    AND s.step_config->>'subject'='context_var'
    AND s.step_config->>'operand'='financial_status'
    AND s.step_config->>'value'='pending')
  AND EXISTS (SELECT 1 FROM public.automation_steps s WHERE s.automation_id=a.id
    AND s.step_type='condition' AND s.step_config->>'subject'='order_paid'
    AND s.step_config->>'value'='false');
COMMIT;

ALTER TABLE public.affiliate_partners
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));

ALTER TABLE public.affiliate_commissions
  ADD COLUMN IF NOT EXISTS paid_commission_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_commission_cents >= 0),
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

-- El importe transferido nunca cambia aunque haya un reembolso posterior.
UPDATE public.affiliate_commissions SET paid_commission_cents = commission_cents
WHERE status = 'paid' AND paid_commission_cents = 0;

CREATE OR REPLACE FUNCTION public.reconcile_affiliate_commission(
  p_invoice_id TEXT, p_refunded_cents INTEGER, p_synced_at TIMESTAMPTZ
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.affiliate_commissions;
  refunded INTEGER;
  earned INTEGER;
BEGIN
  SELECT * INTO c FROM public.affiliate_commissions
  WHERE stripe_invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR (c.reconciled_at IS NOT NULL AND c.reconciled_at > p_synced_at) THEN RETURN; END IF;
  refunded := LEAST(c.gross_cents, GREATEST(0, p_refunded_cents));
  earned := round((c.gross_cents - refunded)::NUMERIC * c.commission_bps / 10000)::INTEGER;
  UPDATE public.affiliate_commissions SET
    refunded_cents = refunded,
    commission_cents = earned,
    status = CASE WHEN c.paid_at IS NOT NULL THEN 'paid' WHEN earned = 0 THEN 'reversed' ELSE 'pending' END,
    reversed_at = CASE WHEN earned = 0 THEN COALESCE(c.reversed_at, now()) ELSE NULL END,
    reconciled_at = p_synced_at,
    updated_at = now()
  WHERE id = c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_affiliate_commission(TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_affiliate_commission(TEXT, INTEGER, TIMESTAMPTZ) TO service_role;

-- El registro de un pago y una conciliacion no pueden pisarse entre si.
CREATE OR REPLACE FUNCTION public.mark_affiliate_commission_paid(
  p_id UUID, p_expected_cents INTEGER
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.affiliate_commissions;
BEGIN
  SELECT * INTO c FROM public.affiliate_commissions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'pending' OR c.available_at > now()
    OR c.commission_cents <= 0 OR c.commission_cents <> p_expected_cents
    OR c.reconciled_at IS NULL OR c.reconciled_at < now() - interval '5 minutes'
  THEN RETURN FALSE; END IF;
  UPDATE public.affiliate_commissions SET status = 'paid', paid_at = now(),
    paid_commission_cents = commission_cents, updated_at = now() WHERE id = p_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_affiliate_commission_paid(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_affiliate_commission_paid(UUID, INTEGER) TO service_role;

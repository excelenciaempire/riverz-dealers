-- Ajustes idempotentes para notas de credito de Stripe.
-- Conservamos la base original y acumulamos el importe reembolsado para que
-- reintentos o varias notas de credito nunca descuenten dos veces.

ALTER TABLE public.affiliate_commissions
  ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0
  CHECK (refunded_cents >= 0);

CREATE TABLE IF NOT EXISTS public.affiliate_commission_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id UUID NOT NULL
    REFERENCES public.affiliate_commissions(id) ON DELETE RESTRICT,
  stripe_object_id TEXT NOT NULL UNIQUE,
  stripe_event_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('applied', 'voided')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_commission_adjustments_commission
  ON public.affiliate_commission_adjustments(commission_id, status);

ALTER TABLE public.affiliate_commission_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.affiliate_commission_adjustments FROM anon, authenticated;

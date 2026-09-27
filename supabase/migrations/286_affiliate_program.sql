-- Programa de afiliados de Riverz.
--
-- La atribucion se fija una sola vez al crear la cuenta y la comision nace
-- exclusivamente de una factura de Stripe pagada. Los reintentos del webhook
-- no duplican dinero porque stripe_invoice_id es unico.

CREATE TABLE IF NOT EXISTS public.affiliate_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  website TEXT,
  audience TEXT NOT NULL CHECK (char_length(audience) BETWEEN 2 AND 120),
  promotion_plan TEXT NOT NULL CHECK (char_length(promotion_plan) BETWEEN 10 AND 1000),
  payout_email TEXT,
  referral_code TEXT NOT NULL UNIQUE CHECK (referral_code ~ '^[A-Z0-9]{8}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'rejected', 'paused')),
  commission_bps INTEGER NOT NULL DEFAULT 3500
    CHECK (commission_bps BETWEEN 0 AND 10000),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliate_partners(id) ON DELETE RESTRICT,
  referred_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  workspace_id UUID UNIQUE REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  attribution_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed_up'
    CHECK (status IN ('signed_up', 'paying', 'cancelled')),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliate_partners(id) ON DELETE RESTRICT,
  referral_id UUID NOT NULL REFERENCES public.affiliate_referrals(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  stripe_event_id TEXT,
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  commission_cents INTEGER NOT NULL CHECK (commission_cents >= 0),
  commission_bps INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  currency TEXT NOT NULL CHECK (currency = lower(currency)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'reversed')),
  earned_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_partners_status
  ON public.affiliate_partners(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_affiliate
  ON public.affiliate_referrals(affiliate_id, attributed_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate
  ON public.affiliate_commissions(affiliate_id, status, available_at DESC);

-- Ninguna de estas tablas se consulta desde el cliente. Las rutas publicas y
-- el webhook usan service_role; el panel de plataforma tambien pasa por su
-- guard del servidor. RLS + REVOKE dejan fuera a anon y authenticated aunque
-- alguien intente llamar Supabase directamente.
ALTER TABLE public.affiliate_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.affiliate_partners FROM anon, authenticated;
REVOKE ALL ON public.affiliate_referrals FROM anon, authenticated;
REVOKE ALL ON public.affiliate_commissions FROM anon, authenticated;

COMMENT ON COLUMN public.affiliate_partners.commission_bps IS
  '3500 = 35.00%. Se congela tambien en cada comision para conservar el acuerdo historico.';
COMMENT ON COLUMN public.affiliate_commissions.available_at IS
  'Fecha de fin de la ventana de validacion de 30 dias; antes de ella no se marca pagada.';

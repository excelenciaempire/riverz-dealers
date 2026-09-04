-- Un borrador de Shopify y un checkout son el mismo rescate para la persona.
-- Se guardan separados para conservar su URL, pero comparten un reclamo
-- atómico de 24 horas por comercio + teléfono.

ALTER TABLE public.shopify_checkouts
  ADD COLUMN IF NOT EXISTS recovery_source TEXT NOT NULL DEFAULT 'checkout'
  CHECK (recovery_source IN ('checkout', 'draft'));

UPDATE public.shopify_checkouts
   SET recovery_source = 'draft'
 WHERE checkout_id LIKE 'draft_%';

CREATE INDEX IF NOT EXISTS idx_shopify_checkouts_recovery_source
  ON public.shopify_checkouts (workspace_id, recovery_source)
  WHERE completed_at IS NULL AND recovery_dispatched_at IS NULL;

CREATE TABLE IF NOT EXISTS public.shopify_cart_recovery_claims (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_normalized TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('checkout', 'draft')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, phone_normalized)
);

ALTER TABLE public.shopify_cart_recovery_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_shopify_cart_recovery(
  p_workspace_id UUID,
  p_phone TEXT,
  p_checkout_id TEXT,
  p_source TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_claimed BOOLEAN := FALSE;
BEGIN
  IF p_workspace_id IS NULL OR v_phone = '' OR p_checkout_id = ''
     OR p_source NOT IN ('checkout', 'draft') THEN
    RETURN FALSE;
  END IF;

  -- Nunca adelantes un checkout si hay un borrador vivo para la misma persona:
  -- el borrador tiene una factura lista y debe ser el único mensaje posible.
  IF p_source = 'checkout' AND EXISTS (
    SELECT 1
      FROM shopify_checkouts c
     WHERE c.workspace_id = p_workspace_id
       AND c.recovery_source = 'draft'
       AND c.completed_at IS NULL
       AND regexp_replace(COALESCE(c.customer_phone, ''), '\D', '', 'g') = v_phone
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO shopify_cart_recovery_claims (
    workspace_id, phone_normalized, checkout_id, source, claimed_at
  ) VALUES (
    p_workspace_id, v_phone, p_checkout_id, p_source, now()
  )
  ON CONFLICT (workspace_id, phone_normalized) DO UPDATE
     SET checkout_id = EXCLUDED.checkout_id,
         source = EXCLUDED.source,
         claimed_at = EXCLUDED.claimed_at
   WHERE shopify_cart_recovery_claims.claimed_at < now() - interval '24 hours'
  RETURNING TRUE INTO v_claimed;

  RETURN COALESCE(v_claimed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_shopify_cart_recovery(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

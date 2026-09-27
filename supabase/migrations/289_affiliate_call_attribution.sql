-- Sales-assisted referrals are assigned before the first commissionable payment.
ALTER TABLE public.affiliate_referrals
  ADD COLUMN IF NOT EXISTS attribution_source TEXT NOT NULL DEFAULT 'link',
  ADD COLUMN IF NOT EXISTS attribution_note TEXT;

CREATE OR REPLACE FUNCTION public.assign_affiliate_call_referral(
  p_affiliate_id UUID, p_workspace_id UUID, p_note TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  partner public.affiliate_partners%ROWTYPE;
  owner UUID;
  owner_email TEXT;
  referral UUID;
BEGIN
  IF char_length(trim(coalesce(p_note, ''))) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'invalid_call_note';
  END IF;
  SELECT * INTO partner FROM public.affiliate_partners
    WHERE id = p_affiliate_id AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'affiliate_not_active'; END IF;
  SELECT w.owner_id, u.email INTO owner, owner_email
    FROM public.workspaces w JOIN auth.users u ON u.id = w.owner_id
    WHERE w.id = p_workspace_id FOR SHARE OF w;
  IF owner IS NULL OR lower(owner_email) = lower(partner.email) THEN
    RAISE EXCEPTION 'invalid_referred_customer';
  END IF;
  -- Unique constraints reject duplicates and prevent reassignment, including
  -- concurrent requests or a pre-existing signup attribution.
  INSERT INTO public.affiliate_referrals
    (affiliate_id, referred_user_id, workspace_id, attribution_code,
     attribution_source, attribution_note)
  VALUES (partner.id, owner, p_workspace_id, partner.referral_code,
    'call', trim(p_note)) RETURNING id INTO referral;
  RETURN referral;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_affiliate_call_referral(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_affiliate_call_referral(UUID, UUID, TEXT) TO service_role;

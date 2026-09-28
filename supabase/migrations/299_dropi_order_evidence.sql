-- Enrich the existing Shopify mirror. Never insert an order or trigger a second sender.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dropi_evidence jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dropi_observed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS orders_dropi_identity
  ON public.orders (workspace_id, (dropi_evidence->>'account_id'), (dropi_evidence->>'dropi_order_id'))
  WHERE dropi_evidence IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_dropi_order_evidence(
  p_workspace_id uuid, p_shop_domain text, p_shopify_order_id text,
  p_observed_at timestamptz, p_evidence jsonb
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE target orders%ROWTYPE;
BEGIN
  IF p_observed_at IS NULL OR p_observed_at > now() + interval '1 minute'
     OR p_observed_at < now() - interval '15 minutes'
     OR p_evidence IS NULL OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
     OR NOT (p_evidence ?& ARRAY['dropi_order_id','account_id','shop_id','status','buyer_history'])
  THEN RAISE EXCEPTION 'invalid_dropi_evidence'; END IF;

  SELECT * INTO STRICT target FROM orders
    WHERE workspace_id = p_workspace_id AND shop_domain = p_shop_domain
      AND shopify_order_id = p_shopify_order_id FOR UPDATE;
  IF target.dropi_observed_at >= p_observed_at THEN RETURN 'stale_or_duplicate'; END IF;
  IF target.dropi_evidence IS NOT NULL AND (
     target.dropi_evidence->>'dropi_order_id' IS DISTINCT FROM p_evidence->>'dropi_order_id'
     OR target.dropi_evidence->>'account_id' IS DISTINCT FROM p_evidence->>'account_id'
     OR target.dropi_evidence->>'shop_id' IS DISTINCT FROM p_evidence->>'shop_id'
  ) THEN RAISE EXCEPTION 'dropi_order_identity_conflict'; END IF;

  UPDATE orders SET dropi_evidence = p_evidence, dropi_observed_at = p_observed_at
    WHERE id = target.id;
  RETURN 'updated';
EXCEPTION WHEN no_data_found THEN RETURN 'order_not_mirrored';
END;
$$;
REVOKE ALL ON FUNCTION public.record_dropi_order_evidence(uuid,text,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_dropi_order_evidence(uuid,text,text,timestamptz,jsonb) TO service_role;

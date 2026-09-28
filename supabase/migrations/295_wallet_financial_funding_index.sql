-- Keep refund exclusion off the hot path's full merchant ledger scan.
CREATE INDEX IF NOT EXISTS wallet_financial_funding_adjustments
  ON public.wallet_movimientos(workspace_id, (detalle->>'paymentIntent'))
  WHERE concepto='recarga_ajuste';

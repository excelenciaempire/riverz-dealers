-- Voice reliability: visible balance holds, inbound human fallback and
-- structured provider health. Service-role-only platform data stays private.

ALTER TABLE public.voice_calls
  ALTER COLUMN agent_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

ALTER TABLE public.voice_calls DROP CONSTRAINT IF EXISTS voice_calls_outcome_check;
ALTER TABLE public.voice_calls
  ADD CONSTRAINT voice_calls_outcome_check CHECK (
    outcome IS NULL OR outcome IN (
      'confirmed', 'cancelled_by_customer', 'rescheduled', 'recovered',
      'declined', 'callback_requested', 'transferred', 'opt_out', 'no_outcome'
    )
  );

CREATE INDEX IF NOT EXISTS voice_calls_active_hold_idx
  ON public.voice_calls (hold_expires_at)
  WHERE status = 'queued' AND hold_reason IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_provider_health (
  provider text PRIMARY KEY,
  category text NOT NULL,
  state text NOT NULL CHECK (state IN ('ok', 'bajo', 'sin_saldo', 'desconocido', 'sin_llave', 'error')),
  balance numeric,
  unit text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_provider_health ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_provider_health IS
  'Latest sanitized provider probe snapshot. Service role only; never exposed directly to merchants.';

-- Durable public-comment recovery. Initial sends and DMs are never replayed blindly.
CREATE TABLE IF NOT EXISTS public.comment_reply_retries (
  inbound_message_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  reason text NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  lease_id uuid,
  lease_until timestamptz,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS comment_reply_retries_due ON public.comment_reply_retries(next_attempt_at)
  WHERE status IN ('pending','processing');
ALTER TABLE public.comment_reply_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comment_reply_retries FROM anon, authenticated;
GRANT ALL ON public.comment_reply_retries TO service_role;

CREATE OR REPLACE FUNCTION public.claim_comment_reply_retry()
RETURNS SETOF public.comment_reply_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.comment_reply_retries SET status='review',outcome='dispatch_uncertain',finished_at=now(),lease_id=null,lease_until=null
    WHERE status='processing' AND lease_until < now() AND attempts >= 3;
  RETURN QUERY
  WITH candidate AS (
    SELECT inbound_message_id FROM public.comment_reply_retries
    WHERE attempts < 3 AND next_attempt_at <= now()
      AND (status = 'pending' OR (status = 'processing' AND lease_until < now()))
    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.comment_reply_retries AS j SET status = 'processing', attempts = attempts + 1,
    lease_id = gen_random_uuid(), lease_until = now() + interval '5 minutes'
  FROM candidate WHERE j.inbound_message_id = candidate.inbound_message_id RETURNING j.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_comment_reply_retry() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_comment_reply_retry() TO service_role;

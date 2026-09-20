-- Explicit merchant verification, never inferred from silence or assignment.
CREATE TABLE IF NOT EXISTS public.conversation_outcomes (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  last_message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('tracking', 'product', 'confirmation', 'address', 'return', 'other')),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_outcomes_workspace_verified_idx
  ON public.conversation_outcomes(workspace_id, verified_at DESC);
ALTER TABLE public.conversation_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_outcomes_read ON public.conversation_outcomes;
CREATE POLICY conversation_outcomes_read ON public.conversation_outcomes
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
REVOKE ALL ON public.conversation_outcomes FROM anon, authenticated;
GRANT SELECT ON public.conversation_outcomes TO authenticated;
GRANT ALL ON public.conversation_outcomes TO service_role;
COMMENT ON TABLE public.conversation_outcomes IS
  'Merchant-reviewed AI resolutions. Valid only while last_message_id is still the latest message and no human reply or escalation exists. Writes go through the workspace-scoped API.';

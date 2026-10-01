-- A check proves an authenticated tool call, scoped to one user and workspace.
CREATE TABLE IF NOT EXISTS public.mcp_connection_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt', 'claude', 'codex')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
  verified_at TIMESTAMPTZ,
  token_id UUID REFERENCES public.mcp_tokens(id) ON DELETE SET NULL
);
ALTER TABLE public.mcp_connection_checks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS mcp_connection_checks_user_idx ON public.mcp_connection_checks(user_id, workspace_id, created_at DESC);

-- Destinos de eventos de Riverz. El secreto nunca se expone a la sesión web.
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  url TEXT NOT NULL CHECK (url ~ '^https://'),
  secret TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT ARRAY['conversation.created'],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_workspace_idx
  ON public.webhook_endpoints(workspace_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  status_code INTEGER,
  succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON public.webhook_deliveries(endpoint_id, delivered_at DESC);

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their webhook endpoints" ON public.webhook_endpoints
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = webhook_endpoints.workspace_id AND m.user_id = auth.uid()
  ));

CREATE POLICY "Members can read their webhook deliveries" ON public.webhook_deliveries
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.webhook_endpoints e JOIN public.workspace_members m ON m.workspace_id = e.workspace_id
    WHERE e.id = webhook_deliveries.endpoint_id AND m.user_id = auth.uid()
  ));

REVOKE SELECT ON public.webhook_endpoints FROM authenticated;
GRANT SELECT (id, workspace_id, name, url, events, is_active, created_at, updated_at)
  ON public.webhook_endpoints TO authenticated;

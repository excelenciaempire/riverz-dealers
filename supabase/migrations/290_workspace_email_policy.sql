-- No row means the same safe defaults for existing and future workspaces.
CREATE TABLE IF NOT EXISTS public.workspace_email_policy (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'redirect' CHECK (mode IN ('redirect', 'assist', 'manual')),
  whatsapp_number text NOT NULL DEFAULT '' CHECK (whatsapp_number = '' OR whatsapp_number ~ '^[1-9][0-9]{7,14}$'),
  filter_notifications boolean NOT NULL DEFAULT true,
  prevent_repeated_redirects boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_email_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_email_policy FROM anon, authenticated;
GRANT ALL ON public.workspace_email_policy TO service_role;
-- Preserve the destination explicitly verified for Revitaly.
INSERT INTO public.workspace_email_policy (workspace_id, whatsapp_number)
SELECT id, '5492255629123' FROM public.workspaces WHERE id = '234604a9-909b-4e50-952b-acde4a85593a'
ON CONFLICT (workspace_id) DO NOTHING;
NOTIFY pgrst, 'reload schema';

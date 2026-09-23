-- Un aviso por umbral y período. Las cuentas legadas nunca entran en este flujo.
CREATE TABLE IF NOT EXISTS public.billing_volume_alerts (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  threshold integer NOT NULL CHECK (threshold IN (80, 100)),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_start, threshold)
);

REVOKE ALL ON public.billing_volume_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_volume_alerts TO service_role;

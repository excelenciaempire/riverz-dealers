-- ============================================================
-- 235 — Último análisis de comentarios por comercio
-- ============================================================
--
-- El análisis de Comentarios AI antes vivía sólo en el estado del navegador:
-- al cambiar de pestaña o volver otro día desaparecía, aunque ya se hubiera
-- pagado y calculado. Se conserva el último reporte completo por workspace.
-- Reanalizar lo reemplaza sólo al terminar bien; un fallo no borra evidencia.

CREATE TABLE IF NOT EXISTS public.workspace_comment_research (
  workspace_id       UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  report             JSONB NOT NULL,
  comment_count      INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  analyzed_sample    INTEGER NOT NULL DEFAULT 0 CHECK (analyzed_sample >= 0),
  generated_with_ai  BOOLEAN NOT NULL DEFAULT false,
  analyzed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_comment_research ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_comment_research_select
  ON public.workspace_comment_research;
CREATE POLICY workspace_comment_research_select
  ON public.workspace_comment_research
  FOR SELECT
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_comment_research_admin_write
  ON public.workspace_comment_research;
CREATE POLICY workspace_comment_research_admin_write
  ON public.workspace_comment_research
  FOR ALL
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

COMMENT ON TABLE public.workspace_comment_research IS
  'Último reporte persistido de Comentarios AI por comercio.';

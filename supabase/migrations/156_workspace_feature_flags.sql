-- ============================================================
-- 156 — Funcionalidades prendidas o apagadas por comercio
-- ============================================================
--
-- `feature_flags` (migración 123) es global: una funcionalidad se apaga para
-- TODOS o para nadie. Eso alcanza para un interruptor de emergencia y no para
-- nada más: no se puede probar algo con un comercio piloto, ni dejar una
-- función fuera de una cuenta que no la contrató.
--
-- Esta tabla no reemplaza a la otra: la pisa. El global sigue siendo el valor
-- por defecto y acá vive la excepción, que es como se lee mejor — "todos menos
-- este" y "nadie salvo este" se escriben igual de fácil.
--
-- Ausencia = sin excepción (usa el global). El global ausente = habilitada,
-- igual que antes: sumar el sistema no apaga nada por accidente.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspace_feature_flags (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  PRIMARY KEY (workspace_id, key)
);

ALTER TABLE public.workspace_feature_flags ENABLE ROW LEVEL SECURITY;
-- Sin políticas, igual que `feature_flags`: sólo la clave de servicio. El
-- comercio recibe el resultado ya resuelto desde el layout, nunca la tabla.

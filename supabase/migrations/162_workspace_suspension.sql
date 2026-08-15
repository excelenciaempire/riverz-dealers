-- ============================================================
-- 162 — Suspender un comercio
-- ============================================================
--
-- El cobro de Riverz vive FUERA de la aplicación: el equipo activa y
-- desactiva cuentas a mano y factura por su cuenta. Hasta acá "desactivar"
-- no hacía nada — el comercio seguía usando el producto igual, porque el
-- panel de plataforma es de solo lectura y no existía ningún interruptor.
--
-- Esto es ese interruptor, y nada más: no hay planes, ni precios, ni
-- pasarela. Cuando algún día haya cobro automático, lo único que tendrá
-- que hacer su webhook es escribir estas mismas tres columnas.
--
-- `suspended_at` es la verdad; las otras dos existen para poder contestar
-- "¿quién la apagó y por qué?" sin ir a buscar a la auditoría. El motivo
-- NO se le muestra al comercio: es una nota interna del equipo.
--
-- Idempotente. Se aplica a mano vía la Management API de Supabase.
-- ============================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Los caminos que preguntan "¿está suspendida?" filtran por NULL, así que
-- el índice sólo indexa las suspendidas — que van a ser un puñado.
CREATE INDEX IF NOT EXISTS idx_workspaces_suspended
  ON public.workspaces (suspended_at)
  WHERE suspended_at IS NOT NULL;

COMMENT ON COLUMN public.workspaces.suspended_at IS
  'Cuándo se suspendió la cuenta (cobro manual). NULL = activa. Corta el acceso al panel y frena los envíos automáticos.';
COMMENT ON COLUMN public.workspaces.suspended_by IS
  'Qué integrante del equipo la suspendió. Se conserva aunque después se reactive.';
COMMENT ON COLUMN public.workspaces.suspended_reason IS
  'Nota interna del equipo. NUNCA se le muestra al comercio.';

-- El cliente con cookie ya podía leer su propio workspace; sumamos la
-- columna para que el panel sepa que está suspendido sin una consulta
-- aparte. `suspended_reason` queda fuera a propósito.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_column_grants
    WHERE table_schema = 'public' AND table_name = 'workspaces'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
    LIMIT 1
  ) THEN
    GRANT SELECT (suspended_at) ON public.workspaces TO authenticated;
  END IF;
END $$;

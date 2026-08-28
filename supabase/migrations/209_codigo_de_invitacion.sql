-- ============================================================
-- 209 — Código de invitación para crear cuenta
-- ============================================================
-- El alta se reabre, pero no al público: hace falta un código que emite el
-- equipo desde /admin/codigos. Un código es una fila con un cupo (`max_uses`),
-- un consumo (`uses`) y, si se quiere, un vencimiento.
--
-- El consumo se toma ANTES de crear la cuenta y se devuelve si el alta falla:
-- si se contara después, dos personas con el mismo código de un solo uso
-- pasarían las dos. Por eso las dos funciones de abajo, que hacen el
-- incremento bajo el candado de la fila en vez de leer-y-escribir desde la app.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.signup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalizado en mayúsculas y sin guiones: el usuario lo tipea como quiera.
  code TEXT NOT NULL UNIQUE,
  -- Para qué se emitió ("piloto Pilar", "demo Shopify"). Solo lo ve el equipo.
  note TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.signup_codes IS
  'Códigos de invitación que habilitan crear una cuenta. Los emite el equipo desde /admin/codigos.';
COMMENT ON COLUMN public.signup_codes.uses IS
  'Cuántas altas consumió. Se incrementa al reservar y se devuelve si el alta falla.';

CREATE INDEX IF NOT EXISTS idx_signup_codes_created
  ON public.signup_codes (created_at DESC);

-- Quién usó cada código. Es lo que convierte "quedan 3 de 10" en una lista con
-- nombres, que es lo que se quiere mirar seis meses después.
CREATE TABLE IF NOT EXISTS public.signup_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id UUID NOT NULL REFERENCES public.signup_codes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_code_redemptions_code
  ON public.signup_code_redemptions (code_id, redeemed_at DESC);

-- Sin políticas: nadie llega a estas tablas con la llave anónima. Se escriben
-- y se leen únicamente con la de servicio (el panel y la ruta de alta).
ALTER TABLE public.signup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_code_redemptions ENABLE ROW LEVEL SECURITY;

-- ── Reservar un uso ──
-- Devuelve el id del código si quedaba cupo, NULL si no existe, está revocado,
-- vencido o agotado. El UPDATE condicional es el candado: dos llamadas
-- simultáneas con el último cupo, una gana y la otra recibe NULL.
CREATE OR REPLACE FUNCTION public.claim_signup_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE public.signup_codes
     SET uses = uses + 1
   WHERE code = upper(p_code)
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now())
     AND uses < max_uses
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── Devolver el uso reservado ──
-- El alta no llegó a existir (correo repetido, error de Supabase): el cupo
-- vuelve. Nunca baja de cero.
CREATE OR REPLACE FUNCTION public.release_signup_code(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.signup_codes
     SET uses = greatest(uses - 1, 0)
   WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.claim_signup_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_signup_code(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_signup_code(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_signup_code(UUID) TO service_role;

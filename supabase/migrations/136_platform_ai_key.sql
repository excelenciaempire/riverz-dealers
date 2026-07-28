-- 136 — Clave de IA de la plataforma: Riverz pone la clave, o el comercio.
--
-- Hasta ahora sólo había dos fuentes: la clave que el comercio cargaba en su
-- agente (`ai_agents.api_key_encrypted`) o la variable de entorno
-- ANTHROPIC_API_KEY del servidor, que se aplicaba a TODOS sin excepción y sin
-- forma de saber cuánto gastó cada uno con ella.
--
-- Esto agrega la pieza intermedia: una clave de plataforma administrable desde
-- el panel, con tres modos, y un registro de qué clave pagó cada respuesta.
--
-- APLICAR A MANO por la Management API. Sin RLS: sólo el service role la toca
-- (las rutas de /admin usan supabaseAdmin), y la clave nunca sale al navegador.

CREATE TABLE IF NOT EXISTS public.platform_ai_settings (
  -- Fila única: el CHECK sobre un boolean PRIMARY KEY hace imposible una
  -- segunda fila, así que no hay "qué configuración vale" que resolver.
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'selected'
    CHECK (mode IN ('all', 'selected', 'off')),
  anthropic_key_encrypted text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON COLUMN public.platform_ai_settings.mode IS
  'all = la clave de Riverz cubre a todas las cuentas; selected = sólo las de platform_ai_workspaces, el resto trae la suya (BYOK); off = nadie, todos BYOK.';

INSERT INTO public.platform_ai_settings (id, mode)
VALUES (true, 'selected')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_ai_settings ENABLE ROW LEVEL SECURITY;

-- Qué cuentas cubre la clave de Riverz cuando mode='selected'.
CREATE TABLE IF NOT EXISTS public.platform_ai_workspaces (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.platform_ai_workspaces ENABLE ROW LEVEL SECURITY;

-- Quién pagó cada respuesta. Sin esto, /admin/uso sabe cuánto costó cada
-- comercio pero no si ese gasto salió del bolsillo de Riverz o del suyo — que
-- es justamente la cifra que hace falta para poner precio.
ALTER TABLE public.ai_replies
  ADD COLUMN IF NOT EXISTS key_source text
    CHECK (key_source IS NULL OR key_source IN ('platform', 'agent', 'env'));

COMMENT ON COLUMN public.ai_replies.key_source IS
  'Qué clave pagó esta llamada: platform (la de Riverz), agent (la del comercio) o env (la variable del servidor, heredada).';

CREATE INDEX IF NOT EXISTS idx_ai_replies_key_source
  ON public.ai_replies (key_source, created_at DESC)
  WHERE key_source IS NOT NULL;

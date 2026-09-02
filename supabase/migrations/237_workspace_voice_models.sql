-- 237 — Voces propias por espacio de trabajo
--
-- Fish guarda el modelo y las muestras, pero la API key de Riverz es compartida.
-- Esta tabla es la frontera de tenencia: una voz creada por un comercio jamás
-- aparece en el selector de otro, aunque ambos usen la misma cuenta de Fish.

CREATE TABLE IF NOT EXISTS public.workspace_voice_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'fish' CHECK (provider = 'fish'),
  provider_model_id TEXT NOT NULL UNIQUE CHECK (provider_model_id ~ '^[a-f0-9]{32}$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created', 'training', 'trained', 'failed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider_model_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_voice_models_workspace
  ON public.workspace_voice_models (workspace_id, created_at DESC);

ALTER TABLE public.workspace_voice_models ENABLE ROW LEVEL SECURITY;

-- La tabla se usa sólo mediante rutas de servidor con service role. Ningún
-- cliente puede enumerar modelos de otros comercios ni manipular su tenencia.
REVOKE ALL ON public.workspace_voice_models FROM anon, authenticated;

COMMENT ON TABLE public.workspace_voice_models IS
  'Modelos privados de Fish Audio asignados a un único workspace.';

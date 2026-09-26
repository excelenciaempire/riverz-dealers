-- Las pruebas de "Probar como cliente", cada una como un chat.
--
-- Una sesión empieza al elegir una situación y pulsar Empezar, y termina al
-- reiniciar. Se guarda lo que vio quien probaba —mensajes, plantillas,
-- avisos— para que el equipo revise después cómo respondió el asistente,
-- también cuando probó el dueño de la marca desde el link compartido.
--
-- Sólo la escribe y la lee el servidor (service_role): nada de acá se expone
-- a anon ni a authenticated.
CREATE TABLE IF NOT EXISTS public.ai_test_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  origen text NOT NULL CHECK (origen IN ('panel', 'link')),
  user_id uuid,
  escenario text,
  canal text,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  mensajes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_test_sessions_workspace_idx
  ON public.ai_test_sessions (workspace_id, updated_at DESC);

ALTER TABLE public.ai_test_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_test_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_test_sessions TO service_role;

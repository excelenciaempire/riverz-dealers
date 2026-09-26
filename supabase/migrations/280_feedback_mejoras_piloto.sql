-- Feedback de conversaciones reales, mejoras y piloto en vivo.
--
-- 1. ai_feedback: lo que el equipo marca sobre una respuesta automática en la
--    bandeja (👍/👎 y nota), con el tramo de conversación como se veía —la
--    "captura"— para revisarlo después sin depender de que el hilo siga igual.
-- 2. ai_mejoras_lotes: cada vez que la IA convierte feedback real en reglas
--    propuestas. Las de las pruebas siguen viviendo en ai_test_sessions.
-- 3. mejoras_plataforma: lo que no se arregla con una regla del comercio. Es
--    la cola del equipo de Riverz (panel de plataforma y rutina de Claude Code).
-- 4. workspaces.mejoras_automaticas: aplicar solas las reglas propuestas.
-- 5. ai_pilotos: poner todo en vivo con límites —N respuestas a mensajes, N a
--    comentarios, N automatizaciones— y/o sólo para ciertos números. Al
--    llegar al límite la IA queda en pausa hasta pasar a producción.
--
-- Todo se lee y escribe desde el servidor (service_role).

CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  canal text,
  voto text CHECK (voto IN ('bien', 'mal')),
  nota text NOT NULL DEFAULT '',
  captura jsonb NOT NULL DEFAULT '[]'::jsonb,
  estado text NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo', 'usado', 'descartado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS ai_feedback_workspace_idx ON public.ai_feedback (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_feedback_conversation_idx ON public.ai_feedback (conversation_id);

CREATE TABLE IF NOT EXISTS public.ai_mejoras_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  feedback_ids uuid[] NOT NULL DEFAULT '{}',
  propuestas jsonb,
  automatico boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_mejoras_lotes_workspace_idx ON public.ai_mejoras_lotes (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mejoras_plataforma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  origen text NOT NULL CHECK (origen IN ('prueba', 'bandeja')),
  origen_id uuid,
  problema text NOT NULL DEFAULT '',
  prompt text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'resuelta', 'descartada')),
  nota text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mejoras_plataforma_estado_idx ON public.mejoras_plataforma (estado, created_at DESC);

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS mejoras_automaticas boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.ai_pilotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'activo', 'agotado', 'terminado')),
  -- Vacío = todos los canales.
  canales text[] NOT NULL DEFAULT '{}',
  -- null = sin tope; 0 = ese tipo no responde durante el piloto.
  limite_mensajes integer CHECK (limite_mensajes IS NULL OR limite_mensajes >= 0),
  limite_comentarios integer CHECK (limite_comentarios IS NULL OR limite_comentarios >= 0),
  limite_automatizaciones integer CHECK (limite_automatizaciones IS NULL OR limite_automatizaciones >= 0),
  usados_mensajes integer NOT NULL DEFAULT 0,
  usados_comentarios integer NOT NULL DEFAULT 0,
  usados_automatizaciones integer NOT NULL DEFAULT 0,
  -- Vacío = cualquiera. Con números, sólo ellos reciben respuestas y mensajes.
  solo_numeros text[] NOT NULL DEFAULT '{}',
  iniciado_at timestamptz,
  terminado_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Un solo piloto vivo por comercio.
CREATE UNIQUE INDEX IF NOT EXISTS ai_pilotos_uno_vivo
  ON public.ai_pilotos (workspace_id) WHERE estado IN ('borrador', 'activo', 'agotado');

/**
 * Reserva una respuesta del cupo del piloto, de forma atómica: dos mensajes a
 * la vez no pueden pasarse del límite. Sin cupo, y si ya no queda en ningún
 * tipo con tope, el piloto queda agotado.
 */
CREATE OR REPLACE FUNCTION public.reservar_cupo_piloto(p_piloto uuid, p_tipo text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  IF p_tipo = 'comentario' THEN
    UPDATE ai_pilotos SET usados_comentarios = usados_comentarios + 1, updated_at = now()
     WHERE id = p_piloto AND estado = 'activo'
       AND (limite_comentarios IS NULL OR usados_comentarios < limite_comentarios)
    RETURNING true INTO ok;
  ELSIF p_tipo = 'automatizacion' THEN
    UPDATE ai_pilotos SET usados_automatizaciones = usados_automatizaciones + 1, updated_at = now()
     WHERE id = p_piloto AND estado = 'activo'
       AND (limite_automatizaciones IS NULL OR usados_automatizaciones < limite_automatizaciones)
    RETURNING true INTO ok;
  ELSE
    UPDATE ai_pilotos SET usados_mensajes = usados_mensajes + 1, updated_at = now()
     WHERE id = p_piloto AND estado = 'activo'
       AND (limite_mensajes IS NULL OR usados_mensajes < limite_mensajes)
    RETURNING true INTO ok;
  END IF;

  UPDATE ai_pilotos SET estado = 'agotado', terminado_at = now(), updated_at = now()
   WHERE id = p_piloto AND estado = 'activo'
     AND limite_mensajes IS NOT NULL AND usados_mensajes >= limite_mensajes
     AND limite_comentarios IS NOT NULL AND usados_comentarios >= limite_comentarios
     AND limite_automatizaciones IS NOT NULL AND usados_automatizaciones >= limite_automatizaciones;

  RETURN coalesce(ok, false);
END;
$$;

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_mejoras_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mejoras_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pilotos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_feedback, public.ai_mejoras_lotes, public.mejoras_plataforma, public.ai_pilotos
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_feedback, public.ai_mejoras_lotes, public.mejoras_plataforma, public.ai_pilotos
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.reservar_cupo_piloto(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_cupo_piloto(uuid, text) TO service_role;

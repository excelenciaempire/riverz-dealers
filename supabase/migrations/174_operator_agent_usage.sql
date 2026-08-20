-- 174 — Cuánto gastó cada subagente
--
-- El techo diario del Operator se calcula sumando los `prompt_tokens` de
-- `operator_messages`, y ahí se escribe UNA fila por turno. Mientras el turno
-- era una sola cadena de llamadas del mismo agente, ese número era correcto.
-- Con equipo, el total agregado sigue cayendo en esa fila —eso se arregla en el
-- código— pero se pierde algo que ahora hace falta: saber a quién atribuirlo.
--
-- Sin el desglose no se puede contestar la pregunta que decide el precio del
-- producto: ¿el gasto se va en el orquestador repartiendo, o en los
-- especialistas construyendo? Son dos problemas distintos y se arreglan
-- distinto.
--
-- Va a una tabla propia y no a `operator_messages` porque esa tabla es el
-- HISTORIAL de la conversación: se lee con `.limit(200)` para armar el contexto
-- del modelo, y meterle filas que no son mensajes las hace competir con los
-- mensajes por ese cupo.
--
-- `cache_read_tokens` está a propósito. El prompt del sistema se cachea con un
-- prefijo estable, y sin este número el acierto del caché es una suposición.
--
-- Sin RLS: sólo entra la llave de servicio. Idempotente.

CREATE TABLE IF NOT EXISTS operator_agent_usage (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id    UUID REFERENCES operator_threads(id) ON DELETE SET NULL,
  plan_step_id UUID REFERENCES operator_plan_steps(id) ON DELETE SET NULL,
  -- 'orquestador' o el id de un subagente. Texto y no enum: el roster vive en
  -- el código y sumar un dominio no debería pedir una migración.
  agente       TEXT NOT NULL,
  model        TEXT,
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  llamadas     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_agent_usage_ws_idx
  ON operator_agent_usage (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operator_agent_usage_agente_idx
  ON operator_agent_usage (workspace_id, agente, created_at DESC);

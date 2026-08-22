-- ============================================================
-- 181: si sirvió, y qué no supo contestar
-- ============================================================

-- ── 1. Satisfacción ─────────────────────────────────────────────
--
-- "300 conversaciones" no dice nada. "300 conversaciones y el 82% quedó
-- conforme" es el número con el que un comercio decide si el canal se queda.
--
-- Va en `conversations` y no en una tabla aparte porque el grano es ese: una
-- persona califica la atención que recibió, no cada mensaje. Y así la consulta
-- de métricas no suma un join.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS csat smallint
  CHECK (csat IS NULL OR csat IN (-1, 1));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS csat_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS csat_comment text;

COMMENT ON COLUMN conversations.csat IS
  '1 = sirvió, -1 = no sirvió. NULL = no calificó.';

CREATE INDEX IF NOT EXISTS idx_conversations_csat
  ON conversations (workspace_id, csat_at DESC)
  WHERE csat IS NOT NULL;

-- ── 2. Lo que no supo contestar ─────────────────────────────────
--
-- Es la mitad del valor de un agente: las preguntas donde falla son el próximo
-- pedazo de conocimiento que hay que cargarle. Hasta acá se perdían — la
-- conversación quedaba marcada para una persona y la PREGUNTA no quedaba en
-- ningún lado, así que el comercio arreglaba el caso y no el agujero.
--
-- La fila la escribe el propio agente cuando reconoce que no sabe. No se
-- infiere de su texto: un modelo que dice "no tengo esa información" y otro que
-- improvisa una respuesta plausible se leen igual desde afuera, y justamente el
-- segundo es el que hay que cazar.
CREATE TABLE IF NOT EXISTS answer_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL,
  channel text,
  -- La pregunta, en las palabras de la persona.
  question text NOT NULL,
  -- La misma pregunta sin tildes, sin signos y en minúsculas: es por lo que se
  -- agrupan las repetidas. Sin normalizar, "¿hacen envíos?" y "hacen envios"
  -- son dos huecos distintos y la pantalla no muestra que es LA pregunta.
  question_key text NOT NULL,
  -- Qué le faltó, en las palabras del agente.
  missing text,
  -- Se marca cuando el comercio carga la respuesta. Lo que queda sin marcar es
  -- la lista de trabajo.
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answer_gaps_pendientes
  ON answer_gaps (workspace_id, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_answer_gaps_agrupado
  ON answer_gaps (workspace_id, question_key);

ALTER TABLE answer_gaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS answer_gaps_miembros ON answer_gaps;
CREATE POLICY answer_gaps_miembros ON answer_gaps
  FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

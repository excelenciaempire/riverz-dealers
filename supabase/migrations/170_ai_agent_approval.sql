-- ============================================================
-- 170_ai_agent_approval.sql
--
-- Un agente puede contestar solo, o proponer y esperar.
--
-- Hasta ahora la única forma de que una persona revisara lo que el asistente
-- iba a decir era apagarlo — es decir, no tenerlo. Un comercio que recién
-- arranca quiere las dos cosas a la vez: que la respuesta esté escrita en un
-- segundo, y que nadie la vea antes que él. Eso es este modo.
--
--   requires_approval = false  → autónomo (comportamiento de siempre)
--   requires_approval = true   → el runner genera la respuesta y la deja como
--                                propuesta; alguien la envía con un clic.
--
-- La propuesta vive en `ai_pending_replies`, una por conversación: si el
-- cliente vuelve a escribir mientras la anterior sigue sin aprobar, la nueva
-- pisa a la vieja (contestar lo de hace tres mensajes no le sirve a nadie).
-- Se borra al enviarla o al descartarla, así que la tabla queda chica.
-- ============================================================

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ai_agents.requires_approval IS
  'TRUE = el asistente propone la respuesta y una persona la envía con un clic. FALSE = responde solo.';

CREATE TABLE IF NOT EXISTS ai_pending_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Una propuesta viva por conversación.
  conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  content_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_replies_workspace
  ON ai_pending_replies(workspace_id, created_at DESC);

ALTER TABLE ai_pending_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read workspace pending replies" ON ai_pending_replies;
CREATE POLICY "Members read workspace pending replies" ON ai_pending_replies
  FOR SELECT USING (is_workspace_member(workspace_id));

-- La bandeja tiene que ver la propuesta aparecer sin recargar: si hay que
-- refrescar para enterarse, el modo deja de servir para contestar rápido.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ai_pending_replies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ai_pending_replies;
  END IF;
END $$;

-- ============================================================
-- 200: las reglas del comercio, escritas y en el prompt
-- ============================================================
-- Hasta ahora un comercio podía decirle a su agente CÓMO hablar de tres formas,
-- y ninguna era una regla:
--
--   * la persona (`ai_agents.persona`), un texto libre donde todo compite con
--     todo y nada se puede apagar por separado;
--   * las reglas por PRODUCTO (`say_guidelines`, `never_say`), que sólo sirven
--     si el tema es un producto — "no prometas fechas de entrega" no lo es;
--   * el pliego (migración 195), que pregunta "¿qué no debe decir nunca?" y
--     "¿qué tiene que decir siempre?", guarda la respuesta… y no la lee nadie
--     en tiempo de ejecución. Las etiquetas del propio pliego dicen "configura:
--     never_say global" y ese destino global no existía.
--
-- Esta tabla es ese destino. Una regla tiene NOMBRE (para poder hablar de
-- ella), CUÁNDO aplica (para no gastar prompt cuando no viene al caso) y QUÉ
-- HACER. Y un interruptor: probar si el agente mejora sin una regla es la mitad
-- de afinar un agente, y con todo metido en un párrafo de persona eso se hace
-- borrando texto y rezando por acordarse.
--
-- `agent_id` NULL = vale para todos los agentes de la cuenta. Es el caso normal
-- —"nunca prometemos fechas" es del comercio, no de un agente— y por eso es el
-- que no hay que configurar.
--
-- `clave` existe para que el pliego pueda REESCRIBIR su propia respuesta sin
-- pisar lo que el comercio escribió a mano: la fila del pliego se busca por
-- clave, la escrita a mano no tiene ninguna.
--
-- Idempotente. Se aplica a mano por la Management API.

CREATE TABLE IF NOT EXISTS agent_guidance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- NULL = todos los agentes de la cuenta.
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  -- Cuándo aplica, en las palabras del comercio ("cuando pregunten por
  -- devoluciones"). Vacío = siempre.
  cuando text,
  hacer text NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  orden int NOT NULL DEFAULT 0,
  -- Quién la escribió. El pliego reescribe sólo lo suyo.
  origen text NOT NULL DEFAULT 'comercio'
    CHECK (origen IN ('comercio', 'pliego')),
  clave text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Una fila por respuesta del pliego. Sin esto, cada vez que el comercio
-- contesta el cuestionario se sumaba otra copia de la misma regla.
CREATE UNIQUE INDEX IF NOT EXISTS uq_guidance_clave
  ON agent_guidance (workspace_id, clave)
  WHERE clave IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guidance_workspace
  ON agent_guidance (workspace_id, activa, orden);

ALTER TABLE agent_guidance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guidance_miembros ON agent_guidance;
CREATE POLICY guidance_miembros ON agent_guidance
  FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP TRIGGER IF EXISTS guidance_touch ON agent_guidance;
CREATE TRIGGER guidance_touch
  BEFORE UPDATE ON agent_guidance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

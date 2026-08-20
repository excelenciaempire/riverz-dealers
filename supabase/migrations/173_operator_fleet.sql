-- 173 — El equipo del Operator: planes, pasos y quién hizo qué
--
-- El Operator pasa de ser un agente con veinticinco herramientas a un
-- orquestador que reparte entre catorce especialistas. Un pedido como "armá
-- recuperación de carritos" deja de ser una secuencia de llamadas y pasa a ser
-- un PLAN: quién hace qué, en qué orden, y qué espera a qué.
--
-- Por qué tablas nuevas y no columnas en `operator_actions`:
--
-- Un plan no tiene `capability_key` ni `args` — obligaría a dejar en NULL la
-- mitad de las columnas y a aflojar el CHECK de `risk`. La relación es 1 plan a
-- N acciones, no 1 a 1. Y sobre todo: el `status` de `operator_actions` está
-- gobernado por un UPDATE condicionado a `status='propuesto'`, que es lo único
-- que impide la doble ejecución cuando alguien hace doble click en Aprobar.
-- Meterle estados de plan a ese CHECK debilita esa garantía por comodidad.
--
-- La aprobación de un plan aprueba EL REPARTO y habilita construir lo inerte
-- —lo que queda apagado— sin más clicks. Lo que le llega a una persona, sale a
-- Meta o mueve dinero sigue dejando su propia fila en `operator_actions` con su
-- propio botón, dentro del plan aprobado y fuera de él. Esa línea no se toca
-- acá: la decide `esInerte`, en el código, con su test.
--
-- Sin políticas de RLS a propósito: sólo entra la llave de servicio, igual que
-- la 163. El contenido de un plan puede nombrar datos de clientes del comercio.
--
-- Idempotente. Se aplica a mano por la Management API.

-- ── El plan ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id    UUID REFERENCES operator_threads(id) ON DELETE SET NULL,
  -- Lo que pidió la persona, textual. Es lo que hace auditable el reparto:
  -- sin esto, una semana después nadie puede juzgar si el plan era razonable.
  pedido       TEXT NOT NULL,
  -- Por qué en ese orden, en una frase. Lo escribe el orquestador.
  porque       TEXT,
  status       TEXT NOT NULL DEFAULT 'propuesto'
               CHECK (status IN ('propuesto','aprobado','corriendo','terminado','parcial','fallido','rechazado')),
  approved_by  UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS operator_plans_ws_idx
  ON operator_plans (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operator_plans_thread_idx
  ON operator_plans (thread_id);
-- Parcial: lo que se busca todo el tiempo es "¿hay algo esperando?".
CREATE INDEX IF NOT EXISTS operator_plans_pendientes_idx
  ON operator_plans (workspace_id, created_at DESC)
  WHERE status = 'propuesto';

-- ── Los pasos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_plan_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID NOT NULL REFERENCES operator_plans(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idx          INT NOT NULL,
  agente       TEXT NOT NULL,
  encargo      TEXT NOT NULL,
  -- Índices de los pasos que tienen que terminar antes. Un array y no una
  -- tabla de aristas: un plan tiene tres o cuatro pasos, no un grafo.
  depende_de   INT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pendiente'
               CHECK (status IN ('pendiente','corriendo','ok','fallido','saltado')),
  -- Qué hizo, en una línea, y los datos duros que le deja al paso siguiente.
  resumen      TEXT,
  refs         JSONB,
  error        TEXT,
  prompt_tokens     INT,
  completion_tokens INT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- `saltado` existe separado de `fallido` a propósito: "no se pudo" y "ni se
-- intentó" son dos cosas distintas en pantalla, y mezclarlas hace creer que se
-- rompieron cinco cosas cuando se rompió una.

CREATE UNIQUE INDEX IF NOT EXISTS operator_plan_steps_orden_idx
  ON operator_plan_steps (plan_id, idx);
CREATE INDEX IF NOT EXISTS operator_plan_steps_ws_idx
  ON operator_plan_steps (workspace_id, created_at DESC);

-- ── La traza en las acciones que ya existen ───────────────────────────
-- Quién la pidió y desde qué paso. Sin esto, con catorce subagentes
-- construyendo, `operator_actions` dice qué se hizo y no quién lo hizo.
ALTER TABLE operator_actions ADD COLUMN IF NOT EXISTS agente TEXT;
ALTER TABLE operator_actions ADD COLUMN IF NOT EXISTS plan_step_id UUID
  REFERENCES operator_plan_steps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS operator_actions_paso_idx
  ON operator_actions (plan_step_id)
  WHERE plan_step_id IS NOT NULL;

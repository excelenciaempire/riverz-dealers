-- 163 — Riverz Operator: hilos, mensajes y acciones propuestas
--
-- El Operator es el agente con el que un comercio opera su cuenta hablando:
-- "¿por qué bajaron las ventas?", "activá recuperación de carritos". Lee solo,
-- y todo lo que cambia algo lo PROPONE: deja una fila en `operator_actions` y
-- espera que una persona la apruebe. El modelo nunca ejecuta.
--
-- Por qué tablas nuevas y no `ai_replies`:
--
-- `ai_replies` es, además del registro de uso, el índice que decide qué agente
-- sigue atendiendo un hilo (`getStickyAgentId`) y el contador que dispara el
-- escalamiento a humano. Un actor nuevo escribiendo ahí le secuestra la
-- conversación al agente que la venía llevando y le corre el contador de
-- escalamiento. Ya pasó con el agente de comentarios (migraciones 131/133), y
-- la lección de esas dos es la misma: lo que no es un agente de canal no entra
-- en las tablas de los agentes de canal.
--
-- Por eso los tokens se cuentan acá. El costo del Operator se mira aparte del
-- de los agentes porque lo paga otro bolsillo: es la cuenta hablando con
-- Riverz, no Riverz hablando con un cliente.
--
-- Sin políticas de RLS a propósito: sólo la llave de servicio entra, igual que
-- `platform_audit_log`. El contenido de un hilo puede tener datos de clientes
-- del comercio.
--
-- Idempotente. Se aplica a mano por la Management API.

-- ── Hilos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Lo primero que preguntó la persona, recortado. Es cómo se reconoce un hilo
  -- en una lista sin tener que abrirlo.
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_threads_ws_idx
  ON operator_threads (workspace_id, updated_at DESC);

-- ── Mensajes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    UUID NOT NULL REFERENCES operator_threads(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- `tool` guarda tanto la llamada como su resultado: el hilo tiene que poder
  -- reconstruirse tal cual para que el modelo retome donde quedó.
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content      JSONB NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_messages_thread_idx
  ON operator_messages (thread_id, created_at);

-- El tope diario de gasto se cuenta con este índice.
CREATE INDEX IF NOT EXISTS operator_messages_ws_day_idx
  ON operator_messages (workspace_id, created_at DESC);

-- ── Acciones propuestas ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id      UUID REFERENCES operator_threads(id) ON DELETE SET NULL,
  -- Clave de la capacidad (`automatizaciones.activar`) y sus argumentos, tal
  -- como se van a ejecutar. Se guardan crudos porque son exactamente lo que la
  -- persona aprueba: ejecutar algo distinto de lo que se mostró sería otra cosa.
  capability_key TEXT NOT NULL,
  args           JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk           TEXT NOT NULL CHECK (risk IN ('lectura', 'reversible', 'irreversible')),
  status         TEXT NOT NULL DEFAULT 'propuesto'
                 CHECK (status IN ('propuesto', 'ejecutado', 'rechazado', 'fallido')),
  -- Qué dice que haría, en castellano. Es lo que se lee antes de aprobar.
  preview        TEXT,
  result         JSONB,
  approved_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS operator_actions_ws_idx
  ON operator_actions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS operator_actions_thread_idx
  ON operator_actions (thread_id, created_at);

-- Las que están esperando a alguien, que son las que hay que encontrar rápido.
CREATE INDEX IF NOT EXISTS operator_actions_pendientes_idx
  ON operator_actions (workspace_id, created_at DESC)
  WHERE status = 'propuesto';

ALTER TABLE operator_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_actions  ENABLE ROW LEVEL SECURITY;

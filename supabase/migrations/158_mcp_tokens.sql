-- ============================================================
-- 158 — Una llave de MCP por comercio
-- ============================================================
--
-- Hasta acá `/api/mcp` tenía UNA sola llave, la de la plataforma
-- (`MCP_ADMIN_TOKEN`), y el workspace sobre el que operaba venía como argumento
-- de cada herramienta. Eso está bien para el equipo de Riverz — que
-- legítimamente cruza cuentas — y es inservible para un comercio: con ese
-- diseño, darle la llave a alguien es darle TODAS las cuentas, porque el
-- argumento lo elige quien llama.
--
-- Con esta tabla la llave ES el alcance: el token identifica al comercio y el
-- servidor deja de creerle al argumento. Un comercio no puede nombrar otra
-- cuenta ni aunque lo intente.
--
-- Se guarda el HASH y no el token. Consecuencia buscada: si alguien se lleva
-- una copia de la base no se lleva llaves usables, y el valor se muestra una
-- sola vez al crearlo — como toda credencial que se respeta. `prefix` son los
-- primeros caracteres, lo justo para reconocer cuál es cuál en una lista.
--
-- Revocar no borra: deja `revoked_at`. Una llave que se usó y despues se saca
-- tiene que seguir explicando las filas que dejó en la auditoría.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Cómo lo llamó quien lo creó ("mi laptop", "n8n"), para poder revocar el
  -- correcto sin adivinar.
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- La búsqueda de cada llamada es por hash entre las vivas.
CREATE INDEX IF NOT EXISTS mcp_tokens_hash_idx
  ON public.mcp_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS mcp_tokens_ws_idx
  ON public.mcp_tokens (workspace_id, created_at DESC);

ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo la clave de servicio. El comercio administra sus llaves
-- por `/api/mcp/tokens`, que resuelve el workspace desde la SESIÓN — nunca
-- desde el pedido — y jamás devuelve el hash.

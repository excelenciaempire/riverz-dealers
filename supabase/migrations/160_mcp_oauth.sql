-- ============================================================
-- 160 — Conectar el MCP con OAuth, además de con una llave pegada a mano
-- ============================================================
--
-- Pegar un token funciona con Claude Desktop, n8n, Cursor y cualquier cliente
-- que sepa mandar una cabecera. No funciona con los conectores que descubren el
-- servidor solos: esos esperan encontrar un servidor de autorización,
-- registrarse contra él y mandar a la persona a decir que sí. Sin eso, Riverz no
-- puede aparecer en esa lista.
--
-- Las dos vías terminan en el mismo lugar: un token que `resolveActor` resuelve
-- a un workspace y un alcance. Un token de OAuth es una fila más de
-- `mcp_tokens`, con vencimiento y con el cliente que lo pidió. Así hay UNA
-- resolución, UN modelo de alcance y UNA auditoría, en vez de dos caminos que
-- se van separando.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

-- ── El token que emite OAuth es un mcp_token con vencimiento ──
ALTER TABLE public.mcp_tokens
  ADD COLUMN IF NOT EXISTS origin     TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_id  TEXT;

ALTER TABLE public.mcp_tokens DROP CONSTRAINT IF EXISTS mcp_tokens_origin_check;
ALTER TABLE public.mcp_tokens
  ADD CONSTRAINT mcp_tokens_origin_check CHECK (origin IN ('manual', 'oauth'));

-- ── Clientes ──
--
-- Se registran solos (RFC 7591). Es lo que permite que un conector nuevo
-- funcione sin que nadie de Riverz cree nada a mano; a cambio, el `client_id`
-- no prueba identidad y por eso PKCE no es opcional.
CREATE TABLE IF NOT EXISTS public.oauth_clients (
  client_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Códigos de autorización ──
--
-- Viven un minuto y se usan una sola vez. `used_at` en vez de borrar: un código
-- reutilizado es la señal de que alguien lo interceptó, y para verla hay que
-- poder distinguir "ya se usó" de "nunca existió".
CREATE TABLE IF NOT EXISTS public.oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  scope          TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Refresh ──
--
-- El access token dura una hora justamente para que esto exista: si se filtra,
-- la ventana es corta. El refresh es el que se guarda, y el que se revoca
-- cuando alguien desconecta el conector.
CREATE TABLE IF NOT EXISTS public.oauth_refresh_tokens (
  token_hash   TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  scope        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS oauth_refresh_ws_idx
  ON public.oauth_refresh_tokens (workspace_id) WHERE revoked_at IS NULL;

ALTER TABLE public.oauth_clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo la clave de servicio. Nada de esto lo lee un navegador.

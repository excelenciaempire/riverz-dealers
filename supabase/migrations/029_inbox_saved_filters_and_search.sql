-- ============================================================
-- 029: Filtros guardados de bandeja + búsqueda full-text
-- ============================================================
--
-- 1) inbox_saved_filters: cada usuario puede guardar combinaciones de
--    filtros que aplica recurrentemente ("sin asignar de WhatsApp con
--    palabra precio en últimos 30 min"). El JSON describe el filtro y
--    el cliente lo aplica del lado del browser.
--
-- 2) Índice trigram sobre conversations + messages para que la
--    búsqueda full-text por el usuario sea snappy. pg_trgm ya está
--    habilitado en otras migrations (verificar: si no, lo creamos
--    acá).

-- Idempotente: la extensión la creamos solo si falta.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS inbox_saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Forma del JSON (validado en el cliente):
  --   { channel?: string, status?: 'unread'|'unassigned'|'mine',
  --     tag_ids?: string[], q?: string, ads_only?: boolean,
  --     time_window?: '30m'|'1h'|'24h'|'7d' }
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Posición en la lista del sidebar (ordenable).
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_saved_filters_user_idx
  ON inbox_saved_filters (user_id, sort_order);

ALTER TABLE inbox_saved_filters ENABLE ROW LEVEL SECURITY;

-- RLS: el usuario solo ve y edita sus propios filtros guardados.
-- Aunque tengamos workspace_id por integridad referencial, no
-- compartimos filtros entre miembros del workspace (cada agente
-- humano arma su propia vista).
DROP POLICY IF EXISTS inbox_saved_filters_select ON inbox_saved_filters;
CREATE POLICY inbox_saved_filters_select ON inbox_saved_filters
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS inbox_saved_filters_insert ON inbox_saved_filters;
CREATE POLICY inbox_saved_filters_insert ON inbox_saved_filters
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS inbox_saved_filters_update ON inbox_saved_filters;
CREATE POLICY inbox_saved_filters_update ON inbox_saved_filters
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS inbox_saved_filters_delete ON inbox_saved_filters;
CREATE POLICY inbox_saved_filters_delete ON inbox_saved_filters
  FOR DELETE USING (user_id = auth.uid());

-- Índices trigram para búsqueda full-text en la bandeja.
-- conversations.last_message_text se actualiza con cada mensaje;
-- lo indexamos con gin_trgm para ILIKE/similarity snappy.
CREATE INDEX IF NOT EXISTS conversations_last_msg_trgm_idx
  ON conversations USING gin (last_message_text gin_trgm_ops);

-- messages.content_text para buscar en el cuerpo de mensajes
-- históricos.
CREATE INDEX IF NOT EXISTS messages_content_trgm_idx
  ON messages USING gin (content_text gin_trgm_ops);

COMMENT ON TABLE inbox_saved_filters IS
  'Filtros guardados por usuario para la bandeja: cada agente humano arma su set de vistas.';

-- ============================================================
-- 046: ai_agents — fuente de conocimiento por URL (Firecrawl sync)
-- ============================================================
--
-- El editor del asistente ahora permite pegar la URL del sitio
-- de la tienda y sincronizar el catálogo + páginas relevantes con
-- Firecrawl. Guardamos la URL original (knowledge_url) y la fecha
-- del último scrape (knowledge_synced_at) para mostrarlas en la UI
-- y permitir resync incremental sin perder la referencia.
--
-- knowledge sigue siendo el campo donde queda el markdown
-- aglomerado del sitio, capeado por el endpoint a 30k chars.

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS knowledge_url TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_synced_at TIMESTAMPTZ;

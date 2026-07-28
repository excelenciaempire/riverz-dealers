-- ============================================================
-- 131 — Super Agente: el agente completo escribe la PRIMERA respuesta
--       a un comentario de Instagram.
--
-- Hoy hay DOS cerebros contestando en Instagram. El primer mensaje —la
-- respuesta al comentario— lo escribe `craftPersonalizedDM`: un redactor de
-- una sola pasada, sin herramientas, incapaz de consultar un pedido, cotizar
-- con el catálogo real, crear un checkout o escalar. Del segundo mensaje en
-- adelante contesta el agente completo (`runAiAgent`), con las cinco.
--
-- Alguien pregunta "¿cuánto vale?" y recibe medio agente justo en el momento
-- de mayor intención; si contesta, de repente le atiende otro sistema.
--
-- APAGADO (por defecto): idéntico a hoy, sin una sola consulta extra —el
-- camino Super carga la fila del agente de todas formas, así que el
-- interruptor viaja con ella.
--
-- ENCENDIDO: compone con el MISMO cerebro del Asistente (system prompt
-- completo + catálogo + Shopify + herramientas) y, ante CUALQUIER fallo, cae
-- al redactor de siempre — un comentario nunca se queda sin contestar. La
-- entrega no cambia: respuesta privada por comment_id + recordProactiveDm, así
-- que la bandeja se ve igual.
--
-- "Uno por workspace" se valida en la API (findSuperConflict), igual que el
-- conflicto de canales: un 23505 crudo no es un mensaje de error.
--
-- Idempotente. Se aplica A MANO por la Management API.
-- ============================================================

ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS is_super boolean NOT NULL DEFAULT false;

-- OBLIGATORIO — regla de la migración 129. La 078 revocó el SELECT a nivel de
-- TABLA sobre ai_agents para `authenticated` y lo re-otorgó columna por
-- columna. Una columna nueva sin su GRANT no se devuelve en null: rompe la
-- consulta ENTERA con 42501 y la lista de agentes deja de cargar en el
-- navegador. `is_super` no es secreta.
GRANT SELECT (is_super) ON public.ai_agents TO authenticated;

-- Buscar el agente super del workspace (validación de conflicto en la API).
CREATE INDEX IF NOT EXISTS idx_ai_agents_workspace_super
  ON public.ai_agents (workspace_id)
  WHERE is_super AND deleted_at IS NULL;

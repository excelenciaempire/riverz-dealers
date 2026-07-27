-- ============================================================
-- 121: coherencia de la configuración del agente
-- ============================================================
-- Auditoría de las opciones del editor de agentes. Tres arreglos de
-- datos; el resto del trabajo es de aplicación.
--
-- 1. Defaults divergentes entre la DB y la app. La API siempre manda
--    estos dos campos, así que las filas creadas por el producto
--    estaban bien — pero cualquier fila creada por fuera (seed, script,
--    service-role, backfill) nacía con OTRO comportamiento que el que
--    muestra la UI. Alineamos la DB con lo que el editor ofrece.
--
-- 2. Columnas muertas de la migración 039: la app sólo lee y escribe el
--    JSONB `business_hours`. Estas cuatro no las toca nadie. No las
--    borramos (podrían tener datos de antes), pero las marcamos para
--    que nadie vuelva a leerlas creyendo que son la fuente.
--
-- Nota: NO tocamos la unicidad de `channel_connections(workspace_id,
-- channel)`. Sería tentador para blindar los .maybeSingle(), pero un
-- workspace puede tener legítimamente más de una cuenta por canal y un
-- índice único implicaría borrar conexiones reales. Ese punto se
-- resuelve en código, leyendo siempre la más reciente.

-- ── 1. Defaults alineados con el editor ──────────────────────
-- response_mode: 'single' → 'dynamic' (el editor ofrece 'dynamic').
ALTER TABLE ai_agents
  ALTER COLUMN response_mode SET DEFAULT 'dynamic';

-- inbound_debounce_seconds: 0 → 8. El runner aplica un piso de 8s de
-- todos modos (agrupa ráfagas), así que 0 nunca fue un valor real.
ALTER TABLE ai_agents
  ALTER COLUMN inbound_debounce_seconds SET DEFAULT 8;

-- ── 2. Columnas obsoletas (migración 039) ────────────────────
COMMENT ON COLUMN ai_agents.business_hours_start IS
  'OBSOLETA — no se lee ni se escribe. La fuente es el JSONB business_hours.';
COMMENT ON COLUMN ai_agents.business_hours_end IS
  'OBSOLETA — no se lee ni se escribe. La fuente es el JSONB business_hours.';
COMMENT ON COLUMN ai_agents.business_hours_timezone IS
  'OBSOLETA — no se lee ni se escribe. La fuente es el JSONB business_hours.';
COMMENT ON COLUMN ai_agents.business_hours_days IS
  'OBSOLETA — no se lee ni se escribe. La fuente es el JSONB business_hours.';

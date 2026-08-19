-- 165 — Estado de la activación guiada
--
-- Una fila por comercio, como `ig_proactive_settings` y `voice_cod_settings`.
-- Guarda en qué paso quedó la activación, qué objetivos eligió y qué agente se
-- generó desde su marca.
--
-- Por qué hace falta guardarlo: la activación pide conectar Shopify y los
-- canales, y eso saca a la persona de la aplicación (OAuth de Meta, OAuth de
-- Shopify) y la trae de vuelta. Sin este estado, cada regreso la deja en el
-- paso uno y la única salida es abandonar.
--
-- Idempotente. Se aplica a mano por la Management API.

CREATE TABLE IF NOT EXISTS operacion_setup (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 1 conectar · 2 entender la marca · 3 elegir objetivo · 4 aprobar el plan
  step         SMALLINT NOT NULL DEFAULT 1,
  -- Claves de `PLAYBOOKS`. Puede elegir más de uno.
  playbooks    TEXT[] NOT NULL DEFAULT '{}',
  -- El agente que se generó leyendo el sitio de la marca, en borrador.
  generated_agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  -- Qué se creó al aprobar: para poder mostrarlo después sin recalcularlo.
  applied      JSONB,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE operacion_setup ENABLE ROW LEVEL SECURITY;

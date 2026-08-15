-- ============================================================
-- 153 — Memoria del vigilante de plataforma
-- ============================================================
--
-- El cron `platform-watch` mira, cada 15 minutos, qué está roto en toda la
-- plataforma y avisa por el WhatsApp de Riverz. Para eso necesita recordar qué
-- avisó la vez anterior: sin memoria, las dos opciones son mandar el mismo
-- mensaje cada 15 minutos (y que se deje de leer a la tercera vez) o mandar uno
-- por día (que es lo que ya hace `issues-alert` para el comercio, y no sirve
-- para enterarse ahora).
--
-- La huella es el conjunto ordenado de `workspace_id:kind`. Si no cambió, no se
-- avisa. Si aparece una clave nueva, sale un mensaje con SÓLO esa.
--
-- Una sola fila, como `platform_ai_settings` y `platform_whatsapp_settings`.
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_watch_state (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  fingerprint  TEXT,
  notified_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_watch_state ENABLE ROW LEVEL SECURITY;
-- Sin políticas a propósito: sólo la clave de servicio. Ningún comercio tiene
-- nada que ver con esta tabla.

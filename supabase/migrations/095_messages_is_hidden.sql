-- ============================================================
-- 095 — Estado "oculto" persistente para comentarios FB/IG
-- ============================================================
--
-- Ocultar un comentario (fb_comment / ig_comment) desde la bandeja llama a la
-- Graph API de Meta, pero hasta ahora el estado vivía solo en el React state
-- del botón: al recargar la página se perdía, el ícono volvía a "ocultar" y ya
-- no se podía mostrar de nuevo. Persistimos el flag acá para que:
--   - sobreviva recargas (el hilo hace select * → el botón inicializa su estado),
--   - se sincronice entre pestañas/paneles (messages ya está en la publicación
--     supabase_realtime desde 001, así que el UPDATE se propaga solo),
--   - "oculto" quede claramente distinto de "eliminado" (status/[deleted]).
--
-- La ruta /api/messages/moderate escribe este flag al ocultar/mostrar.
--
-- Additive + default false → filas existentes intactas. Idempotente.
-- Aplicar vía Management API (manual).
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

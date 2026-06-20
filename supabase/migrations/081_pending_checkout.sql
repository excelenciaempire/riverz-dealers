-- ============================================================
-- 081 — Pending-checkout awareness + payment recovery
-- ============================================================
--
-- Cuando el asistente IA manda un link de checkout (tool create_checkout),
-- queremos: (a) que sea "consciente" de que lo mandó, (b) confirmar el
-- pago cuando llegue, y (c) hacer follow-up de recuperación si no paga.
--
-- Estado por conversación:
--   * pending_checkout_at  — cuándo el asistente mandó el link (NULL = no
--     hay checkout pendiente, o ya se pagó/limpió).
--   * pending_checkout_url — el link enviado, para reenviarlo en el
--     follow-up de recuperación.
--
-- El follow-up de recuperación REUSA el cron de seguimientos (079): una
-- conversación con pending_checkout_at se sigue con un mensaje de
-- recuperación de pago en vez del genérico. La confirmación de pago la
-- dispara el webhook orders/create con ATRIBUCIÓN POR PEDIDO (si el
-- pedido vino de un link del asistente, confirma el asistente y se SALTA
-- la automatización "Nuevo pedido"; si no, corre la automatización).
--
-- Escriben el runner / webhook / cron con el cliente service-role
-- (RLS-bypassing). Idempotente. Aplicar vía Management API (manual).
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS pending_checkout_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_checkout_url TEXT;

-- El cron de seguimientos ya filtra por (workspace_id, status, last_*);
-- el chequeo de pending_checkout es por fila, no necesita índice propio.

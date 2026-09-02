-- Un comprobante puede llegar como imagen, audio y texto en el mismo chat.
-- Los tres describen el mismo pago: debe haber una sola decisión pendiente
-- por pedido, incluso si dos procesos intentan crearla al mismo tiempo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_requests_pending_dedupe_key
  ON approval_requests (workspace_id, kind, (payload->>'dedupe_key'))
  WHERE status = 'pendiente' AND payload ? 'dedupe_key';

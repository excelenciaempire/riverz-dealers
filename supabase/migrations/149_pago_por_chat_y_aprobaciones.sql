-- ============================================================
-- 149: el pago que llega por chat, y el humano que lo aprueba
-- ============================================================
--
-- Quien paga por transferencia manda el comprobante por WhatsApp. Hasta hoy
-- eso no llegaba a ningún lado: Shopify sólo se entera si el comercio lo
-- marca a mano, así que el pedido seguía "pendiente" y los recordatorios le
-- seguían llegando a alguien que ya había pagado.
--
-- Dos decisiones distintas, con dos exigencias distintas:
--
--   * DEJAR DE INSISTIR es automático. El daño de molestar a quien ya pagó es
--     inmediato, y equivocarse en callar no le cuesta nada a nadie. Alcanza
--     con que la persona diga que pagó: se anota en `payment_reported_at` y
--     la condición "Pagó el pedido" del flujo lo toma como sí.
--
--   * DAR POR COBRADO no. Marcar pagado un pedido que no se pagó termina en
--     mercadería despachada que nadie pagó. Sólo se marca solo cuando el monto
--     del comprobante coincide con el del pedido; si no, se le pregunta a una
--     persona.
--
-- Esa pregunta viaja por el WhatsApp de Riverz (migración 147) y su respuesta
-- vuelve por el mismo lado: de ahí `approval_requests`.

-- ── El pago que informó el cliente ──
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_reported_at TIMESTAMPTZ,
  -- Lo que dijo o mostró: monto leído del comprobante, cuando se pudo leer.
  ADD COLUMN IF NOT EXISTS payment_reported_amount NUMERIC,
  -- El mensaje donde llegó, para poder volver a mirarlo desde la bandeja.
  ADD COLUMN IF NOT EXISTS payment_report_message_id UUID,
  -- Cómo se resolvió: 'automatico' (coincidió el monto), 'aprobado',
  -- 'rechazado', o NULL mientras espera.
  ADD COLUMN IF NOT EXISTS payment_report_outcome TEXT;

COMMENT ON COLUMN orders.payment_reported_at IS
  'Cuándo el cliente dijo por chat que ya pagó. Frena los recordatorios aunque Shopify todavía diga pendiente.';

CREATE INDEX IF NOT EXISTS idx_orders_payment_reported
  ON orders (workspace_id, payment_reported_at)
  WHERE payment_reported_at IS NOT NULL;

-- ── Lo que espera un sí o un no de una persona ──
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Qué se está preguntando. Empieza con 'pago_informado' y crece: cada cosa
  -- que la operación quiera hacer sola pero convenga confirmar entra acá.
  kind TEXT NOT NULL,
  -- Lo que se le muestra a la persona, ya redactado.
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  -- Lo que hace falta para ejecutar si dice que sí (order_id, monto, etc.).
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'aprobada', 'rechazada', 'vencida', 'fallida')),
  -- A quién se le preguntó y por dónde salió la pregunta.
  notified_phone TEXT,
  notified_message_id TEXT,
  -- Vencen: una pregunta sin contestar de hace una semana ya no significa
  -- nada, y dejarla viva es arriesgar que alguien la conteste tardísimo.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '3 days',
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Cómo contestó: 'whatsapp' o 'panel'.
  decided_via TEXT,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_pendientes
  ON approval_requests (workspace_id, status, created_at DESC);

-- Se busca por el mensaje al contestar desde WhatsApp.
CREATE INDEX IF NOT EXISTS idx_approval_requests_mensaje
  ON approval_requests (notified_message_id)
  WHERE notified_message_id IS NOT NULL;

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- El comercio ve y decide lo suyo; escribirlas es cosa del sistema.
CREATE POLICY approval_requests_select ON approval_requests
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY approval_requests_update ON approval_requests
  FOR UPDATE USING (is_workspace_member(workspace_id));

COMMENT ON TABLE approval_requests IS
  'Decisiones que la operación puede tomar sola pero conviene confirmar. Se preguntan por el WhatsApp de Riverz y se contestan por ahí o desde el panel.';

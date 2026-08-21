-- ============================================================
-- 180: la correa de cada herramienta, y las devoluciones
-- ============================================================

-- ── 1. Qué puede hacer el agente, y con qué correa ──────────────
--
-- Hasta acá cada capacidad se prendía en un lugar distinto: un booleano en
-- `permissions`, una columna vieja (`puede_crear_pedidos`), un tope numérico
-- en otra tabla, y varias directamente cableadas. El comercio no tenía forma
-- de mirar una pantalla y saber qué hace su agente solo y qué no.
--
-- `tools` es esa pantalla: `{ "<herramienta>": "off" | "aprobacion" | "auto" }`.
--
-- Los tres estados son el punto. Entre "no lo hace" y "lo hace solo" está el
-- caso que un negocio real quiere casi siempre — que lo prepare y lo confirme
-- una persona —, y es ahí donde se decide cuándo entra un humano.
--
-- Arranca NULL a propósito: sin fila, cada herramienta hereda del permiso
-- viejo que ya tenía (ver `toolMode` en src/lib/ai/toolbox.ts). Aplicar esto
-- no le cambia el agente a nadie.
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS tools jsonb;

COMMENT ON COLUMN ai_agents.tools IS
  'Modo por herramienta: off | aprobacion | auto. NULL hereda de permissions.';

-- ── 2. Devoluciones ─────────────────────────────────────────────
--
-- Era el último hueco de postventa: cancelar y reembolsar ya existen, pero
-- "me llegó roto, quiero devolverlo" no tenía dónde vivir. La política de
-- devolución era un texto suelto en una plantilla de flujo, así que cada caso
-- se resolvía de memoria y sin dejar rastro.
--
-- Las fotos importan tanto como el motivo: son la prueba, y el chat web y
-- WhatsApp ya las reciben. Se guardan como rutas del bucket privado, igual que
-- cualquier otro adjunto.
CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  -- El número que la clienta dice y el comercio reconoce. Se guarda aparte del
  -- `order_id` porque un pedido espejado a mano puede no tener fila.
  order_number text,
  -- Qué quiere: que le devuelvan la plata o que le manden otro.
  kind text NOT NULL DEFAULT 'devolucion'
    CHECK (kind IN ('devolucion', 'cambio')),
  reason text,
  -- Lo que la clienta escribió, tal cual. El motivo de arriba lo resume el
  -- agente y conviene poder leer el original.
  customer_note text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'abierta'
    CHECK (status IN ('abierta', 'aprobada', 'rechazada', 'recibida', 'resuelta')),
  -- Por qué se cerró así. Es lo que el agente le puede contar a la clienta.
  resolution text,
  created_by text NOT NULL DEFAULT 'ai'
    CHECK (created_by IN ('ai', 'manual', 'sync')),
  agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Una devolución abierta por pedido: insistir en el chat no puede abrir tres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_devolucion_abierta_por_pedido
  ON returns (workspace_id, order_id)
  WHERE order_id IS NOT NULL AND status IN ('abierta', 'aprobada', 'recibida');

CREATE INDEX IF NOT EXISTS idx_returns_workspace_estado
  ON returns (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_contacto
  ON returns (contact_id, created_at DESC);

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS returns_miembros ON returns;
CREATE POLICY returns_miembros ON returns
  FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP TRIGGER IF EXISTS returns_touch ON returns;
CREATE TRIGGER returns_touch
  BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

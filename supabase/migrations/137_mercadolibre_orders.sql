-- 137 — Pedidos de Mercado Libre en la tabla `orders`.
--
-- Hasta ahora `orders` guardaba sólo lo que creaba la IA (migración 080): el
-- webhook de Shopify UPDATEa filas existentes, nunca inserta. Mercado Libre
-- estrena el otro caso — pedidos que nacen fuera de Riverz y hay que espejar.
--
-- Encajan sin torcer nada: la tabla ya distingue el origen por `channel` y
-- `agent_id` (los de ML van con channel='mercadolibre' y agent_id NULL), y la
-- pantalla /pedidos los lista sin filtrar por IA. Lo único que faltaba era
-- poder hacer UPSERT sin duplicar cuando el mismo pedido llega dos veces (el
-- webhook y el sondeo se pisan por diseño).
--
-- `created_by` pasa a admitir 'sync': el DEFAULT es 'ai' y sería mentira en un
-- pedido que hizo un comprador solo en Mercado Libre.
--
-- APLICAR A MANO por la Management API.

-- Clave natural del espejo. PARCIAL: las filas viejas creadas por la IA sin
-- shopify_order_id (todavía sin confirmar en la tienda) quedan fuera y no
-- chocan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_external
  ON public.orders (workspace_id, shop_domain, shopify_order_id)
  WHERE shop_domain IS NOT NULL AND shopify_order_id IS NOT NULL;

-- Seguimiento del envío. Shopify lo resuelve en vivo contra su API, pero en
-- Mercado Libre el envío es la mitad de la conversación post-venta ("¿cuándo
-- llega?") y el dato ya viene con el pedido: guardarlo evita una llamada por
-- cada pregunta.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_number  TEXT,
  ADD COLUMN IF NOT EXISTS tracking_company TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url     TEXT,
  ADD COLUMN IF NOT EXISTS shipping_status  TEXT;

COMMENT ON COLUMN public.orders.shipping_status IS
  'Estado del envío tal como lo informa la plataforma (ML: ready_to_ship, shipped, delivered, not_delivered…).';

-- Un pedido espejado no lo creó la IA.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_created_by_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_created_by_check
  CHECK (created_by IN ('ai', 'sync', 'manual'));

-- Reclamos de Mercado Libre. No es un mensaje ni un pedido: es un problema
-- abierto con plazo, y lo que importa es verlo antes de que venza.
CREATE TABLE IF NOT EXISTS public.ml_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id  UUID REFERENCES public.channel_connections(id) ON DELETE CASCADE,
  claim_id       TEXT NOT NULL,
  resource_id    TEXT,
  order_id       TEXT,
  contact_id     UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  stage          TEXT,
  status         TEXT,
  type           TEXT,
  reason         TEXT,
  last_message   TEXT,
  opened_at      TIMESTAMPTZ,
  due_at         TIMESTAMPTZ,
  raw            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ml_claims
  ON public.ml_claims (workspace_id, claim_id);
CREATE INDEX IF NOT EXISTS idx_ml_claims_open
  ON public.ml_claims (workspace_id, updated_at DESC)
  WHERE status <> 'closed';

ALTER TABLE public.ml_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY ml_claims_select ON public.ml_claims
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

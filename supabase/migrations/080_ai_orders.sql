-- ============================================================
-- 080 — AI-created orders + per-agent "can place orders" toggle
-- ============================================================
--
-- Context: until now the AI assistant could only emit a Shopify
-- cart-permalink LINK (create_checkout) — it never created an order, and
-- nothing about the sale was reflected in Riverz. The new direction
-- (see the runner's create_order tool) lets an agent ASSEMBLE and PLACE
-- a real Shopify order from the conversation, persisted here so the
-- merchant sees it inside Riverz too.
--
-- Two parts:
--   1) ai_agents.puede_crear_pedidos — per-agent gate, mirrors the
--      followup_enabled pattern (migration 079). OFF by default: placing
--      real orders is a deliberate opt-in (and needs the write_orders
--      Shopify scope, so each store must reconnect first).
--   2) orders — Riverz-side record of every AI-created order, linked to
--      the workspace, contact, agent and conversation that produced it,
--      plus the Shopify order id so the orders webhook can reconcile
--      payment/fulfillment status back onto the row.
--
-- RLS mirrors 075/077: member SELECT via is_workspace_member(); writes
-- are service-role only (the runner inserts with the RLS-bypassing
-- service client; the orders webhook updates the same way). Idempotent.
-- Apply via the Supabase Management API (migrations are manual here).
-- ============================================================

-- ── Preconditions: helpers must exist (defensive no-op assertion) ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_workspace_member'
  ) THEN
    RAISE EXCEPTION
      '080 requires is_workspace_member() (013_unified_inbox.sql). Apply 013 first.';
  END IF;
END $$;

-- ── 1) Per-agent toggle ──────────────────────────────────────────────
ALTER TABLE public.ai_agents
  -- ON: el asistente puede armar y crear el pedido real en Shopify.
  -- OFF (default): no cierra pedidos por su cuenta; deja el cierre a una
  -- persona del equipo.
  ADD COLUMN IF NOT EXISTS puede_crear_pedidos boolean NOT NULL DEFAULT false;

-- Migration 078 revoked table-level SELECT on ai_agents from
-- `authenticated` and re-granted only specific (non-secret) columns. The
-- new flag is non-secret, so add it to that grant (idempotent).
GRANT SELECT (puede_crear_pedidos) ON public.ai_agents TO authenticated;

-- ── 2) Orders table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Quién/qué lo originó. SET NULL para no perder el pedido si se borra
  -- el contacto / agente / conversación.
  contact_id         UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  agent_id           UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  conversation_id    UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  channel            TEXT,

  -- Vínculo con Shopify (la orden vive allá; acá guardamos el espejo).
  shop_domain        TEXT,
  shopify_order_id   TEXT,
  order_number       TEXT,
  order_status_url   TEXT,

  -- Contenido del pedido.
  currency           TEXT,
  total_price        NUMERIC,
  line_items         JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Datos del cliente capturados en la conversación.
  customer_name      TEXT,
  customer_phone     TEXT,
  customer_email     TEXT,
  shipping_address   JSONB,
  payment_method     TEXT,

  -- Estado. financial_status / fulfillment_status reflejan Shopify;
  -- `status` es el ciclo de vida del lado Riverz.
  financial_status   TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT,
  status             TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'fulfilled', 'refunded', 'cancelled', 'failed')),

  created_by         TEXT NOT NULL DEFAULT 'ai',
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listado por workspace (la página /pedidos) ordenado por fecha.
CREATE INDEX IF NOT EXISTS idx_orders_workspace_created
  ON public.orders (workspace_id, created_at DESC);

-- Reconciliación desde el webhook orders/create|updated por id de Shopify.
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order
  ON public.orders (shop_domain, shopify_order_id);

-- Pedidos por contacto (vista del contacto / futuras métricas).
CREATE INDEX IF NOT EXISTS idx_orders_contact
  ON public.orders (contact_id)
  WHERE contact_id IS NOT NULL;

-- ── RLS: member SELECT, writes service-role only (mirrors 077) ────────
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT USING (is_workspace_member(workspace_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated`: the runner and the
-- Shopify webhook write with the service-role client (RLS-bypassing).
-- The browser only ever reads.
GRANT SELECT ON public.orders TO authenticated;

-- ── Realtime (mirrors 071): publish so /pedidos can go live later. ────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in the publication
  WHEN undefined_object THEN NULL;  -- publication doesn't exist (dev)
END $$;

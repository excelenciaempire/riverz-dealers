-- 176 — Hasta cuánto puede descontar el agente.
--
-- El agente ya puede cerrar una venta, pero no puede mover el precio: ante
-- "¿me hacés un descuento?" sólo sabe decir que no. Es la objeción más común
-- que existe en una tienda, y la que más ventas cuesta.
--
-- Lo que hace falta para poder decir que sí NO es un permiso más: es un número.
-- Un descuento es margen del comercio, y quién decide cuánto se puede regalar
-- es el comercio, no el modelo. Por eso el tope vive acá, junto al precio y a
-- las ofertas, y no en los permisos del agente.
--
-- **Default 0 a propósito, y es la excepción a "todo encendido".** Con 0 la
-- herramienta ni siquiera se le ofrece al agente. Cualquier otro default
-- estaría regalando plata de comercios que nunca lo pidieron — y el agente lee
-- mensajes de desconocidos, así que "dame 50% o me voy" es exactamente el
-- mensaje que va a recibir. El tope es lo que hace que ese mensaje no funcione.
--
-- APLICAR A MANO por la Management API.

ALTER TABLE public.workspace_checkout_config
  ADD COLUMN IF NOT EXISTS max_discount_percent SMALLINT NOT NULL DEFAULT 0
    CHECK (max_discount_percent >= 0 AND max_discount_percent <= 50);

COMMENT ON COLUMN public.workspace_checkout_config.max_discount_percent IS
  'Descuento máximo, en %, que el agente puede ofrecer por su cuenta. 0 = no puede (default). El tope duro de 50 evita que un error de tipeo regale la tienda.';

-- Los cupones que el agente emite en una conversación.
--
-- Existe para dos cosas que se ven recién después: saber cuánto se regaló (un
-- descuento que nadie mide es margen que se va sin registro), y poder reusar el
-- código de esa persona en vez de emitirle uno nuevo cada vez que pregunta.
CREATE TABLE IF NOT EXISTS public.agent_discounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  agent_id        UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  code            TEXT NOT NULL,
  percent         SMALLINT NOT NULL,
  shop_domain     TEXT,
  price_rule_id   TEXT,
  /* Se sella cuando llega un pedido que lo usó: es la medida de si sirvió. */
  redeemed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un cupón por persona: si vuelve a pedir, se le devuelve el mismo en vez de
-- emitirle otro. Sin esto, insistir sería una forma de juntar cupones.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_discount_por_contacto
  ON public.agent_discounts (workspace_id, contact_id)
  WHERE contact_id IS NOT NULL AND redeemed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_discounts_ws_created
  ON public.agent_discounts (workspace_id, created_at DESC);

ALTER TABLE public.agent_discounts ENABLE ROW LEVEL SECURITY;

-- Lectura para el equipo del comercio; las escrituras son del servidor.
DROP POLICY IF EXISTS agent_discounts_select ON public.agent_discounts;
CREATE POLICY agent_discounts_select ON public.agent_discounts
  FOR SELECT USING (is_workspace_member(workspace_id));

GRANT SELECT ON public.agent_discounts TO authenticated;

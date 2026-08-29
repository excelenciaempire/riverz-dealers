-- 219 — Cómo cobra el agente.
--
-- El problema:
--   El agente ya sabe hacer las dos cosas: mandar a la caja de la tienda
--   (`create_checkout`) y tomar el pedido en la conversación pidiendo nombre,
--   dirección y forma de pago (`create_order`). Pero cuál de las dos hace no
--   era una decisión de nadie: salía de qué herramientas estuvieran prendidas
--   en la pizarra, y con las dos prendidas elegía el modelo, mensaje a mensaje.
--
--   Eso no es una preferencia del comercio: es un accidente. Y se nota en el
--   número que más importa — un comercio de contra-entrega que manda a la caja
--   pierde a quien no tiene tarjeta, y uno que vende con tarjeta y se pone a
--   pedir la dirección por chat agrega diez mensajes a una compra de un clic.
--
-- Lo que decide:
--   checkout    — siempre a la caja de la tienda.
--   chat        — siempre toma el pedido en la conversación.
--   segun_pago  — contra-entrega en el chat, tarjeta a la caja. El default:
--                 es lo que hace un vendedor que entiende su negocio.
--
-- Lo que NO decide: qué está permitido. Eso sigue siendo la pizarra de
-- herramientas. Este ajuste sólo elige entre lo que ya está habilitado — con
-- `crear_pedido` apagado, manda a la caja diga lo que diga esta columna. Un
-- ajuste que ampliara permisos por su cuenta convertiría la pizarra en un
-- adorno.
--
-- APLICAR A MANO por la Management API (no corre en el deploy de Render).

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS cobro_modo TEXT NOT NULL DEFAULT 'segun_pago';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_agents_cobro_modo_check'
  ) THEN
    ALTER TABLE ai_agents
      ADD CONSTRAINT ai_agents_cobro_modo_check
      CHECK (cobro_modo IN ('checkout', 'chat', 'segun_pago'));
  END IF;
END $$;

COMMENT ON COLUMN ai_agents.cobro_modo IS
  'Cómo cierra la venta: checkout (a la caja de la tienda), chat (toma el pedido en la conversación) o segun_pago (contra-entrega en el chat, tarjeta a la caja). Elige entre lo que la pizarra de herramientas ya permite; nunca amplía permisos.';

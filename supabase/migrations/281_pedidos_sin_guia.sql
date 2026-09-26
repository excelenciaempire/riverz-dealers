-- PEDIDOS SIN GUÍA.
--
-- La guía le llega a Riverz por Shopify: la app logística (Dropi, en el caso
-- que lo destapó) crea el envío en la tienda y ese cambio dispara el aviso de
-- despacho. Cuando la app no sincroniza, el pedido sale igual de la bodega,
-- pero en Shopify sigue "sin preparar" y el cliente nunca recibe su guía. Nadie
-- se entera: pasó el 2026-09-26 con el #1011 de DeUNA Shop, despachado en Dropi
-- y sin una sola línea en Shopify.
--
-- Columnas nuevas en el espejo de pedidos:
--   shop_tags             las etiquetas del pedido en la tienda. Son la única
--                         señal de que el pedido ya se entregó a logística
--                         ("Order sent to dropi") o se confirmó ("Confirmado").
--   tracking_source       'shopify' si la guía vino de la tienda, 'manual' si
--                         la cargó el comercio desde Riverz.
--   tracking_recorded_at  cuándo se cargó a mano.
--   tracking_dismissed_at el comercio marcó que este pedido no se despacha
--                         (duplicado, prueba): deja de contar como pendiente.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shop_tags text,
  ADD COLUMN IF NOT EXISTS tracking_source text,
  ADD COLUMN IF NOT EXISTS tracking_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_dismissed_at timestamptz;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_tracking_source_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_tracking_source_check
  CHECK (tracking_source IS NULL OR tracking_source IN ('shopify', 'manual'));

-- Qué pedido debería tener guía y no la tiene. Una sola definición para el
-- aviso y para la pantalla donde se carga, así no se pueden contradecir.
--
-- "Debería tenerla" exige que el pedido ya haya salido de las manos de la
-- tienda: pagado, confirmado o entregado a la app logística. Un pedido contra
-- entrega sin confirmar o una transferencia sin pagar tampoco tienen guía, pero
-- ahí no falta nada: todavía no se despachó, y contarlos llenaba el aviso de
-- pedidos que nadie iba a enviar.
--
-- 48 h es lo que tarda un despacho normal en tener guía; 21 días es el techo
-- para no arrastrar pedidos viejos que ya nadie va a despachar.
CREATE OR REPLACE FUNCTION public.orders_missing_tracking(p_workspace_id uuid DEFAULT NULL)
RETURNS SETOF public.orders
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT o.*
    FROM orders o
    JOIN workspaces w ON w.id = o.workspace_id AND w.deleted_at IS NULL
   WHERE (p_workspace_id IS NULL OR o.workspace_id = p_workspace_id)
     AND o.platform = 'shopify'
     AND o.shopify_order_id IS NOT NULL
     AND o.status NOT IN ('cancelled', 'failed', 'fulfilled')
     AND coalesce(o.fulfillment_status, '') IN ('', 'unfulfilled')
     AND coalesce(btrim(o.tracking_number), '') = ''
     AND o.tracking_dismissed_at IS NULL
     AND o.created_at < now() - interval '48 hours'
     AND o.created_at >= now() - interval '21 days'
     AND (
       o.financial_status = 'paid'
       OR EXISTS (
         SELECT 1
           FROM unnest(string_to_array(lower(coalesce(o.shop_tags, '')), ',')) AS t(tag)
          WHERE btrim(t.tag) IN ('order sent to dropi', 'confirmado')
             OR btrim(t.tag) = (
                  SELECT lower(btrim(cc.config -> 'order_writeback' ->> 'confirmed_tag'))
                    FROM channel_connections cc
                   WHERE cc.workspace_id = o.workspace_id AND cc.channel = 'voice'
                   LIMIT 1
                )
       )
     );
$function$;

REVOKE ALL ON FUNCTION public.orders_missing_tracking(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orders_missing_tracking(uuid) TO service_role;

-- El aviso en "Necesita tu atención". Sólo cuenta en comercios con una
-- automatización de despacho activa: ahí la guía que falta es un mensaje que no
-- sale. Sin esa automatización, un pedido sin guía en Shopify puede ser la
-- forma en que ese comercio trabaja.
DO $migration$
DECLARE
  original text := pg_get_functiondef('public.admin_workspace_issues(uuid)'::regprocedure);
  revised text;
BEGIN
  IF position('health_tracking_missing' IN original) > 0 THEN RETURN; END IF;
  revised := replace(original, '  mudo AS (', $cte$
  -- health_tracking_missing: ver orders_missing_tracking (migración 281).
  sin_guia AS (
    SELECT o.workspace_id,
           count(*) AS n,
           array_to_string(
             (array_agg(o.order_number ORDER BY o.created_at DESC))[1:5], ', '
           ) AS pedidos,
           max(o.created_at) AS last_at
      FROM orders_missing_tracking(p_workspace_id) o
     WHERE EXISTS (
             SELECT 1 FROM automations a
              WHERE a.workspace_id = o.workspace_id
                AND a.trigger_type = 'shopify_order_fulfilled'
                AND a.is_active
                AND a.deleted_at IS NULL
           )
     GROUP BY 1
  ),

  mudo AS ($cte$);
  IF revised = original THEN RAISE EXCEPTION 'health mudo CTE not found'; END IF;
  original := revised;
  revised := replace(revised, '    FROM ia_caida;', $tail$    FROM ia_caida
  UNION ALL
  SELECT workspace_id, 'tracking_missing', 'warning', n, pedidos,
         'shopify', NULL::text, last_at
    FROM sin_guia;$tail$);
  IF revised = original THEN RAISE EXCEPTION 'health final select not found'; END IF;
  EXECUTE revised;
END;
$migration$;

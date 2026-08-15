-- ============================================================
-- 155 — Historial de caídas y reconexiones
-- ============================================================
--
-- `channel_connections` y `shopify_connections` guardan sólo el estado ACTUAL.
-- En cuanto el comercio reconecta, la caída desaparece: no se puede contestar
-- "¿qué integración se cayó esta semana?" ni "¿cuánto estuvo abajo?". Para una
-- plataforma que vive de que los canales estén arriba, ese es el dato que más
-- falta.
--
-- POR QUÉ UN TRIGGER Y NO CÓDIGO DE APLICACIÓN
--
-- Se relevaron los puntos de escritura: son 11 sobre `channel_connections` y 7
-- sobre `shopify_connections`. Cuatro pasan por helpers; el resto escribe
-- directo — incluida la desconexión manual, que corre en el NAVEGADOR con el
-- cliente anon (`components/settings/channels-panel.tsx`), o sea que ningún
-- enganche del servidor la vería. Un trigger los cubre a todos, incluidos los
-- que se escriban mañana.
--
-- Se registra sólo el CAMBIO de estado (`IS DISTINCT FROM`): los upsert que
-- reescriben la misma fila con el mismo status no ensucian el historial.
--
-- El DELETE también entra: desconectar una tienda desde el panel del comercio
-- borra la fila en vez de cambiarle el estado, así que sin esto una tienda
-- desconectada se evapora del historial sin dejar rastro.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.connection_events (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID,
  -- 'channel' (mensajería) o 'store' (Shopify/Tiendanube/WooCommerce).
  source        TEXT NOT NULL,
  -- El canal o la plataforma: whatsapp, instagram, shopify, tiendanube…
  channel       TEXT,
  -- Con qué cuenta: phone_number_id, page_id, dominio de la tienda.
  account       TEXT,
  previous_status TEXT,
  status        TEXT NOT NULL,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connection_events_at_idx
  ON public.connection_events (created_at DESC);
CREATE INDEX IF NOT EXISTS connection_events_ws_idx
  ON public.connection_events (workspace_id, created_at DESC);

ALTER TABLE public.connection_events ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo la clave de servicio. El comercio ve el estado actual en
-- su pantalla de Integraciones; el historial es una herramienta de plataforma.

-- ------------------------------------------------------------
-- Canales de mensajería
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_channel_connection_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO connection_events
      (workspace_id, source, channel, account, previous_status, status, last_error)
    VALUES
      (OLD.workspace_id, 'channel', OLD.channel, OLD.external_account_id,
       OLD.status, 'removed', NULL);
    RETURN OLD;
  END IF;

  INSERT INTO connection_events
    (workspace_id, source, channel, account, previous_status, status, last_error)
  VALUES
    (NEW.workspace_id, 'channel', NEW.channel, NEW.external_account_id,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
     NEW.status, NEW.last_error);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_connections_status_log ON public.channel_connections;
CREATE TRIGGER channel_connections_status_log
  AFTER INSERT OR DELETE ON public.channel_connections
  FOR EACH ROW EXECUTE FUNCTION log_channel_connection_event();

DROP TRIGGER IF EXISTS channel_connections_status_change ON public.channel_connections;
CREATE TRIGGER channel_connections_status_change
  AFTER UPDATE OF status ON public.channel_connections
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_channel_connection_event();

-- ------------------------------------------------------------
-- Tiendas (Shopify / Tiendanube / WooCommerce, misma tabla)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_store_connection_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO connection_events
      (workspace_id, source, channel, account, previous_status, status, last_error)
    VALUES
      (OLD.workspace_id, 'store', COALESCE(OLD.platform, 'shopify'), OLD.shop_domain,
       OLD.status, 'removed', NULL);
    RETURN OLD;
  END IF;

  INSERT INTO connection_events
    (workspace_id, source, channel, account, previous_status, status, last_error)
  VALUES
    (NEW.workspace_id, 'store', COALESCE(NEW.platform, 'shopify'), NEW.shop_domain,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
     NEW.status, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shopify_connections_status_log ON public.shopify_connections;
CREATE TRIGGER shopify_connections_status_log
  AFTER INSERT OR DELETE ON public.shopify_connections
  FOR EACH ROW EXECUTE FUNCTION log_store_connection_event();

DROP TRIGGER IF EXISTS shopify_connections_status_change ON public.shopify_connections;
CREATE TRIGGER shopify_connections_status_change
  AFTER UPDATE OF status ON public.shopify_connections
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_store_connection_event();

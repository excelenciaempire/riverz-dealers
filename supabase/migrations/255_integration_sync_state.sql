-- Durable recovery state; no historical events are replayed as automations.
ALTER TABLE public.shopify_connections ADD COLUMN IF NOT EXISTS sync_state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.request_connection_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.config := coalesce(NEW.config, '{}'::jsonb) || jsonb_build_object('sync_requested_at', now());
  ELSIF OLD.status = 'disconnected' AND NEW.status <> 'disconnected' THEN
    NEW.config := coalesce(NEW.config, '{}'::jsonb) || jsonb_build_object('sync_requested_at', now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS request_connection_sync ON public.channel_connections;
CREATE TRIGGER request_connection_sync BEFORE INSERT OR UPDATE OF status ON public.channel_connections
FOR EACH ROW EXECUTE FUNCTION public.request_connection_sync();

CREATE OR REPLACE FUNCTION public.request_store_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.sync_state := coalesce(NEW.sync_state, '{}'::jsonb) || jsonb_build_object('requested_at', now(), 'complete', false);
  ELSIF OLD.status = 'uninstalled' AND NEW.status = 'active' THEN
    NEW.sync_state := coalesce(NEW.sync_state, '{}'::jsonb) || jsonb_build_object('requested_at', now(), 'complete', false);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS request_store_sync ON public.shopify_connections;
CREATE TRIGGER request_store_sync BEFORE INSERT OR UPDATE OF status ON public.shopify_connections
FOR EACH ROW EXECUTE FUNCTION public.request_store_sync();

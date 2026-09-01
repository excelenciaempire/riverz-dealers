-- Aplicaciones creadas en Shopify Dev Dashboard.
-- Su client secret permite solicitar un token nuevo cada 24 horas; se cifra
-- igual que el token de acceso y nunca se expone al cliente.

ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS client_id_encrypted TEXT;

ALTER TABLE public.shopify_connections
  DROP CONSTRAINT IF EXISTS shopify_connections_connection_method_check;
ALTER TABLE public.shopify_connections
  ADD CONSTRAINT shopify_connections_connection_method_check
    CHECK (connection_method IN ('oauth', 'admin_token', 'api_key', 'client_credentials'));

COMMENT ON COLUMN public.shopify_connections.client_id_encrypted IS
  'Client ID cifrado de una app de Shopify Dev Dashboard. Se combina con webhook_secret para renovar tokens client_credentials.';

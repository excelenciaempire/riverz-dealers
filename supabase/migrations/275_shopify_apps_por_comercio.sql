-- 275 — Una app de Shopify por comercio.
--
-- Mientras la app pública no está aprobada, Shopify no la deja instalar en
-- tiendas reales. Para que el dueño sólo tenga que pulsar "Instalar", Riverz
-- crea en su organización una app con distribución personalizada para esa
-- tienda y le manda el enlace. Sirve también para la app que el comercio crea
-- en su propia organización.
--
-- Las credenciales se guardan acá antes de la instalación: cuando Shopify
-- avisa que la instalaron, la firma dice cuál de estas apps es y a qué
-- workspace va la tienda.

CREATE TABLE IF NOT EXISTS public.shopify_custom_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Quién la registró; la conexión queda a su nombre.
  user_id uuid NOT NULL,
  shop_domain text NOT NULL,
  client_id text NOT NULL,
  client_secret_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, client_id)
);

CREATE INDEX IF NOT EXISTS shopify_custom_apps_shop_idx
  ON public.shopify_custom_apps (shop_domain, updated_at DESC);

ALTER TABLE public.shopify_custom_apps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shopify_custom_apps FROM anon, authenticated;
GRANT ALL ON public.shopify_custom_apps TO service_role;

COMMENT ON TABLE public.shopify_custom_apps IS
  'App de Shopify de un comercio (distribución personalizada o de su propia organización). El secreto va cifrado.';

-- Una tienda conectada por una de estas apps: su token se renueva y sus
-- webhooks se verifican con el secreto de ESA app, no con el de la pública.
ALTER TABLE public.shopify_connections
  DROP CONSTRAINT IF EXISTS shopify_connections_connection_method_check;
ALTER TABLE public.shopify_connections
  ADD CONSTRAINT shopify_connections_connection_method_check
    CHECK (connection_method IN ('oauth', 'admin_token', 'api_key', 'client_credentials', 'custom_app'));

-- Google Maps Address Validation, configurable por workspace.
--
-- Reutiliza workspace_integrations: ya cifra API keys, tiene un interruptor
-- (`is_active`) y evita que las credenciales vuelvan al navegador.

ALTER TABLE public.workspace_integrations
  DROP CONSTRAINT IF EXISTS workspace_integrations_provider_check;

ALTER TABLE public.workspace_integrations
  ADD CONSTRAINT workspace_integrations_provider_check
  CHECK (provider = ANY (ARRAY[
    'klaviyo',
    'mercadopago',
    'meta_pixel',
    'google_address_validation'
  ]));

COMMENT ON TABLE public.workspace_integrations IS
  'Credenciales cifradas e interruptores por workspace para integraciones externas, incluida Google Address Validation.';

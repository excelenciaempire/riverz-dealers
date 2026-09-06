-- 252 — La identidad Shopify acompaña el token mientras espera ser reclamado.
-- La app pública y la legacy comparten callback, pero cada token sólo puede
-- operar extensiones y renovarse con el client id que lo emitió.

ALTER TABLE public.shopify_pending_installs
  ADD COLUMN IF NOT EXISTS client_id_encrypted TEXT;

REVOKE SELECT (client_id_encrypted) ON public.shopify_pending_installs
  FROM anon, authenticated;

COMMENT ON COLUMN public.shopify_pending_installs.client_id_encrypted IS
  'Client ID cifrado de la app Shopify que emitió el token pendiente.';

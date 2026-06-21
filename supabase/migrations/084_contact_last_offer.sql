-- ============================================================
-- 084 — Última oferta elegida por el contacto (flujos de recompra)
-- ============================================================
--
-- Para armar flujos de recompra distintos según la oferta que eligió la
-- persona, el webhook de pedidos de Shopify deriva qué oferta compró
-- (matcheando las unidades del pedido contra las ofertas configuradas por
-- producto en `shopify_products.allowed_offers`, ver detección "por número
-- de unidades") y la persiste acá sobre el contacto.
--
-- El agente de IA lee estas columnas (loadPrimaryContact hace select *) e
-- inyecta "el cliente eligió la oferta X" en el system prompt, de modo que
-- conoce la oferta sin tener que recalcularla.
--
--   last_offer_chosen  etiqueta de la oferta (ej. "3 unidades + 1 gratis")
--   last_offer_units   cantidad total de unidades del pedido
--   last_offer_at      cuándo se registró (último pedido con oferta)
--
-- Todo additive + nullable → filas existentes intactas. Idempotente.
-- Aplicar vía Management API (manual).
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_offer_chosen text,
  ADD COLUMN IF NOT EXISTS last_offer_units  integer,
  ADD COLUMN IF NOT EXISTS last_offer_at     timestamptz;

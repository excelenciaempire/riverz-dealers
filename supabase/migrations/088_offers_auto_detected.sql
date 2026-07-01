-- ============================================================
-- 088 — Marca de ofertas auto-detectadas (allowed_offers)
-- ============================================================
--
-- La detección de ofertas (src/lib/shopify/detect-offers.ts) rellena
-- `shopify_products.allowed_offers` automáticamente a partir del scrape de
-- la página del producto (y, más adelante, del historial de pedidos /
-- metafields). Necesitamos distinguir una fila poblada por el sistema de una
-- editada a mano para NUNCA pisar lo que el merchant ajustó:
--
--   offers_auto_detected = true  → allowed_offers lo puso la detección;
--                                  se puede refrescar/re-detectar libremente.
--   offers_auto_detected = false → el merchant guardó ofertas desde el
--                                   editor (PATCH lo baja a false); a partir
--                                   de ahí la detección respeta sus valores.
--
-- La IA ya lee allowed_offers en vivo en cada mensaje (runner.ts), así que
-- cualquier cambio — detectado o manual — queda sincronizado sin más pasos.
--
-- Additive + default false → filas existentes intactas. Idempotente.
-- Aplicar vía Management API (manual).
-- ============================================================

ALTER TABLE public.shopify_products
  ADD COLUMN IF NOT EXISTS offers_auto_detected boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.shopify_products.offers_auto_detected IS
  'True cuando allowed_offers fue auto-poblado por la detección de ofertas (scrape de página / historial de pedidos / metafields). Baja a false apenas el merchant edita las ofertas en el editor, para que la detección no pise ediciones manuales.';

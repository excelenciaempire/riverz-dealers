-- Último producto comprado por el contacto.
--
-- Para poder ramificar automatizaciones (p. ej. recompra) y personalizar
-- plantillas según el PRODUCTO que compró, no solo la oferta/unidades. El
-- webhook de pedidos lo guarda en cada compra (title del primer ítem), junto a
-- last_offer_chosen / last_offer_units (migración 084).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_product TEXT;

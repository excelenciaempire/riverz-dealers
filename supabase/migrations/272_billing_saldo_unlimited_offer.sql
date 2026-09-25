-- Acuerdo privado: mensualidad por plataforma y uso variable desde saldo.
-- La landing sólo publica los slugs contactos-* conocidos.
INSERT INTO public.billing_plans
  (slug, nombre, activo, precio_centavos, moneda, incluidas, excedente_centavos, orden)
VALUES
  ('saldo-ilimitado', 'Contactos ilimitados con saldo', true, 39900, 'usd', 0, 0, 90)
ON CONFLICT (slug) DO NOTHING;

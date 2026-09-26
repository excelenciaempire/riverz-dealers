-- Las tres tablas de cobro por contactos (268, 269 y 271) ya le niegan todo a
-- anon y authenticated con REVOKE, pero quedaron sin RLS y el linter de
-- Supabase las marca como expuestas. Se enciende como segunda barrera: el
-- service_role y las funciones SECURITY DEFINER que las usan la saltean, así
-- que nada de lo que hoy funciona cambia.
ALTER TABLE public.billing_contact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_volume_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_contact_reservations ENABLE ROW LEVEL SECURITY;

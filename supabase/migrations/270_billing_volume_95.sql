-- Avisar también justo antes de agotar el cupo, sin cambiar los avisos previos.
ALTER TABLE public.billing_volume_alerts
  DROP CONSTRAINT IF EXISTS billing_volume_alerts_threshold_check;
ALTER TABLE public.billing_volume_alerts
  ADD CONSTRAINT billing_volume_alerts_threshold_check CHECK (threshold IN (80, 95, 100));

-- A dealer listing may require calling for a price. NULL is never a zero-dollar offer.
BEGIN;
ALTER TABLE public.dealer_vehicles ALTER COLUMN price DROP NOT NULL;
COMMIT;

-- Migration 370 is already installed. Narrow only its metadata probe; do not
-- replay control tables, customer records or SECURITY DEFINER authority RPCs.
ALTER FUNCTION public.whatsapp_calling_ready() SECURITY INVOKER;

-- ============================================================
-- 064 — Fijar search_path en funciones SECURITY DEFINER
-- ============================================================
--
-- Contexto: is_workspace_member / is_workspace_admin (013), shares_workspace
-- (062) y shopify_claim_order_created (059) son SECURITY DEFINER pero NO fijan
-- `SET search_path`, a diferencia del resto del esquema (001/003/005/007/012/
-- 013:302/058) y de la recomendación de Supabase (linter 0011
-- function_search_path_mutable).
--
-- is_workspace_member / is_workspace_admin son el linchpin de casi toda la
-- RLS (decenas de policies USING(is_workspace_member(...))). Una función
-- DEFINER sin search_path resuelve nombres de objeto contra el search_path de
-- la sesión, lo que en teoría permitiría desviar la resolución hacia un objeto
-- "shadow" en un schema previo a public. Hoy NO es explotable por un tenant
-- (PostgREST fija un search_path constante para el rol `authenticated`, que no
-- tiene CREATE), pero es defensa en profundidad y consistencia con el resto.
--
-- Usamos ALTER FUNCTION ... SET (idempotente, no reescribe el cuerpo, conserva
-- OID/dependencias y no requiere recrear las policies).

ALTER FUNCTION public.is_workspace_member(uuid) SET search_path = public;
ALTER FUNCTION public.is_workspace_admin(uuid) SET search_path = public;
ALTER FUNCTION public.shares_workspace(uuid) SET search_path = public;
ALTER FUNCTION public.shopify_claim_order_created(text, bigint, text)
  SET search_path = public;

-- Defensa en profundidad adicional: en PostgreSQL 15+ ya es el default, pero
-- lo dejamos explícito para cerrar la precondición del shadow-schema (que el
-- rol PUBLIC no pueda crear objetos en `public`).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

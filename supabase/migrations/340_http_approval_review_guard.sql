-- Deployment proof reads catalog metadata only; no approvals or customer records.
CREATE FUNCTION public.http_approval_review_ready() RETURNS boolean
LANGUAGE sql SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.approval_requests'::regclass
  AND t.tgname='http_approval_review_snapshot' AND t.tgenabled='O' AND NOT t.tgisinternal
  AND t.tgfoid='public.freeze_http_approval_review()'::regprocedure)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.freeze_http_approval_review()'::regprocedure
  AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""'])
 AND NOT pg_catalog.has_function_privilege('anon','public.freeze_http_approval_review()','execute')
 AND NOT pg_catalog.has_function_privilege('authenticated','public.freeze_http_approval_review()','execute')
 AND pg_catalog.has_function_privilege('service_role','public.freeze_http_approval_review()','execute')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
  AND c.relname='http_approval_proposal_dedupe_idx' AND i.indisunique AND i.indisvalid);
$$;
REVOKE ALL ON FUNCTION public.http_approval_review_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.http_approval_review_ready() TO service_role;

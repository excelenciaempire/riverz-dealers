-- The old policy was named for service_role but actually granted INSERT to PUBLIC.
-- service_role already bypasses RLS; workspace/owner policies continue to govern users.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS "Service role can insert messages" ON public.messages;
NOTIFY pgrst, 'reload schema';
COMMIT;

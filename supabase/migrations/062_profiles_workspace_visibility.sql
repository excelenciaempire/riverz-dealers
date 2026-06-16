-- ============================================================
-- 062 — Let workspace members see each other's profile name.
--
-- profiles RLS (migration 001) only allowed "view own profile", so the
-- inbox could never resolve a teammate's name: every agent message —
-- even one a coworker sent — rendered as "Tú", and the assignee
-- dropdown could only ever list the current user. The thread now shows
-- the real author, which needs read access to teammate profiles.
--
-- We add a SELECT policy scoped through workspace_members via a
-- SECURITY DEFINER helper (mirrors is_workspace_member from 013) so the
-- subquery can't recurse into profiles' own RLS. A user can read the
-- profile of anyone who shares at least one workspace with them. The
-- existing "view own profile" policy stays (policies are OR'd).
-- ============================================================

CREATE OR REPLACE FUNCTION public.shares_workspace(target_user UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members me
    JOIN workspace_members them ON them.workspace_id = me.workspace_id
    WHERE me.user_id = auth.uid()
      AND them.user_id = target_user
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS "Members can view teammate profiles" ON profiles;
CREATE POLICY "Members can view teammate profiles" ON profiles
  FOR SELECT USING (public.shares_workspace(user_id));

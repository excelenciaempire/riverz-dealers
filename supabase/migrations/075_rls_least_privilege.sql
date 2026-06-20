-- ============================================================
-- 075 — RLS least-privilege pass
-- ============================================================
--
-- Context: the BROWSER talks to Supabase with the anon key under the
-- signed-in user's session (`@/lib/supabase/client`). Server code uses
-- either (a) the service-role admin client (`supabaseAdmin()` —
-- @/lib/{channels,flows,automations}/admin-client), which BYPASSES RLS,
-- or (b) the cookie-bound anon client (`@/lib/supabase/server`), which is
-- STILL subject to RLS (it acts AS the member). So RLS is the real
-- authorization boundary for both the browser and any server route that
-- uses the cookie client.
--
-- This migration tightens three tables to the existing good pattern
-- (member `FOR SELECT` + a service-role-only deny `FOR ALL USING(false)`
-- WITH CHECK(false)), mirroring 047_shopify_checkouts_full.sql and 052,
-- and tightens two secret-bearing tables so only admins may write them.
--
-- EVERY change below was gated on a grep of how the BROWSER / cookie
-- client actually uses the table. Tables whose member-identity (browser
-- or cookie-client) code performs INSERT/UPDATE/DELETE were LEFT ALONE
-- and documented at the bottom, because tightening them would break a
-- live member path. Helpers is_workspace_member(uuid) /
-- is_workspace_admin(uuid) come from 013_unified_inbox.sql (search_path
-- pinned in 064). Idempotent end-to-end (DROP POLICY IF EXISTS + CREATE).
--
-- ── Per-table decision summary ──────────────────────────────────────
--   ai_agents               → member SELECT + ADMIN writes   (SAFE)
--   workspace_integrations  → member SELECT + ADMIN writes    (SAFE, behavior note below)
--   automation_logs         → member SELECT + service-role writes  (SAFE)
--   flow_pending_retries    → member SELECT + service-role writes  (SAFE)
--   messages                → LEFT ALONE  (cookie client writes it)
--   instagram_campaign_recipients → LEFT ALONE  (cookie client writes it)
--   profiles                → add workspace_teammates view (no policy change)
--   channel_connections.secrets   → LEFT ALONE (documented follow-up)
-- ============================================================

-- ── Preconditions: helpers must exist (defensive no-op assertion) ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_workspace_member'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_workspace_admin'
  ) THEN
    RAISE EXCEPTION
      '075 requires is_workspace_member()/is_workspace_admin() (013_unified_inbox.sql). Apply 013 first.';
  END IF;
END $$;

-- ============================================================
-- 1. ai_agents — member SELECT, ADMIN writes
-- ============================================================
-- Before: "Members manage workspace ai_agents" FOR ALL USING
-- is_workspace_member (024_ai_agents.sql:69-72). Agents carry
-- api_key_encrypted (per-agent provider key) so writes are sensitive.
--
-- EVIDENCE (grep `.from('ai_agents')`):
--   * BROWSER (`@/lib/supabase/client`): only src/hooks/use-setup-status.ts:93
--     does `.from('ai_agents').select('id')` — READ ONLY.
--   * ALL writes go through server API routes using the SERVICE-ROLE
--     `admin` client (RLS-bypassing): src/app/api/ai/agents/route.ts,
--     src/app/api/ai/agents/[id]/route.ts:86 (`admin.from('ai_agents').update`),
--     .../sync-knowledge, .../generate-from-url, .../test — all import
--     supabaseAdmin from @/lib/channels/admin-client.
--   No member-identity (browser or cookie-client) write path exists.
-- DECISION: SAFE. Keep member SELECT; restrict writes to admins. This
-- does not even touch the service-role routes (they bypass RLS).
DROP POLICY IF EXISTS "Members manage workspace ai_agents" ON ai_agents;
DROP POLICY IF EXISTS ai_agents_select ON ai_agents;
DROP POLICY IF EXISTS ai_agents_admin_write ON ai_agents;

CREATE POLICY ai_agents_select ON ai_agents
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY ai_agents_admin_write ON ai_agents
  FOR ALL
  USING (is_workspace_admin(workspace_id))
  WITH CHECK (is_workspace_admin(workspace_id));

-- ============================================================
-- 2. workspace_integrations — member SELECT, ADMIN writes
-- ============================================================
-- Before: "Members manage integrations" FOR ALL USING is_workspace_member
-- (067_workspace_integrations.sql:31-34). Holds api_key_encrypted
-- (Klaviyo private key) — a workspace-level third-party secret.
--
-- EVIDENCE (grep `.from('workspace_integrations')`):
--   * NO browser (`@/lib/supabase/client`) usage at all. The Klaviyo UI
--     (src/components/settings/klaviyo-card.tsx) calls the API route via
--     fetch, never the table directly.
--   * src/app/api/integrations/klaviyo/route.ts uses the COOKIE client
--     (`@/lib/supabase/server`, RLS-bound as the member):
--       GET    select  (line 22)
--       POST   upsert  (line 55)   ← runs under RLS as the member
--       DELETE delete  (line 81)   ← runs under RLS as the member
--   * src/lib/instagram-agent/klaviyo-sync.ts reads via the passed-in
--     client (server worker / admin).
-- DECISION: SAFE to restrict, but note the BEHAVIOR CHANGE below.
-- Managing an org-level integration secret is reasonably an admin action,
-- and the POST/DELETE route runs under RLS, so this is enforced there.
--
-- BEHAVIOR CHANGE (intended, least-privilege): a NON-ADMIN member can no
-- longer save/replace/delete the Klaviyo key via /api/integrations/klaviyo
-- (the upsert/delete now requires is_workspace_admin). Admins — which
-- includes every personal-workspace owner, the default for each user —
-- keep full access. The Klaviyo card should ideally be admin-gated in the
-- UI as a follow-up so non-admins don't see a failing button.
-- Guarded: workspace_integrations is created by migration 067, which is NOT
-- applied in every environment (notably prod as of 2026-06-19). Skip cleanly
-- when the table is absent so this migration stays forward-compatible.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workspace_integrations'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Members manage integrations" ON workspace_integrations';
    EXECUTE 'DROP POLICY IF EXISTS workspace_integrations_select ON workspace_integrations';
    EXECUTE 'DROP POLICY IF EXISTS workspace_integrations_admin_write ON workspace_integrations';
    EXECUTE 'CREATE POLICY workspace_integrations_select ON workspace_integrations FOR SELECT USING (is_workspace_member(workspace_id))';
    EXECUTE 'CREATE POLICY workspace_integrations_admin_write ON workspace_integrations FOR ALL USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id))';
  ELSE
    RAISE NOTICE 'workspace_integrations absent; skipping (migration 067 not applied here).';
  END IF;
END $$;

-- ============================================================
-- 3. automation_logs — member SELECT, service-role-only writes
-- ============================================================
-- Before: "Members can view workspace logs" FOR ALL USING
-- is_workspace_member (013_unified_inbox.sql:287-289). The name says
-- "view" but the policy granted full CRUD to members.
--
-- EVIDENCE (grep `.from('automation_logs')`):
--   * BROWSER (`@/lib/supabase/client`): only reads —
--       src/app/(dashboard)/automatizaciones/[id]/page.tsx:190 (.select)
--       src/app/(dashboard)/automatizaciones/[id]/registros/page.tsx:48 (.select)
--   * ALL writes use the SERVICE-ROLE admin client:
--       src/lib/automations/engine.ts:224/757/771/781 (db = supabaseAdmin())
--   * Other readers also admin-only: cron/reengagement, cron/shopify-feedback,
--     analytics/attribution (all `admin.from('automation_logs').select`),
--     src/lib/dashboard/queries.ts:292 (SELECT via passed-in db).
--   No member-identity write path exists.
-- DECISION: SAFE. Member SELECT only; writes are service-role-only.
DROP POLICY IF EXISTS "Members can view workspace logs" ON automation_logs;
DROP POLICY IF EXISTS automation_logs_select ON automation_logs;
DROP POLICY IF EXISTS automation_logs_service_write ON automation_logs;

CREATE POLICY automation_logs_select ON automation_logs
  FOR SELECT USING (
    workspace_id IS NOT NULL AND is_workspace_member(workspace_id)
  );

-- Writes only via the service-role client (bypasses RLS). This explicit
-- deny closes any anon/member write path. (Mirrors 047/052.)
CREATE POLICY automation_logs_service_write ON automation_logs
  FOR ALL USING (false) WITH CHECK (false);

-- ============================================================
-- 4. flow_pending_retries — member SELECT, service-role-only writes
-- ============================================================
-- Before: "workspace members" FOR ALL USING is_workspace_member
-- (038_flow_pending_retries.sql:28-32). This is an internal runner queue.
--
-- EVIDENCE (grep `.from('flow_pending_retries')`):
--   * NO browser (`@/lib/supabase/client`) usage at all.
--   * Writes are service-role-only:
--       src/lib/flows/engine.ts:686 (scheduleSendRetry(db: AdminClient), db = supabaseAdmin())
--       src/app/api/flows/retries/cron/route.ts (admin.from(...).delete / select)
--   No member-identity read or write path exists. Member SELECT is kept
--   only for parity/observability; the table is otherwise server-internal.
-- DECISION: SAFE. Member SELECT only; writes are service-role-only.
DROP POLICY IF EXISTS "workspace members" ON flow_pending_retries;
DROP POLICY IF EXISTS flow_pending_retries_select ON flow_pending_retries;
DROP POLICY IF EXISTS flow_pending_retries_service_write ON flow_pending_retries;

CREATE POLICY flow_pending_retries_select ON flow_pending_retries
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY flow_pending_retries_service_write ON flow_pending_retries
  FOR ALL USING (false) WITH CHECK (false);

-- ============================================================
-- 5. profiles — add a teammate-safe view (NO policy change)
-- ============================================================
-- Finding: "Members can view teammate profiles" (062:28-30) exposes the
-- FULL profiles row — including email — to anyone sharing a workspace.
--
-- We DO NOT touch that policy: the inbox selects from `profiles` directly
-- via the browser client to resolve author/assignee names, and removing
-- it would break name resolution (see 062's rationale). Instead we add a
-- minimal view exposing only (user_id, full_name, avatar_url), scoped to
-- shared-workspace members, as the migration target for the client. A
-- future client change should switch teammate-name reads to this view; a
-- LATER migration can then narrow the profiles policy to "own row only".
--
-- security_invoker=on makes the view run under the CALLER's privileges so
-- the underlying profiles RLS still applies (the view does not widen
-- access; it only narrows the COLUMNS). PG15+.
DROP VIEW IF EXISTS public.workspace_teammates;
CREATE VIEW public.workspace_teammates
  WITH (security_invoker = on) AS
  SELECT p.user_id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE public.shares_workspace(p.user_id);

COMMENT ON VIEW public.workspace_teammates IS
  'Minimal, email-free teammate directory (user_id, full_name, avatar_url) scoped to shared-workspace members via shares_workspace(). MIGRATION TARGET: the browser client currently selects from `profiles` directly (exposes email) to resolve author/assignee names — switch those reads to this view, then a follow-up migration can narrow the profiles "Members can view teammate profiles" policy (062) to own-row-only.';

GRANT SELECT ON public.workspace_teammates TO authenticated;

-- ============================================================
-- 6. channel_connections.secrets — DELIBERATELY UNCHANGED (follow-up)
-- ============================================================
-- channel_connections.secrets (and webhook_secret) hold AES-GCM
-- ciphertext. Today members can SELECT the whole row including these
-- columns ("Members can view connections", 013:201-202). Column-level
-- least-privilege here needs a COORDINATED client change first: several
-- browser/cookie-client reads do `.select('*')` on channel_connections
-- (e.g. use-active-connections, channels-panel, settings). A blunt
-- column REVOKE or a secrets-omitting view would break those `select('*')`
-- calls until the client is updated to request explicit non-secret
-- columns. Recommended follow-up (NOT done here, to stay non-breaking):
--   1. Change all browser/cookie-client reads to select explicit columns
--      (omit secrets, webhook_secret).
--   2. Then either:
--      a. REVOKE SELECT (secrets, webhook_secret) ON channel_connections
--         FROM authenticated;  (column-level grant; RLS still applies), OR
--      b. expose a `channel_connections_public` view without the secret
--         columns and point the client at it.
-- The ciphertext is already encrypted at rest, so exposure risk is
-- mitigated, but stripping the columns from the anon surface is the
-- correct least-privilege end state.

-- ============================================================
-- LEFT ALONE — would break a live member-identity write path
-- ============================================================
-- messages: NOT restricted. Although the browser only READS messages
--   (src/components/inbox/message-thread.tsx:324/768 are .select), the
--   TEMPLATE send path posts to /api/whatsapp/send/route.ts, which inserts
--   into `messages` using the COOKIE client (`@/lib/supabase/server`,
--   RLS-bound as the member) at lines 258-260 — and also writes contacts
--   at 248-251. message-thread.tsx:595 calls that route from the browser.
--   Restricting messages to service-role writes would break template
--   sends for every member. The existing "Members can view workspace
--   messages" FOR ALL policy (013:266-273) is intentionally kept.
--
-- instagram_campaign_recipients: NOT restricted. The campaign LAUNCH
--   route (src/app/api/ai/instagram-agent/campaigns/[id]/launch/route.ts)
--   calls resolveAudience(supabase, ...) with the COOKIE client, which
--   UPSERTS recipients under RLS as the member
--   (src/lib/instagram-agent/resolve-audience.ts:59-65). The campaign
--   detail GET also SELECTs recipients via the cookie client. Restricting
--   writes to service-role would break campaign launch for every member.
--   The existing "Members manage ig recipients" FOR ALL policy
--   (066:128-143) is intentionally kept.

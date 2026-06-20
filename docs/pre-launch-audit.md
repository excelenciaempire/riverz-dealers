# Pre-launch production audit (2026-06-19)

Multi-agent audit of the Riverz CRM before market launch. 14 confirmed findings
(each verified against the code by a second adversarial pass). `[x]` done,
`[~]` partial, `[ ]` open. Most are now fixed + deployed.

## HIGH

- [x] **Anthropic client had no timeout/retry cap.** SDK defaults (10-min
  timeout, 2 retries, timeouts retried) on the fire-and-forget webhook reply
  runner → under provider degradation each message could hold a task open for
  minutes and fan out unbounded. Fixed: `src/lib/ai/anthropic-client.ts`
  `getAnthropic()` (45s, 1 retry); migrated **all 13 call sites** (runner, tools
  loop, summarize ×2, segment, lead-scoring, personalize-dm, realtime, ai-intent,
  and the 5 API routes). Optional later: in-process concurrency cap on runAiAgent.
- [x] **AI checkout tool hardcoded to Pilar's economics for every tenant.** Gated
  `CREATE_CHECKOUT_TOOL` behind `PILAR_SHOP_DOMAINS`; other tenants keep the
  generic order-lookup. **Follow-up (feature):** per-workspace offers/prices/
  currency/variant so the AI can sell correctly for any merchant — needs a
  decision on where offers live (derive from shopify_products or a new table).

## MEDIUM

- [x] **ai_agents / workspace_integrations api_key writes** → migration 075:
  member SELECT kept, INSERT/UPDATE/DELETE restricted to `is_workspace_admin`.
  Applied to prod for ai_agents. workspace_integrations is guarded (its table
  isn't in prod — see the 067 note below) and will apply once 067 is.
- [~] **channel_connections.secrets readable by members.** Left unchanged on
  purpose: needs a coordinated client change (several `.select('*')` reads) before
  a column REVOKE / secrets-omitting view, or it would break the UI. Recommended
  steps documented in migration 075.
- [x] **Outlook webhook fail-open.** Now fails closed: drops notifications unless
  OUTLOOK_PUSH_CLIENT_STATE is set and matches (subscriptions already set it).
- [x] **transcribe (Groq/media) fetch had no timeout.** `AbortSignal.timeout(15s)`
  on both fetches; graceful fallback now fires on a hung provider/CDN.
- [ ] **Workspace provisioning depends on an error-swallowing trigger.** Open
  (recommended follow-up). Low probability (trigger body is trivial/robust) but
  no self-recovery if it ever fails. Fix: idempotent app-level workspace bootstrap
  on first authenticated load + make the trigger failure observable.

## LOW

- [x] PUBLIC `WITH CHECK (true)` write policies — already remediated in 056.
- [x] Audit/log tables `FOR ALL` member: `automation_logs`, `flow_pending_retries`
  → migration 075 (member SELECT + service-role-only writes). `messages` and
  `instagram_campaign_recipients` LEFT ALONE — members legitimately write them via
  the RLS-bound cookie client (template sends, campaign launch); restricting would
  break those. Documented in 075.
- [~] `profiles` exposes teammate email. Migration 075 adds the
  `workspace_teammates` view (id/name/avatar only). Follow-up: switch the inbox's
  profile reads to the view, then a later migration narrows the profiles policy.
- [~] Encrypted secret columns member-readable — same root as channel_connections;
  ciphertext only (key server-side). Same documented follow-up.
- [ ] `ENCRYPTION_KEY` reused for AES + HMAC OAuth-state. Open (deferred): no known
  attack; changing it must coordinate two subsystems / could invalidate in-flight
  OAuth states. Fix later via HKDF subkeys or a dedicated OAUTH_STATE_SECRET.
- [x] inbox-writer idempotency comment corrected.
- [x] `runWithTools` final call wrapped in try/catch → routes to the human-handoff
  fallback instead of replying nothing.

## Separate gap found while applying 075

**`workspace_integrations` table does not exist in prod** — migration 067 was
never applied. The Klaviyo integration (save/read the private key) is non-functional
until 067 is applied via the Supabase Management API. Worth applying 067 (and
auditing which other migrations are unapplied) before relying on Klaviyo.

Full per-finding evidence + adversarial verdicts: workflow run `wf_75edd334-a84`.

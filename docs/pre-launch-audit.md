# Pre-launch production audit (2026-06-19)

Multi-agent audit of the Riverz CRM before market launch. 14 confirmed findings
(each verified against the code by a second adversarial pass). Ordered by severity.
`[x]` = fixed, `[ ]` = open.

## HIGH

- [x] **Anthropic client had no timeout/retry cap on the bot path.** SDK defaults
  (10-min timeout, 2 retries, timeouts retried) on the fire-and-forget webhook
  reply runner → under provider degradation (429/529/no-credits) each message
  could hold a task open for minutes and fan out unbounded on a memory-constrained
  service. Fixed: `src/lib/ai/anthropic-client.ts` `getAnthropic()` (45s, 1 retry);
  `runner.ts` migrated. **Remaining:** migrate the other 12 `new Anthropic()` sites
  to the factory (segment, summarize ×2, lead-scoring, personalize-dm, realtime,
  ai-intent, and the 5 API routes). Optional: add an in-process concurrency cap on
  `runAiAgent`.

- [x] **AI checkout tool hardcoded to Pilar's economics for every tenant.**
  `CREATE_CHECKOUT_TOOL` (ARS prices, Mercado Pago, $4.900 transfer discount,
  Pilar variant) was offered to every Shopify-connected workspace → a new
  merchant's agent would quote Pilar's prices/currency to its customers. Fixed:
  gated behind `PILAR_SHOP_DOMAINS` in `runner.ts`; others keep order-lookup only.
  **Proper fix (later):** make offers/prices/currency/variant per-workspace.

## MEDIUM (open)

- [ ] **channel_connections.secrets readable by any member (incl. agent role).**
  RLS SELECT uses `is_workspace_member`, not admin; the browser reads `select("*")`
  which includes encrypted token ciphertext. `013_unified_inbox.sql:201`. Fix:
  restrict secret columns to admin / expose a secrets-omitting view; change the
  client read to drop secret columns. (No plaintext leak — ciphertext only.)
- [ ] **ai_agents / workspace_integrations `api_key_encrypted` member read+WRITE.**
  `FOR ALL` with member (not admin) check → an agent can read encrypted provider
  keys and tamper/delete agent + integration config. `024_ai_agents.sql:69`,
  `067_workspace_integrations.sql:31`. Fix: gate INSERT/UPDATE/DELETE on admin.
- [ ] **Outlook webhook unauthenticated + fails open.** `verifyChannelWebhook`
  returns ok for outlook; the only check (clientState) is skipped if unset or
  omitted. Forged notifications can drive Graph calls on the tenant token + trigger
  the auto-responder. Fix: fail closed (require OUTLOOK_PUSH_CLIENT_STATE + matching
  clientState). `verify-webhook.ts:82`, `outlook/adapter.ts:155`.
- [ ] **transcribe (Groq/media) fetch has no timeout.** A hung Groq endpoint or
  slow media CDN stalls the bot reply for voice notes (graceful fallback can't
  fire). Fix: `signal: AbortSignal.timeout(15_000)` on both fetches in
  `src/lib/ai/transcribe.ts:79,108`.
- [ ] **Workspace provisioning depends on an error-swallowing DB trigger.** If the
  signup trigger ever fails, the merchant is logged in with no workspace and no
  self-recovery (can't create products/connect channels). Low probability, high
  impact. Fix: idempotent app-level bootstrap on first authenticated load + make
  the trigger failure observable. `013_unified_inbox.sql:298`.

## LOW (open unless noted)

- [x] PUBLIC/`WITH CHECK (true)` RLS write policies — already remediated in
  `056_prod_hardening_pass.sql`. Action: confirm 056 is applied in all envs.
- [ ] Audit/log + campaign tables (`automation_logs`, `flow_pending_retries`,
  `instagram_campaign_recipients`, `messages`) use `FOR ALL` member policies → a
  member can forge/delete those rows in their workspace. Fix: split into member
  SELECT + service-role-only write (matches the shopify_checkouts pattern).
- [ ] `profiles` policy exposes every teammate's email to co-members (only the name
  is needed). `062:28`. Fix: expose id/name/avatar via a view; keep profiles SELECT
  to self.
- [ ] Encrypted secret columns SELECTable by members (defense-in-depth; same root
  as the channel_connections finding) — ciphertext only, key is server-side.
- [ ] `ENCRYPTION_KEY` reused for AES-256-GCM token encryption AND HMAC OAuth-state
  signing. No known attack; hygiene. Fix: HKDF subkeys or a dedicated
  `OAUTH_STATE_SECRET`. `oauth.ts:22`.
- [ ] inbox-writer idempotency comment is misleading (dedup is on
  (conversation_id, message_id), not a global message_id unique). Doc-only fix to
  prevent a future regression. `inbox-writer.ts:24`.
- [ ] `runWithTools` post-loop final `messages.create` has no try/catch → on loop
  exhaustion + a provider error the customer gets no reply and no handoff. Fix:
  wrap it like the in-loop call so the truncated-fallback fires. `tools.ts:289`.

Full per-finding evidence + adversarial verdicts: workflow run `wf_75edd334-a84`.

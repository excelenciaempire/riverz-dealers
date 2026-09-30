# Monthly payment grace, reminders and recovery

Migrations 306 and 308 must be applied before deployment. `check-billing-recovery-schema.cjs`
checks the receipt column, private queues and database write gate during Render builds.
It also installs the same guard on newly introduced tenant tables under a database
advisory lock. The installer is service-role only and preserves existing read access.

The first confirmed unpaid monthly invoice establishes a stable 24-hour deadline.
Partial payment does not clear a remaining debt. Prepaid wallet credit does not
replace the monthly subscription payment. Restrictive authenticated policies and
write triggers protect existing tenant tables and SECURITY DEFINER mutations;
Storage writes are also protected. SELECT stays open. Service-role receipt
ingestion, native app echoes, financial webhooks and reconciliation continue.
API mutations, MCP workspace mutations and channel sends share the billing gate.
The composer switches to a payment link; billing checkout remains accessible.

`billing-recovery` runs every minute. Notifications have five phases: pending,
6-hour reminder, 1-hour reminder, read-only, and account up to date. Each phase
is unique per invoice, recipient and channel. WhatsApp uses the platform's
approved template. Emails reach the owner and distinct Stripe billing email.
Every send checks current Stripe invoice state and the deadline again. Stale
phases are cancelled, rather than sent in a burst after downtime. Failed
channels retry independently. Database leases prevent concurrent dispatch;
provider acceptance is recorded, not represented as confirmed delivery.
WhatsApp has at-least-once delivery if acceptance succeeds but acknowledgement
cannot be persisted. Email has a stable provider idempotency key.

Live, answerable customer messages received after grace expiration are queued
atomically with receipt insertion. Historical imports, native outbound replies,
opt-out keywords and suppressed backfills do not create recovery work.
The recovery worker waits one minute after first verified payment for late
native echoes and leases one task per conversation. Repeated invoice
reconciliation does not restart that settling wait. It imports Meta DM history,
native comment replies, WhatsApp coexistence echoes and email sent-folder
history before deciding whether a reply is needed. Incomplete history retries;
persistently unverifiable history is flagged in the inbox for human review.
WhatsApp coexistence requires verified app and WABA echo subscriptions.

Already answered messages are skipped. DM bursts use the latest queued inbound
and full conversation context. A newer live inbound owns its own response.
Comment replies match their actual parent comment. Native/manual replies
arriving during model execution are checked again at the outbound boundary.
Recovery uses the existing AI/comment engines, settings, balances and channel
windows; it does not replay orders, campaigns or other original event side effects.
Closed/deleted conversations, human ownership, deliberately disabled AI and a
manually stopped motor remain unchanged. Window expiry, missing prepaid credit,
approval-required agents and uncertain outbound delivery stay available for
human review instead of forcing an automatic send.

Platform Anthropic balance below US$3 uses the existing independent WhatsApp
and email administrator outbox. This is an estimate from a manually confirmed
balance minus recorded platform consumption, not a live balance API.

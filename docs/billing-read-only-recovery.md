# Monthly payment grace, reminders and recovery

Migrations 306, 308 and 309 must be applied before deployment. `check-billing-recovery-schema.cjs`
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

Live, answerable customer messages received while monthly payment is pending
are queued atomically with receipt insertion, including grace to protect AI
turns that cross the exact deadline. Claims wait until every due monthly debt
has cleared, so recovery cannot overlap normal grace-period replies.
Historical imports, native outbound replies,
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

## Per-merchant pricing administration

Migration 315 adds a 24–720-hour payment grace policy, shared by invoice persistence,
legacy subscription access, database write guards, banners and notifications.
Changing it recalculates current unpaid invoices from their original due time;
paid/void invoice history and debt amounts are preserved. Six-hour and one-hour
reminders have a unique deadline key, so extending grace cancels old deadlines
and permits reminders for the new deadline without reporting a payment.
The new worker activates deadline uniqueness after the rolling deployment.

The merchant editor in `/admin/negocio?tab=cuentas` keeps billing changes separate
from grace changes. Stripe approves the agreement before local publication;
an exclusive per-merchant lease rejects overlapping admin updates. Webhooks
retrieve current Stripe state and reconcile admin-managed flat-rate mode/prices.
Active scheduled agreements and Shopify charges require their own approved flow;
the ordinary editor cannot silently overwrite them. Existing unpaid invoices,
wallet funds, cards and AI settings remain independent of mode changes.
Leaving balance mode clears automatic recharge inside the same database transaction.

Wallet adjustments are available only in balance mode. Additions are administrative
credit, not a claim that a Stripe payment was received. Deductions require a reason,
cannot remove funds reserved for active operations, and cannot create a negative
available balance. A UUID makes retries idempotent. The append-only movement and
admin audit commit together. These adjustments do not refund or charge a card.
Legacy cost/block switches are no longer shown: prepaid usage always requires
available funds and uses actual provider cost, as enforced by the billing engine.
Provider operations snapshot whether the wallet paid at reservation; settlements
and late receipts preserve that payer even after a mode change. BYOK never falls
back to the platform key when the billing model cannot be verified.

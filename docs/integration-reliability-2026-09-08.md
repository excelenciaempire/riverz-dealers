# Integration reliability review — 2026-09-08

## Scope and evidence

Read the channel registry, polling and recovery paths, store connection registry,
production connection state, and the latest completed execution of all 52 scheduled
jobs. Ran the integration-related regression suites. This is not an assertion that
every external API endpoint or every customer workflow has been exercised.

Production snapshot: 47 scheduled jobs last completed successfully; five failed.
All five failures belong to Mercado Libre: questions/messages, orders, catalog,
reviews and claims. The provider explicitly reports an inactive user on questions
and reviews; the other routes return HTTP 403. Account reactivation is required;
other permission issues may become visible afterward.

## Verified incident and corrections

- TikTok had status `error`, no last error, and successful subsequent polls. A direct
  authenticated video-list request returned HTTP 200 / provider code 0. Restored
  only this inconsistent status using a conditional update against the inspected
  configuration. No comments or customer messages were sent.
- Successful polls now restore connection health in TikTok, Gmail, Outlook and
  Zoho. Previously clearing the error text did not restore status.
- Shared poll-state persistence merges into the current configuration with
  compare-and-swap retries. It no longer overwrites a token expiry or webhook
  setting from an old pre-poll snapshot. Database write failures are visible.
- A disconnected or pending account is not reactivated by poll-state persistence.
- Concurrent TikTok token renewals within one process share a promise. Failure to
  persist refreshed credentials is surfaced. This is not a distributed token lock.
- TikTok reads have 20-second timeouts; token refresh 30 seconds; webhook
  registration 20 seconds. Malformed read responses no longer count as empty,
  successful API results. Existing scheduler recovery remains in place.

## Integration coverage and limitations

| Integration | Evidence in this review |
| --- | --- |
| WhatsApp | Active connection state, channel tests, delivery watchdog; no real outbound send |
| Instagram DM and comments | Active state, Meta/comment regression tests, synchronization jobs |
| Facebook Messenger and comments | Active state, multi-account and Meta tests, synchronization jobs |
| TikTok comments | Direct provider read, production status repair, polling and token fixes |
| Outlook | Active state, successful polling job, shared state repair |
| Gmail and Zoho | Poll code and shared repair; no active account available in the snapshot |
| Mercado Libre | Production errors and tests for questions, messages, orders, catalog, reviews, claims; account blocked externally |
| Shopify | Three active store rows, successful token refresh and recovery jobs, commerce tests |
| Tiendanube | Two active store rows, checkout job and commerce tests |
| WooCommerce | Commerce code/tests; no connected store available for live verification |
| Webchat | Active rows and channel tests; no live chat sent |
| Voice | Active connection and successful worker/call jobs; no phone call placed |
| Klaviyo and Dropi | Integration regression tests; a successful cron alone does not prove configured credentials |
| Mercado Pago | Synchronization/recovery job results and available regression tests; no payment charged |
| Billing/wallet | Billing tests and scheduled job state; no charge or refund issued |
| Instagram enrichment / Apify | Latest enrichment job successful; not a separate credential/quota certification |
| Meta Ads / Pixel | Ads synchronization and retry job results; no ad or conversion event published |
| AI, email delivery, transcription and other infrastructure providers | Only indirect job/test coverage in this pass; not independently certified end to end |

## Reproducible checks

`node --env-file=.env.local --import tsx scripts/audit-integration-health.ts`

This read-only audit paginates connection inventories and queries the latest
completed run separately per job so frequent jobs cannot hide infrequent ones.
It emits no credentials or customer message bodies. An `ok` run may have had no
configured accounts to process; use the connection inventory alongside it.

Regression coverage: channel, commerce, cron, health, Shopify, integration,
billing, Mercado Pago and webhook test directories; targeted poll-state and
TikTok renewal tests. A pre-existing source assertion was updated from two to
three Mercado Libre connection filters after confirming all three are scoped.

No system can guarantee permanent availability of external providers. Revoked
permissions, inactive accounts and depleted provider balances require external
action. Full end-to-end certification of every integration remains outside the
evidence collected here, especially those without a connected account.

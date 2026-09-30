# Admin funding and Pilar renewal — 2026-09-29

The admin home and provider page show merchant wallet balances, recorded
daily consumption, and independent recommended top-ups for 7, 14 or 30 days.
By default, the Anthropic funding goal equals the current USD wallet balance
across every merchant, including reserved balances. The displayed deficit is
that outstanding balance minus the current Anthropic balance; the suggested
top-up rounds up to whole dollars. Historical deposits already spent are not
counted, foreign currencies are not converted, and balances in other providers
never offset Anthropic. The 7/14/30-day forecasts remain separate selectable goals.
Merchant totals refresh every 10 seconds while visible. Free provider probes
are shared for 55 seconds; no model generations are triggered by this panel.

Recommendations use each provider's recent seven-day cost and a minimum reserve.
Money in one provider cannot cover another provider. Quotas, credits and foreign
currencies are not converted into USD. Unknown amounts are excluded from the
partial total and remain visible. Costs without a matching provider are named
as unallocated. Provider subscriptions and external usage are excluded.

Anthropic and other providers without a public balance API require a balance
confirmed from their console. Subsequent recorded Riverz usage is deducted;
the result is explicitly estimated and expires after 24 hours. Observations
are bound to the active credential digest, so rotating a key invalidates them.
Admin authentication, CSRF, rate limiting and audit protect confirmations.
Migration 301 keeps financial observations and its aggregate RPC private to
the service role. No merchant wallet entries are changed.

Migration 302 adds an explicitly confirmed billing method for providers without
a balance endpoint. Automatically billed plans retain their recorded consumption
but never display a fictitious cash balance or recommend a prepaid top-up. This
setting remains tied to the same active credential, and does not clear billing
failures. It must be confirmed by the administrator; a working model catalog
does not prove the account's billing plan. Known character and credit quotas do
not inflate the count of providers with unconfirmed monetary balances.

Pilar's agreement is USD 99 for the first three months, then USD 399. Its
September renewal incorrectly totaled zero: a USD 300 pilot coupon was still
applied after its base monthly price changed from USD 399 to USD 99.

The subscription now uses an explicit fixed-price schedule, with no discounts:

- August 29: USD 99, previously paid.
- September 29: USD 99 correction invoice `in_1ULBhbL0pSUS73AdZcyAFiip`.
- October 29: USD 99, verified with Stripe's upcoming invoice preview.
- November 29 onward: USD 399. The schedule releases after December 29,
  retaining that monthly price.

On September 30, the owner waived September's USD 99 correction by agreement.
The admin's **Mark as paid → Waive by agreement** action was used in production.
Credit note `cn_1ULVyYL0pSUS73AdAtAN2n2I` settled the invoice to **paid**, with
zero remaining debt and USD 99 credited. No card payment or revenue was invented:
`amount_paid` remains zero. The actor and reason are recorded in Stripe and the
admin audit log. No customer email was sent by the settlement action.

Pilar remains active, with the same plan, balance billing model, USD 22.55 wallet
balance, motor and suspension settings, and renewal schedule. The October 29
preview still totals USD 99; November 29 onward remains USD 399. The database
write and payment-recovery gates both confirmed access, with no pending invoice.
The original Link authorization was closed; the bank had rejected the earlier
corrective payment (`card_declined`, `reenter_transaction`). The saved card is
still configured for subsequent renewals.
The correction uses stable idempotency keys and never creates a second invoice
on a repeated run. The original zero-dollar invoice remains unchanged.

`scripts/reconcile-pilar-billing.mjs` defaults to dry-run. `--apply` reconciles
the reviewed schedule and correction, checking the account, amount and next
invoice before requesting collection. It requires `STRIPE_SECRET_KEY` through
the environment. A fresh payment authorization is required to collect the
unpaid invoice; no merchant message was sent. The September correction has now
been waived: do not rerun this historical collection script to collect it.

Managed fixed-price schedule events update the agreed amount in Riverz when
the USD 99 phase advances to USD 399. Ordinary negotiated subscriptions retain
their existing overrides.

The admin settlement action applies to one displayed pending invoice, with its
confirmed amount and currency. It supports external payments (`paid_out_of_band`)
and agreements (a full pre-payment credit note), requires an audit reason, checks
workspace/customer/subscription ownership against Stripe, and holds the account's
existing billing lease. A successful retry reconciles the already-paid invoice
without a second credit or payment. Plan, future prices, schedule, wallet and AI
settings are not edited. CSRF, admin authentication and rate limiting protect
the route. Verification: 106 tests, scoped TypeScript, ESLint, production build,
and the real production button returning HTTP 200.

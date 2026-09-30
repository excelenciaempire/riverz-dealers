# Monthly payment reminder and 24-hour AI grace

An unpaid Stripe monthly invoice displays a bilingual reminder at the top of Riverz, linked directly to its Stripe hosted invoice. Automatic collection gets 24 hours from finalization; send-invoice agreements get 24 hours after the agreed due date. The original deadline survives retries. Positive prepaid credit, BYOK, pilots and AI tests cannot override overdue monthly debt.

At the exact deadline the shared AI gate stops new AI work. Voice context, model, speech and tools also check monthly debt, including queued and ongoing calls. Manual dashboard access and the merchant wallet remain available; agent settings are never disabled or rewritten.

Signed invoice events read the authoritative Stripe invoice, persist its current remaining amount, and refresh the subscription. Paying clears that invoice automatically; another unpaid invoice still prevents access. The five-minute wallet reconciliation job repairs missed payment/failure events. Paid/voided invoices cannot be reopened by delayed or concurrent failure events.

Private `workspace_billing_invoices` storage and its write RPC are accessible only to the service role (migration 305). Workspace resolution validates both the managed subscription and Stripe customer. Zero-value invoices, wallet deposits and voluntary capacity upgrades never suspend monthly access. Stand-alone `riverz_subscription_correction` invoices are included, covering Pilar's September US$99 correction.

The persistent dashboard polls every ten seconds while a payment is pending, refreshes its banner after payment, and schedules a refresh at the grace deadline. Expired trials, cancelled subscriptions and missing wallet credit retain their existing rules; paying a monthly invoice does not override independent restrictions.

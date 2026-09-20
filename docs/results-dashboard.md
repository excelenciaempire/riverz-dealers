# Results dashboard

The same dashboard is enabled for all accounts, independently of billing mode and the Riverz 2 feature flag. Existing pricing and trial dates are not modified.

## What counts

- **Handled case:** a conversation containing a customer message and a successfully sent AI message (`ai_agent`, `ai_followup`, `comment_ai`, or `voice_agent`). The reporting cohort contains conversations with a successful AI reply or merchant verification in the selected `[start, end)` window.
- **Verified resolution:** a merchant explicitly reviews the conversation, selects a case category, and confirms the result. The stored message snapshot must still be the latest message. Any human reply in the thread or current human escalation disqualifies autonomous resolution. Closing a conversation, assignment state, silence and CSAT alone are not proof.
- **Resolution rate:** verified resolutions divided by handled cases, including unverified and human-assisted cases. The denominator is displayed. Empty cohorts show no percentage.
- **Needs a person:** currently open, explicitly escalated conversations across all dates. This is a live backlog, not a period total.
- **Sales assisted with evidence:** paid, non-cancelled orders with a direct Riverz marker, using the existing attribution model. Subsequent purchases with only temporal association remain separate. Neither figure claims incremental revenue. Unknown payment states, unpaid orders and refunds are excluded. Multiple currencies are never added together; the dashboard displays an unavailable-total explanation instead.

Results show the **current evidence state**, not an immutable historical snapshot. New messages invalidate a verification until reviewed again. One conversation contributes at most one resolution and one category. Reviewers can remove a verification. A manual review does not send a message, close the conversation, change billing, or certify that a commercial guarantee has been met.

## Data and synchronization

Migration `265_dashboard_outcomes.sql` adds workspace-scoped evidence storage. Authenticated workspace members can read their records; writes are restricted to the authenticated, CSRF-protected server endpoint. The server resolves workspace/reviewer identity and validates the latest message and human involvement before saving. The deployment schema guard prevents promotion before this migration exists.

Dashboard, operator metrics and webchat statistics share `readOutcomes`. All history queries are paginated and scoped to owned conversations; human replies outside the reporting window still count. Realtime updates are throttled for analytics, visible tabs refresh each minute, and review submissions refresh immediately. Filter changes discard previous results; failures are not displayed as zero.

The trial banner displays the subscription's configured end date and results for the selected period. It does not invent a seven-day trial, readiness date or automatic billing authorization.

## Verification

Unit tests cover evidence invalidation, human intervention, failed/non-AI messages, empty denominators and paid-sales filtering. Route tests cover authentication, CSRF, workspace isolation and stale snapshots. PostgreSQL tests exercise migration retries, RLS and write restrictions. Synthetic UI fixtures cover Spanish, English, mobile, trial, empty and failed-load states without modifying real customer conversations.

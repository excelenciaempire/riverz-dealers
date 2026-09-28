# Context and inbox verification — 2026-09-28

## Corrected behavior

- Comment-triggered private replies respect the private conversation's AI switch, assignment, escalation and closed state. Guards run before generation and again before sending, including queued campaigns.
- Comment decisions receive recent private support history. Each turn's publication comes from that comment's metadata, not the first post of a grouped thread.
- Newly recorded comment-to-private replies link to the exact source message. The inbox displays publication context and reciprocal navigation where the association is known; it does not guess historical associations.
- Escalation stays internal. Replies speak in the store's first person without claiming a refund, payment, action or deadline that was not verified. Payment choices are concise; bank details follow the requested choice. Colombian conversations avoid Mexican regional expressions.
- Inbox previews resist out-of-order realtime updates and include the latest visible message.
- Existing self-heal reconciles old attention alerts conservatively. Manual resolution evidence or explicitly completed AI actions followed by acknowledgements can clear an alert; automation messages and new unresolved requests cannot.
- Recoverable Meta attachments can be fetched using the exact original message and repaired in place. Unavailable/ephemeral content is not fabricated. Recovery does not send replies or invoke AI.
- Operational wallet totals exclude identifiable public-thread mirrors of private sends. Model charges, delivered bubbles and distinct channel contact records remain separate quantities.

## Production data verified before publication

- Revitaly: active balance-based subscription and active assistants.
- All 23 registered Meta templates were approved. The 21 PDF-version bodies matched the preserved source transcription. All templates were referenced by active automations; no obsolete template was deleted. No remaining test sessions required deletion.
- Original PDF files were unavailable at their supplied local paths; this check is against the preserved transcription and live Meta components, not a new visual audit of the originals.
- Revitaly email policy: redirect customer inquiries to WhatsApp, filter notifications and prevent repeated redirects. Shared email policy supports Gmail, Outlook/Hotmail and Zoho and remains configurable.
- Transfer guidance retains the authorized 10% discount, eligible Shopify coupons and supplied banking details. Four contradictory handoff rules were corrected with compare-and-set writes; two merchant-specific contextual guidance rules were added without replacing unrelated rules.
- An earlier repair cleared 233 Pilar alerts. A subsequent all-workspace scan checked 219 remaining alerts, cleared 2 supported by evidence and retained 217. No customer messages were sent by these repairs. Unresolved Rasmiaw and Revitaly claims remain escalated.
- Revitaly wallet snapshot at 17:56 UTC: USD 25.00 credit minus USD 13.71 consumption equals USD 11.29. There were 255 consumption entries, including 178 response-generation charges. These are not message-delivery counts. Historical entries without channel metadata were retained as unattributed rather than assigned by inference.
- Today's shared attribution calculation reported one paid order after conversation worth ARS 71,990, with zero directly attributed orders. Store totals were 26 orders / ARS 1,776,660; these must not be presented as Riverz-attributed sales. This is a timestamped snapshot, not a fixed dashboard value.

## Verification boundaries

Local tests cover billing models, email policy, template fallback/status, attribution, attention, context guards, previews and media recovery. Type checking and scoped linting are required before push. Deployment is verified through the production health revision afterward.

An active subscription row was verified; no independent Stripe API reconciliation was performed without a locally available Stripe credential. Media withheld by channel APIs and historical charges lacking attribution cannot be represented as recovered or precisely classified.

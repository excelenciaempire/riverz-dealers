# Platform credit notifications

`platform-watch` runs every 15 minutes. Its recipients are the administrator's
technical alert phone/email, never a merchant's contact or API phone line.

- Providers exposing balances use the existing low-credit thresholds: Telnyx
  USD 10, Fish USD 5, Deepgram USD 15, ElevenLabs 5,000 remaining characters.
- Empty credit and low credit have different incident keys; depletion is
  announced even if a low-credit warning was already sent.
- Groq/OpenAI-compatible billing refusals (`402`, `blocked_api_access`,
  `insufficient_quota`) are distinguished from ordinary rate limits.
- Real paid platform calls record sanitized credit signals for providers whose
  free model catalogs cannot prove credit availability. Only a SHA-256 credential
  digest is retained. BYOK Anthropic calls are excluded; matching the active
  platform credential prevents an obsolete key's refusal from alarming Riverz.
- A missing monetary balance stays unknown. A successful probe, token quota,
  historical spending, or successful transcription is not a dollar balance.

Notifications are saved before sending. WhatsApp and email are acknowledged
separately. Failures remain queued with 15-minute to 4-hour backoff, including
when the incident fingerprint has not changed. Recovered incidents cancel
obsolete unsent warnings. A database lease prevents overlapping monitors;
after a crash the lease expires in 10 minutes and the durable queue survives.
WhatsApp alerts require the configured template, not the 24-hour text window.

Delivery is at-least-once: if Meta accepts a message but the acknowledgement
cannot be persisted, a later retry can duplicate an owner alert. It cannot
duplicate merchant payments, responses, or wallet charges.

`POST /api/admin/whatsapp/test` is admin/CSRF protected and rate limited. It
sends a fixed test only to the configured administrator and records the Meta
message ID in the admin audit. API acceptance is not proof of phone delivery;
confirm the corresponding Meta delivery receipt before claiming delivery.

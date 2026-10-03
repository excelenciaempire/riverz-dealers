# Riverz Dealers — Growth configuration

Open **Dealer → Settings** (`/concesionario?view=settings`, English `/dealer?view=settings`). Owners and workspace administrators can save configuration. Other members can read it. Concurrent edits use a version check.

## Controls

- Business: seller identity, timezone, location, map and visit video.
- Lead intake: capture switch, signed webhook switch, default seller/source, response target and follow-up delay.
- Inventory: authorized HTTPS JSON/CSV feed, encrypted optional bearer token, interval, freshness, minimum snapshot size, field mapping and explicit status/retirement rules. Upload preview does not change inventory. Automatic sync is off by default.
- Appointments: working days/hours, duration, notice, horizon, reminder, link expiry, rescheduling and seller confirmation. Buyer confirmation means attendance; it does not approve a seller's pending appointment.
- Follow-up: global switch, sending days/hours and post-visit/no-show delay. Deferred jobs check customer reply, opt-out, availability, appointment and opportunity state again before sending.
- Coach: switch, output language, tone, instructions and practice objections. Briefs, transcript reviews and practice provide seller advice. They do not send messages or approve financing. Pasted transcripts require permission confirmation.
- Metrics: cohort period, contact/show/close targets and lost reasons. Actual outbound delivery and subsequent buyer reply are separate evidence. Attendance requires a recorded completed/no-show outcome.
- Pipeline: editable stage names in Spanish and English; stage identities retain consistent commercial behavior.

## External lead connector

Generate a workspace key in Settings, enable the webhook and configure your authorized form/advertising connector:

```http
POST /api/dealers/leads/<workspace UUID>
Authorization: Bearer <one-time workspace key>
Content-Type: application/json
```

```json
{
  "external_id": "your-source-unique-lead-id",
  "source": "website",
  "name": "Buyer name",
  "phone": "+13055550123",
  "email": "buyer@example.com",
  "preferences": "Toyota Camry",
  "consent": true,
  "consent_at": "2026-10-03T15:00:00Z"
}
```

All fields shown are required; email and preferences may be empty. `consent_at` is required when consent is true. Phone uses E.164. External ID is idempotent within the workspace. A receipt records consent evidence; existing opt-out is never reversed. Intake creates a contact/opportunity and assigns the configured seller; it does not send a customer message. Rotate the key to revoke previous access. Native Meta Lead Ads OAuth is not included; use the signed connector with your integration provider.

## Inventory contract

JSON accepts an array or `{ "vehicles": [...] }`. CSV uses the same flat fields:

```csv
stock_number,vin,make,model,year,mileage,mileage_unit,price,currency,status,photos,notes
DEMO-001,,Toyota,Camry,2026,0,mi,32000,USD,available,,Example only
```

Prices must be verified numeric selling prices; blank prices stay unpublished. Never substitute MSRP. Optional photos are a JSON array or pipe-separated HTTPS URLs. Feed mapping maps canonical fields to supplier column names. Complete snapshots only, maximum 5,000 units/8 MB; known pagination indicators are rejected. Failed imports are atomic. Reserved/sold seller units are preserved unless status updates are explicitly enabled. Missing-unit retirement affects only units belonging to the same feed and reserves them; it never deletes them. Manual uploads never retire missing units.

The Toyota demo inventory is a public snapshot, not a continuous authorized feed. A current authorized feed URL must be configured to enable recurring refresh. Freshness rules prevent the assistant from offering outdated imported units.

## Buyer links and operations

Copy a visit link from the appointment card. Tokens stay in the URL fragment, are stored hashed and expire; public responses omit buyer identity and budget. Seller rescheduling invalidates an old schedule link. The buyer may confirm attendance, cancel or request an available slot within configured rules. Rebooking checks seller/vehicle conflicts atomically.

The `dealer-growth` cron runs every five minutes and services due inventory feeds. Existing automation schedules process sales follow-up. Connected customer channels still require their provider connection and authorized templates. No real channels are enabled by these settings alone.

## Database

Apply migrations `379_dealer_growth.sql` and `380_dealer_followup_settings.sql` to the isolated Dealers project before deploying this revision. Credentials and appointment tokens are service-only; member views use workspace RLS. Sync runs, intake receipts, stage transitions and coaching results retain an audit trail.

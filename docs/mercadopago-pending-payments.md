# Pending Mercado Pago payments

`payment_pending` is separate from `payment_rejected` and the Shopify
`shopify_order_created` trigger. It supports live `pending_waiting_payment`
cash vouchers (`ticket` / `atm`) and `pending_waiting_transfer` bank transfers.
Card processing, risk reviews, test payments, zero amounts and expired vouchers
are not actionable pending payments.

## Enrollment and delivery

- Signed app webhooks fetch the exact payment, including older vouchers outside
  the rolling search window. The existing 30-minute sync also ingests payments.
- `(workspace_id, mp_payment_id)` is unique. Source updates never reset dispatch
  state. The existing five-minute recovery cron enrolls only active flows.
- Only payments created after the automation activation request are enrolled;
  publishing the feature neither creates nor activates merchant flows.
- The recipient comes from the payment phone or one unambiguous exact-email
  contact match. A name or approximate purchase amount never identifies a buyer.
- Execution IDs are deterministic per merchant, flow, buyer and payment. A lost
  queue acknowledgement does not create another execution or wait chain.
- Before every reminder, query current provider state without caching. Stop on
  approval, cancellation, expiry or a reported receipt. Unknown provider state
  parks the run instead of sending from the old webhook status.
- If the same exact external purchase reference has another approved attempt,
  stop the old voucher's reminder, even if that voucher remains pending.
- Existing cart/declined-payment recovery yields when a later actionable cash
  or transfer attempt for the same canonical phone replaces it.

## Duplicate prevention

The database atomically claims one reminder sequence per merchant and canonical
phone for 48 hours. Shopify pending-order reminders and Mercado Pago reminders
share the same claim. This deliberately consolidates simultaneous pending
purchases for one buyer instead of sending multiple overlapping sequences.
Different merchants never share suppression state.

The winning sequence can send its own scheduled follow-ups. Each step separately
reserves a deterministic outgoing message ID, shared across text and template
delivery. A confirmed delivery is reused; an uncertain delivery is not retried
automatically and requires review. Voice-note delivery is not enabled for these
reminders because it does not use that durable delivery reservation.

The recipe is anchored at 1, 6 and 24 hours after payment creation. Its three
messages expire at 6, 24 and 26 hours respectively, so a late cron does not send
all missed messages in a burst. Voucher expiry can stop the sequence sooner.

## Merchant setup

Connect the merchant's own Mercado Pago account, install **Pago pendiente ·
Mercado Pago / Pending payment · Mercado Pago**, choose an approved WhatsApp
template and a final tag, and activate. Variables include buyer identity, total,
currency, `payment_url` (the existing provider voucher/instructions) and
`payment_expiration`. Riverz does not create a replacement charge.

The editor exposes the absolute reminder hours and each message's optional
send deadline. Changing a wait updates `from_trigger_hours`, not just the
legacy relative delay. Provider expiry always remains authoritative.
Template variables also expose `payment_method`; a dynamic URL button named
**Instrucciones de pago / Payment instructions** resolves `payment_url` from
that buyer's original voucher. The gallery follows the merchant's language,
refreshes the gateway connection on focus and does not require Shopify.

## Country coverage

Detection does not filter by country, currency or `payment_method_id`. It uses
Payments API `pending` plus `pending_waiting_payment` / `pending_waiting_transfer`
and the provider types `ticket`, `atm`, `bank_transfer`. This covers Efecty/PSE,
OXXO/SPEI, Rapipago/Pago Fácil, boleto/Pix, PagoEfectivo, Abitab/Redpagos and new
methods with those contracts when available to the connected merchant.
Card processing, review or challenges are not cash debts and never trigger
this cash/transfer reminder. Local phone normalization uses the merchant's
WhatsApp country; international buyer phones keep their own country code.
Instructions read `transaction_details.external_resource_url`, or Pix's
`point_of_interaction.transaction_data.ticket_url`, always HTTPS and never a
new charge. Coverage tests are contract fixtures, not live purchases abroad.

Provider references:
- https://www.mercadopago.com.mx/developers/en/docs/sales-processing/payment-methods
- https://www.mercadopago.com.co/developers/es/docs/checkout-bricks/payment-brick/payment-submission/other-payment-methods
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix

Apply migration 296 before deploying; the integration build gate verifies its
tables. The migration adds deduplication metadata to existing Shopify
pending-order recipes without changing their steps, templates or activation.

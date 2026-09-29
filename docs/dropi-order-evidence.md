# Dropi order evidence and release safeguards

## Verified reads (2026-09-28)

DeUna's authenticated Dropi account is 455408, shop 404013; Shopify is
`bs9mqe-na.myshopify.com`, Riverz workspace
`36f81b96-41b9-4d29-b72e-11be3d3070a3`.

The Contaduria connector authenticates through Dropi BFF and the owner's existing
DPAPI-protected TOTP. Credentials and TOTP never enter Riverz, payloads or Git.

| Source                                           | Verified purpose                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `api-v2.dropi.co/bff/orders/myorders/v2`         | Paginated account orders, exact Shopify IDs and shop IDs                  |
| Same path plus `/{id}`                           | Order state, guide, costs, wallet, carrier incident reason                |
| `api-v2.dropi.co/bff/customers/fingerprint/v2`   | Buyer classification and delivered/returned/transit counts                |
| `api.dropi.co/api/orders/myorders/client-stats`  | Aggregate counts, not sufficient for panel risk classification            |
| `api.dropi.co/api/orders/getclientclasification` | Legacy completed-order counts; differs from fingerprint including transit |

Fingerprint uses `country_code=CO`, `user_id` from the authenticated order,
`phone` from that order, `months=0`, `X-Host: co`, and `X-Authorization`.
Its envelope is `is_successful`, unlike orders' `is_succesfull`. Dropi's panel
maps red/Frecuente to Riesgosa; the internal risk_label can say Critica. Apply
the panel's buyer-type color cap, not an invented return-rate threshold.
Missing data is unknown, never zero or safe. Observed time is consultation time,
not a claim that Dropi recomputed the buyer history at that instant.

The catalog repositories `dropi-productos` and `dropi-plataforma` supply catalog,
stock and market data. They do not establish DeUna order delivery or payments.
`dropi-mcp/dropi/transport.py` documents the legacy API headers. Legacy write
paths marked unverified in that repository are not used for dispatch.

## One canonical order and one pre-dispatch review

The signed `/api/internal/dropi/order-evidence` receiver reuses the incident
bridge signature and server-side DeUna binding. Migration 299 only enriches an
existing `orders` row matched by workspace, Shopify domain and Shopify ID.
It never creates contacts, conversations, orders, Shopify tags or messages.
SQL locks the row, rejects older/repeated observations and conflicting Dropi
identities. A unique account/Dropi-order index prevents linking to two orders.
Split Dropi orders mapping to one Shopify order are rejected for explicit review.

`lookup_order` exposes the pre-dispatch classification only after its existing
customer-identity check. Other-store buyer counts are withheld from the model.
The three-hour Windows poll remains responsible for accounting and for detecting
order changes because Dropi does not provide this bridge with a webhook. It does
not read every buyer fingerprint on every poll. The fingerprint is read only when
an existing DeUna order enters `PENDIENTE CONFIRMACION`, before dispatch, and only
once for that material order revision. A change to customer, address, amount or
line items invalidates the revision and requires a new review. Leaving that state
clears the local review marker.

Conversation context accepts the pre-dispatch evidence for 15 minutes; older
evidence is explicitly stale. The release policy separately requires a provider
read no older than 60 seconds at the actual confirmation decision. The signed
receiver rejects evidence for any status other than `PENDIENTE CONFIRMACION`.
Delivery does not establish payment; guide creation does not establish physical
dispatch.

## Release is not activated

`dropi-release-policy.ts` is a tested eligibility check, not an executor or queue.
It requires a fresh provider read, reviewed matching order revision, no newer
customer messages, 15 minutes of quiet, known buyer risk, and for Riesgosa an
approved live 50% payment from the correct merchant with the correct reference,
currency and amount, no refund, and a verified reduction of the COD balance.

There is no cancellation deadline for customer silence. No such cancellation is
enabled. PENDIENTE already means supplier processing: never create/reconfirm it.
The legacy voice path cannot create Dropi orders or write dispatch-related tags
for DeUna. Other stores retain their existing behavior.

DeUna had no Mercado Pago connection in Riverz or Contaduria at verification.
Shopify access did not expose a reusable Mercado Pago authorization. The generic
full-payment tool is blocked for linked risky orders rather than pretending to
be a deposit link. A dedicated partial-payment ledger, verified COD mutation,
chat-evidence queue and dispatch executor are not activated by this change.
No real charge, cancellation or shipment was used as a test.

Payment API reference: https://www.mercadopago.com.co/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post

import type { Locale } from '@/lib/i18n/config';
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking';
import {
  planLogisticsDraft,
  incidentCallDraftContext,
  type LogisticsSnapshot,
  type LogisticsDraftPolicy,
  LOGISTICS_DRAFT_POLICY,
} from './logistics-draft';

/** The carrier adapter must verify the link against the actual guide first.
 * A PDF shipping label is not a customer tracking page. No guessed deep links.
 */
export interface VerifiedTracking {
  carrierName: string;
  carrierHost: string;
  guide: string;
  url: string;
  verifiedForGuide: string;
  verifiedAt: number;
}
export interface LogisticsMessageCustomer {
  name: string;
  product: string;
  /** Agent language, not the operator's UI locale. */
  language: Locale;
}

/** Reuse Riverz's carrier registry; this is a candidate, not proof that the
 * carrier has this shipment. Verification must happen in the read adapter. */
export function logisticsTrackingCandidate(
  carrier: string,
  guide: string
): string | null {
  return resolveCarrierTrackingUrl(carrier, guide);
}

function singleLine(value: string): string {
  return value
    .replace(/[\r\n\t*_`~<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function verifiedTrackingUrl(
  t: VerifiedTracking,
  now: number
): string | null {
  if (
    !/^[A-Za-z0-9-]{5,40}$/.test(t.guide) ||
    t.verifiedForGuide !== t.guide ||
    !Number.isFinite(t.verifiedAt) ||
    t.verifiedAt > now ||
    !Number.isFinite(now) ||
    now - t.verifiedAt > 7 * 24 * 60 * 60_000 ||
    !singleLine(t.carrierName)
  )
    return null;
  try {
    const url = new URL(t.url);
    // Host is configured by a trusted carrier adapter, never by a customer or AI.
    if (
      url.protocol !== 'https:' ||
      url.hostname !== t.carrierHost ||
      url.port ||
      url.username ||
      url.password ||
      !t.carrierHost.includes('.') ||
      /(?:\.pdf)(?:$|[/?#])/i.test(url.href)
    )
      return null;
    // Reject a generic carrier homepage: must resolve this guide specifically.
    const tokens = decodeURIComponent(
      url.pathname + url.search + url.hash
    ).split(/[^A-Za-z0-9-]+/);
    if (!tokens.includes(t.guide)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Customer-facing copy follows ai_agents.language (es/en supported here).
 * This deterministic factual draft can also ground a later AI rewrite, which
 * must keep the guide/link, incident meaning and single question unchanged.
 */
export function buildIncidentMessageDraft(
  s: LogisticsSnapshot,
  customer: LogisticsMessageCustomer,
  tracking: VerifiedTracking,
  now: number,
  policy: Readonly<LogisticsDraftPolicy> = LOGISTICS_DRAFT_POLICY
): string | null {
  if (planLogisticsDraft(s, now, policy).proposal !== 'draft_incident_message')
    return null;
  if (
    tracking.guide !== s.trackingNumber ||
    tracking.carrierHost !== s.carrierHost
  )
    return null;
  const url = verifiedTrackingUrl(tracking, now);
  const name = singleLine(customer.name),
    product = singleLine(customer.product);
  if (!url || !name || !product || !s.incident) return null;
  const carrier = singleLine(tracking.carrierName);
  const en = customer.language === 'en';
  const text = {
    recipient_absent: en
      ? [
          `${carrier} reported that no one was available to receive your ${product}.`,
          'We want to help you receive it 💛 Will someone be available at the delivery address, or do we need to update any details?',
        ]
      : [
          `${carrier} reportó que no encontró a quien recibiera tu ${product}.`,
          'Queremos ayudarte a recibirlo 💛 ¿Habrá alguien disponible en la dirección o necesitas corregir algún dato?',
        ],
    address_issue: en
      ? [
          `${carrier} reported an address issue with your ${product} delivery.`,
          'Let’s check the details so we can help 📍 What is the complete delivery address, including any apartment or building details?',
        ]
      : [
          `${carrier} reportó una dificultad con la dirección de entrega de tu ${product}.`,
          'Revisemos los datos para ayudarte 📍 ¿Cuál es la dirección completa, incluyendo apartamento o indicaciones para ubicarla?',
        ],
    pickup_required: en
      ? [
          `${carrier} reported that your ${product} needs to be collected at a pickup point.`,
          'You can check the pickup details in the tracking link 📍 Would you like help confirming where to collect it?',
        ]
      : [
          `${carrier} reportó que tu ${product} requiere recogida en un punto de atención.`,
          'Puedes consultar los detalles de recogida en el rastreo 📍 ¿Necesitas ayuda para confirmar dónde recogerlo?',
        ],
    payment_issue: en
      ? [
          `${carrier} reported a payment issue when delivering your ${product}.`,
          'We can help check the options 💛 Would you like us to review the amount or request a different delivery date?',
        ]
      : [
          `${carrier} reportó una dificultad con el pago al entregar tu ${product}.`,
          'Podemos ayudarte a revisar las opciones 💛 ¿Necesitas aclarar el valor o solicitar otra fecha de entrega?',
        ],
    customer_rejected: null,
    unknown: null,
  }[s.incident.kind];
  if (!text) return null;
  return [
    en ? `Hi, ${name} 😊` : `Hola, ${name} 😊`,
    text[0],
    `${en ? '📦 Tracking number' : '📦 Guía'}: *${tracking.guide}*\n${carrier}\n${url}`,
    text[1],
  ].join('\n\n');
}

/** Reviewable packet, deliberately unable to send, call, dispatch or cancel. */
export function buildLogisticsPreview(
  s: LogisticsSnapshot,
  customer: LogisticsMessageCustomer,
  tracking: VerifiedTracking | null,
  now: number,
  policy: Readonly<LogisticsDraftPolicy> = LOGISTICS_DRAFT_POLICY
) {
  const decision = planLogisticsDraft(s, now, policy);
  const url =
    tracking &&
    tracking.guide === s.trackingNumber &&
    tracking.carrierHost === s.carrierHost
      ? verifiedTrackingUrl(tracking, now)
      : null;
  return {
    ...decision,
    message: tracking
      ? buildIncidentMessageDraft(s, customer, tracking, now, policy)
      : null,
    callContext:
      decision.proposal === 'draft_incident_call' && url && tracking
        ? {
            ...incidentCallDraftContext(s),
            customer_name: singleLine(customer.name),
            product: singleLine(customer.product),
            language: customer.language,
            tracking_number: tracking.guide,
            tracking_url: url,
            carrier: singleLine(tracking.carrierName),
          }
        : null,
    blockers: [
      'activation_not_authorized',
      ...(['draft_incident_message', 'draft_incident_call'].includes(
        decision.proposal
      ) && !url
        ? ['verified_carrier_tracking_required']
        : []),
    ],
  };
}

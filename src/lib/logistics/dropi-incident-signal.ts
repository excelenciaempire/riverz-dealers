/**
 * Delivery-incident signal written back by Dropi/Dropify into Shopify.
 *
 * Dropi remains the system of record. Riverz only reacts to structured
 * Shopify fields that the logistics integration itself updates: exact order
 * tags and Shopify's shipment_status. Notes and customer free text are never
 * promoted to an official incident.
 */

export type DropiIncidentState = 'active' | 'resolved' | 'none';
export type DropiIncidentTransition = 'opened' | 'resolved' | null;

export interface DropiIncidentSignal {
  state: DropiIncidentState;
  transition: DropiIncidentTransition;
  reason: string;
  source: 'shopify_tag' | 'shopify_shipment' | 'none';
}

const ACTIVE_SHIPMENT_STATUSES = new Set(['failure', 'attempted delivery']);
const RECOVERED_SHIPMENT_STATUSES = new Set([
  'confirmed',
  'in transit',
  'out for delivery',
  'ready for pickup',
  'delivered',
]);

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

function tags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return raw.map((tag) => String(tag).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function tagState(value: unknown): Pick<DropiIncidentSignal, 'state' | 'reason' | 'source'> {
  const all = tags(value);
  const solved = all.find((tag) => normalized(tag) === 'novedad solucionada');
  if (solved) return { state: 'resolved', reason: '', source: 'shopify_tag' };

  for (const tag of all) {
    const clean = normalized(tag);
    const match = /^novedad(?:\s*[:\-]\s*(.+))?$/.exec(clean);
    if (!match) continue;
    const originalReason = /^novedad\s*[:\-]\s*(.+)$/i.exec(tag)?.[1]?.trim();
    return {
      state: 'active',
      reason:
        originalReason ||
        'La transportadora necesita confirmar información de entrega.',
      source: 'shopify_tag',
    };
  }
  return { state: 'none', reason: '', source: 'none' };
}

function snapshot(order: Record<string, unknown>) {
  const fromTag = tagState(order.tags ?? order.shop_tags);
  if (fromTag.state !== 'none') return fromTag;

  const status = normalized(order.shipment_status);
  if (ACTIVE_SHIPMENT_STATUSES.has(status)) {
    return {
      state: 'active' as const,
      reason:
        status === 'attempted delivery'
          ? 'La transportadora reportó un intento de entrega sin completar.'
          : 'La transportadora reportó una incidencia en la entrega.',
      source: 'shopify_shipment' as const,
    };
  }
  return { state: 'none' as const, reason: '', source: 'none' as const };
}

export function detectDropiIncidentTransition(
  current: Record<string, unknown>,
  previous: Record<string, unknown> | null,
): DropiIncidentSignal {
  const now = snapshot(current);
  const before = previous ? snapshot(previous) : snapshot({});

  if (now.state === 'active' && before.state !== 'active') {
    return { ...now, transition: 'opened' };
  }
  if (now.state === 'resolved' && before.state !== 'resolved') {
    return { ...now, transition: 'resolved' };
  }

  const currentShipment = normalized(current.shipment_status);
  if (
    before.state === 'active' &&
    now.state === 'none' &&
    RECOVERED_SHIPMENT_STATUSES.has(currentShipment)
  ) {
    return {
      state: 'resolved',
      transition: 'resolved',
      reason: '',
      source: 'shopify_shipment',
    };
  }

  return { ...now, transition: null };
}

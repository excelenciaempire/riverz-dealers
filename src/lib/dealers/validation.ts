import {
  ACTIVITY_KINDS,
  APPOINTMENT_STATUSES,
  STAGES,
  VEHICLE_STATUSES,
} from './types';
export class DealerError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DealerError('invalid');
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw new DealerError('invalid');
  return value;
}
function text(v: unknown, max = 2000, required = false): string {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim()))
    throw new DealerError('invalid');
  return v.trim();
}
function number(v: unknown, max: number, integer = false): number {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < 0 ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw new DealerError('invalid');
  return v;
}
function choice<T extends string>(v: unknown, values: readonly T[]): T {
  if (!values.includes(v as T)) throw new DealerError('invalid');
  return v as T;
}
function boolean(v: unknown) {
  if (typeof v !== 'boolean') throw new DealerError('invalid');
  return v;
}
export function instant(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new DealerError('invalid');
  return new Date(v).toISOString();
}
function currency(v: unknown) {
  const s = text(v, 3, true).toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) throw new DealerError('invalid');
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: s });
  } catch {
    throw new DealerError('invalid');
  }
  return s;
}
export function vehicleInput(value: unknown) {
  const b = object(value);
  const year = number(b.year, new Date().getFullYear() + 2, true);
  if (year < 1900) throw new DealerError('invalid');
  if (!Array.isArray(b.photos) || b.photos.length > 20)
    throw new DealerError('invalid');
  const photos = b.photos.map((p) => {
    const s = text(p, 2048, true);
    let u;
    try {
      u = new URL(s);
    } catch {
      throw new DealerError('invalid');
    }
    if (u.protocol !== 'https:' || u.username || u.password)
      throw new DealerError('invalid');
    return s;
  });
  const vin = b.vin ? text(b.vin, 17, true).toUpperCase() : null;
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
    throw new DealerError('invalid');
  return {
    stock_number: text(b.stock_number, 64, true),
    vin,
    make: text(b.make, 80, true),
    model: text(b.model, 120, true),
    year,
    mileage: number(b.mileage, 5000000, true),
    mileage_unit: choice(b.mileage_unit, ['mi', 'km']),
    price: b.price === null ? null : number(b.price, 100000000),
    currency: currency(b.currency),
    status: choice(b.status, VEHICLE_STATUSES),
    photos,
    notes: text(b.notes ?? ''),
  };
}
export function opportunityStageInput(value: unknown) {
  const b = object(value);
  return {
    stage: choice(b.stage, STAGES),
    expected_stage: choice(b.expected_stage, STAGES),
  };
}
export function opportunityInput(value: unknown) {
  const b = object(value);
  if (!Array.isArray(b.vehicle_ids) || b.vehicle_ids.length > 20)
    throw new DealerError('invalid');
  return {
    contact_id: uuid(b.contact_id),
    stage: choice(b.stage, STAGES),
    budget: b.budget == null ? null : number(b.budget, 100000000),
    currency: currency(b.currency),
    preferences: text(b.preferences ?? ''),
    buying_timeframe: text(b.buying_timeframe ?? '', 300),
    financing: boolean(b.financing),
    trade_in: text(b.trade_in ?? '', 500),
    ...(Object.hasOwn(b, 'buying_reason')
      ? { buying_reason: text(b.buying_reason, 1000) }
      : {}),
    ...(Object.hasOwn(b, 'objection')
      ? { objection: text(b.objection, 1000) }
      : {}),
    ...(Object.hasOwn(b, 'lead_source')
      ? { lead_source: text(b.lead_source, 200) }
      : {}),
    ...(Object.hasOwn(b, 'lost_reason') ? { lost_reason: text(b.lost_reason,120) } : {}),
    ...(Object.hasOwn(b, 'assigned_seller_id') ? { assigned_seller_id: b.assigned_seller_id===null ? null : uuid(b.assigned_seller_id) } : {}),
    ...(Object.hasOwn(b, 'buyer_type')
      ? {
          buyer_type: choice(b.buyer_type, [
            'unknown',
            'first_time',
            'replacement',
            'additional',
          ]),
        }
      : {}),
    next_follow_up_at: b.next_follow_up_at
      ? instant(b.next_follow_up_at)
      : null,
    follow_up_note: text(b.follow_up_note ?? '', 1000),
    follow_up_paused: boolean(b.follow_up_paused),
    vehicle_ids: [...new Set(b.vehicle_ids.map(uuid))],
  };
}
export function appointmentInput(value: unknown) {
  const b = object(value);
  const starts_at = instant(b.starts_at),
    ends_at = instant(b.ends_at);
  if (
    Date.parse(starts_at) <= Date.now() ||
    Date.parse(ends_at) <= Date.parse(starts_at) ||
    Date.parse(ends_at) - Date.parse(starts_at) > 14400000
  )
    throw new DealerError('invalid');
  return {
    opportunity_id: uuid(b.opportunity_id),
    vehicle_id: uuid(b.vehicle_id),
    starts_at,
    ends_at,
    location: text(b.location, 500, true),
    kind: choice(b.kind, ['visit', 'test_drive']),
    status: choice(b.status, ['requested', 'confirmed']),
  };
}
export function appointmentStatus(value: unknown) {
  return choice(object(value).status, APPOINTMENT_STATUSES);
}
/** Appointment identities are immutable; only schedule and presentation may change. */
export function appointmentUpdate(value: unknown) {
  const b = object(value);
  const preparation = Object.fromEntries(
    ['customer_confirmed', 'vehicle_prepared', 'directions_sent']
      .filter((k) => Object.hasOwn(b, k))
      .map((k) => [k, boolean(b[k])])
  );
  if (
    !Object.hasOwn(b, 'status') &&
    !Object.hasOwn(b, 'starts_at') &&
    !Object.hasOwn(b, 'ends_at') &&
    !Object.keys(preparation).length
  )
    throw new DealerError('invalid');
  if (!Object.hasOwn(b, 'starts_at') && !Object.hasOwn(b, 'ends_at'))
    return {
      ...(Object.hasOwn(b, 'status') ? { status: appointmentStatus(b) } : {}),
      ...preparation,
    };
  const parsed = appointmentInput({
    ...b,
    opportunity_id: '00000000-0000-4000-8000-000000000001',
    vehicle_id: '00000000-0000-4000-8000-000000000002',
  });
  return {
    starts_at: parsed.starts_at,
    ends_at: parsed.ends_at,
    location: parsed.location,
    kind: parsed.kind,
    status: parsed.status,
  };
}
export function activityInput(value: unknown) {
  const b = object(value),
    next_at = b.next_follow_up_at ? instant(b.next_follow_up_at) : null;
  if (next_at && Date.parse(next_at) <= Date.now())
    throw new DealerError('invalid');
  return {
    opportunity_id: uuid(b.opportunity_id),
    kind: choice(b.kind, ACTIVITY_KINDS),
    note: text(b.note ?? ''),
    next_follow_up_at: next_at,
    follow_up_note: text(b.follow_up_note ?? '', 1000, !!next_at),
  };
}

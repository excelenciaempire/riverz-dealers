/**
 * Telnyx phone-number provisioning (platform-level).
 *
 * Each Riverz workspace buys its OWN number and, for regulated countries,
 * uploads the required documentation. This is the thin client over Telnyx's
 * Number Search / Regulatory Requirements / Number Orders / Phone Numbers APIs.
 * Auth is a single platform key (`TELNYX_API_KEY`); numbers are attached to a
 * shared voice connection so inbound routes to our worker, and the per-workspace
 * DID becomes the caller ID (already wired in the worker).
 *
 * ⚠️ Ordering a number is a PAID, hard-to-reverse action — callers must gate it
 * behind explicit user intent. Search + requirements are free/read-only.
 */

const TELNYX_BASE = 'https://api.telnyx.com/v2';

export class TelnyxApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly field: string | null) {
    super(message);
    this.name = 'TelnyxApiError';
  }
}

export type PhoneNumberType = 'local' | 'toll_free' | 'national' | 'mobile';

export interface AvailableNumber {
  phone_number: string;
  region?: string | null;
  locality?: string | null;
  /** Monthly + upfront cost, as Telnyx reports it. */
  monthly_cost?: string | null;
  upfront_cost?: string | null;
  currency?: string | null;
  features: string[];
}

export interface RegulatoryRequirement {
  /** The requirement's UUID — passed back as `requirement_id` in a group. */
  id: string;
  label: string;
  description?: string;
  example?: string;
  /** Fulfillment kind: 'textual' | 'datetime' | 'document' | 'address'. */
  field_type: string;
}

export interface OrderedNumber {
  id: string;
  phone_number: string;
  status: string;
}

function apiKey(): string {
  const k = process.env.TELNYX_API_KEY;
  if (!k) throw new Error('TELNYX_API_KEY not configured');
  return k;
}

async function telnyx<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail =
      json?.errors?.[0]?.detail || json?.errors?.[0]?.title || res.statusText;
    const error = json?.errors?.[0];
    throw new TelnyxApiError(`Telnyx ${res.status}: ${detail}`, res.status,
      error?.code == null ? null : String(error.code),
      typeof error?.source?.pointer === 'string' ? error.source.pointer : null);
  }
  return json as T;
}

/** Search numbers available to buy in a country. Read-only. */
export async function searchAvailableNumbers(opts: {
  country: string; // ISO-2, e.g. "US", "CO"
  type?: PhoneNumberType;
  limit?: number;
  areaCode?: string;
}): Promise<AvailableNumber[]> {
  const p = new URLSearchParams();
  p.set('filter[country_code]', opts.country.toUpperCase());
  p.append('filter[features][]', 'voice');
  p.set('filter[limit]', String(Math.min(50, opts.limit ?? 20)));
  if (opts.type) p.set('filter[phone_number_type]', opts.type);
  if (opts.areaCode) p.set('filter[national_destination_code]', opts.areaCode);
  const data = await telnyx<{ data: RawAvailable[] }>(`/available_phone_numbers?${p}`);
  return (data.data ?? []).map((n) => ({
    phone_number: n.phone_number,
    region: n.region_information?.[0]?.region_name ?? null,
    locality: n.region_information?.find((r) => r.region_type === 'location')?.region_name ?? null,
    monthly_cost: n.cost_information?.monthly_cost ?? null,
    upfront_cost: n.cost_information?.upfront_cost ?? null,
    currency: n.cost_information?.currency ?? null,
    features: (n.features ?? []).map((f) => f.name),
  }));
}

/**
 * Regulatory requirements to OWN a number of this type in this country.
 * If the returned list is empty, the country is "instant" (no documents).
 */
export async function getRegulatoryRequirements(opts: {
  country: string;
  type?: PhoneNumberType;
}): Promise<RegulatoryRequirement[]> {
  const p = new URLSearchParams();
  p.set('filter[country_code]', opts.country.toUpperCase());
  p.set('filter[phone_number_type]', opts.type ?? 'local');
  p.set('filter[action]', 'ordering');
  const data = await telnyx<{ data: RawRequirementSet[] }>(`/regulatory_requirements?${p}`);
  const reqs = data.data?.[0]?.regulatory_requirements ?? [];
  return reqs
    .filter((r): r is typeof r & { id: string } => !!r.id)
    .map((r) => ({
      id: r.id, // real UUID → requirement_id
      label: r.name || 'Requisito',
      description: r.description,
      example: r.example,
      // GET may report 'address_id'; normalize to the fulfillment enum.
      field_type: r.field_type === 'address_id' ? 'address' : r.field_type || 'textual',
    }));
}

// ── Regulated-country provisioning: documents, addresses, requirement groups ──

/** Upload a document (base64) → returns its Telnyx UUID. Must be linked to a
 *  requirement group within ~30 min or Telnyx deletes it. */
export async function uploadDocument(opts: {
  base64: string;
  filename: string;
  customerReference?: string;
}): Promise<{ id: string; status: string }> {
  const data = await telnyx<{ data: { id: string; status: string } }>(`/documents`, {
    method: 'POST',
    body: JSON.stringify({
      file: opts.base64,
      filename: opts.filename,
      customer_reference: opts.customerReference,
    }),
  });
  return { id: data.data.id, status: data.data.status };
}

/** Create an address → returns its id (used as field_value for address reqs). */
export async function createAddress(fields: Record<string, unknown>): Promise<{ id: string }> {
  const data = await telnyx<{ data: { id: string } }>(`/addresses`, {
    method: 'POST',
    body: JSON.stringify({ address_book: true, validate_address: true, ...fields }),
  });
  return { id: data.data.id };
}

export interface RequirementGroup {
  id: string;
  status: string; // approved | unapproved | pending-approval | declined | expired
}

/** Create a requirement group with the filled requirements. */
export async function createRequirementGroup(opts: {
  country: string;
  type: PhoneNumberType;
  requirements: { requirement_id: string; field_value: string }[];
  customerReference?: string;
}): Promise<RequirementGroup> {
  const data = await telnyx<{ data: { id: string; status: string } }>(`/requirement_groups`, {
    method: 'POST',
    body: JSON.stringify({
      country_code: opts.country.toUpperCase(),
      phone_number_type: opts.type,
      action: 'ordering',
      customer_reference: opts.customerReference,
      regulatory_requirements: opts.requirements,
    }),
  });
  return { id: data.data.id, status: data.data.status ?? 'unapproved' };
}

/** Submit a requirement group for Telnyx review. */
export async function submitRequirementGroup(id: string): Promise<RequirementGroup> {
  const data = await telnyx<{ data: { id: string; status: string } }>(
    `/requirement_groups/${id}/submit_for_approval`,
    { method: 'POST' },
  );
  return { id: data.data.id, status: data.data.status ?? 'pending-approval' };
}

/** Poll a requirement group's approval status. */
export async function getRequirementGroup(id: string): Promise<RequirementGroup> {
  const data = await telnyx<{ data: { id: string; status: string } }>(`/requirement_groups/${id}`);
  return { id: data.data.id, status: data.data.status ?? 'unapproved' };
}

/** Order a number and attach it to the shared voice connection (inbound
 *  routing). PAID + hard to reverse. `requirementGroupId` links an approved
 *  regulatory bundle for gated countries. */
export async function orderNumber(opts: {
  phoneNumber: string;
  connectionId?: string;
  messagingProfileId?: string;
  requirementGroupId?: string;
  customerReference?: string;
  /** Dedupes a re-fired order at Telnyx (double-click / retry) so the same
   *  number is never billed twice. Stable per (workspace, number). */
  idempotencyKey?: string;
}): Promise<OrderedNumber> {
  const body: Record<string, unknown> = {
    phone_numbers: [
      opts.requirementGroupId
        ? { phone_number: opts.phoneNumber, requirement_group_id: opts.requirementGroupId }
        : { phone_number: opts.phoneNumber },
    ],
  };
  const connectionId = opts.connectionId || process.env.TELNYX_VOICE_CONNECTION_ID;
  if (connectionId) body.connection_id = connectionId;
  if (opts.messagingProfileId) body.messaging_profile_id = opts.messagingProfileId;
  if (opts.customerReference) body.customer_reference = opts.customerReference;

  const data = await telnyx<{ data: RawOrder }>(`/number_orders`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : undefined,
  });
  const pn = data.data?.phone_numbers?.[0];
  return {
    id: data.data?.id ?? '',
    phone_number: pn?.phone_number ?? opts.phoneNumber,
    status: data.data?.status ?? 'pending',
  };
}

/** Look up an owned number's Telnyx id (needed to release / re-route). */
export async function findOwnedNumber(phoneNumber: string): Promise<{ id: string } | null> {
  const p = new URLSearchParams();
  p.set('filter[phone_number]', phoneNumber);
  const data = await telnyx<{ data: { id: string }[] }>(`/phone_numbers?${p}`);
  return data.data?.[0] ? { id: data.data[0].id } : null;
}

/** Release (delete) an owned number — stops the monthly rental. */
export async function releaseNumber(telnyxNumberId: string): Promise<void> {
  await telnyx(`/phone_numbers/${telnyxNumberId}`, { method: 'DELETE' });
}

// ── Raw Telnyx response shapes (internal) ──
interface RawAvailable {
  phone_number: string;
  region_information?: { region_type?: string; region_name?: string }[];
  cost_information?: { monthly_cost?: string; upfront_cost?: string; currency?: string };
  features?: { name: string }[];
}
interface RawRequirementSet {
  regulatory_requirements?: {
    id?: string;
    name?: string;
    description?: string;
    example?: string;
    field_type?: string;
  }[];
}
interface RawOrder {
  id?: string;
  status?: string;
  phone_numbers?: { phone_number?: string }[];
}

import type { Channel } from '@/types';

/**
 * One rule inside a segment. A segment is `{ match_mode, rules[] }` —
 * the resolver evaluates each rule against a contact and combines
 * results with AND (match_mode 'all') or OR ('any').
 *
 * Keep this union additive: new rule shapes can be added without
 * migrating existing rows because `rules` is a free-form JSONB column.
 * The resolver silently skips rules whose `type` is unknown so old
 * clients don't blow up on rules added later.
 */
export type SegmentRule =
  | { type: 'tag'; op: 'has' | 'not_has'; tagId: string }
  | { type: 'channel'; op: 'is' | 'is_not'; channel: Channel }
  | { type: 'created'; op: 'last_n_days' | 'before' | 'after'; value: string }
  | {
      type: 'has_field';
      field: 'email' | 'phone' | 'company' | 'name';
      op: 'present' | 'missing';
    }
  | {
      type: 'text';
      field: 'name' | 'email' | 'phone' | 'company';
      op: 'contains' | 'equals' | 'starts_with';
      value: string;
    }
  | {
      type: 'custom_field';
      fieldId: string;
      op: 'equals' | 'not_equals' | 'contains';
      value: string;
    }
  // Shopify dimensions (populated by the orders/checkout webhooks + the
  // historical backfill). These read columns already on the contact row
  // (is_shopify_customer, last_offer_chosen, last_offer_units) — no aux fetch.
  | { type: 'shopify'; op: 'is_customer' | 'is_not_customer' }
  | { type: 'offer'; op: 'is' | 'is_not' | 'contains' | 'any'; value: string }
  | {
      type: 'units';
      op: 'eq' | 'gte' | 'lte' | 'between';
      value: number;
      value2?: number;
    }
  // Date rules on contact activity columns: última compra (last_offer_at),
  // última actividad (last_inbound_at), última conversación IA
  // (last_ai_conversation_at). `created` already covers created_at.
  | {
      type: 'activity_date';
      field: 'last_purchase' | 'last_activity' | 'last_ai';
      op: 'last_n_days' | 'before' | 'after';
      value: string;
    };

export type SegmentMatchMode = 'all' | 'any';

export interface ContactSegment {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  rules: SegmentRule[];
  match_mode: SegmentMatchMode;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Display label per rule type — used in the rule chip + tooltip. */
export const RULE_TYPE_LABEL: Record<SegmentRule['type'], string> = {
  tag: 'Etiqueta',
  channel: 'Canal',
  created: 'Fecha de creación',
  has_field: 'Tiene dato',
  text: 'Texto del contacto',
  custom_field: 'Campo personalizado',
  shopify: 'Cliente Shopify',
  offer: 'Oferta elegida',
  units: 'Unidades compradas',
  activity_date: 'Fecha de actividad',
};

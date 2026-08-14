import type { Contact } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SegmentMatchMode, SegmentRule } from './types';
import { fetchAllRows } from '@/lib/supabase/paginate';

/**
 * Resolve a segment definition to the concrete contact list it matches.
 *
 * Approach: fetch the workspace's contacts (filtered by what we can do
 * server-side cheaply — channel + created_at) plus auxiliary data
 * (contact_tags, contact_custom_values) for those contacts, then
 * evaluate the rule array in JS. This keeps the logic in one place,
 * makes the editor's "live preview" trivial to wire, and is fine for
 * the ≤10k contacts/workspace range. We can swap in a server-side
 * resolver behind a route later if list sizes explode.
 *
 * Returns:
 *   - contacts: the matching Contact rows (full row, sorted by created_at desc)
 *   - total: candidate pool size before rule evaluation (for the editor footer)
 */
export async function resolveSegment(
  supabase: SupabaseClient,
  workspaceId: string,
  rules: SegmentRule[],
  matchMode: SegmentMatchMode,
  opts: { excludeOptedOut?: boolean } = {},
): Promise<{ contacts: Contact[]; total: number }> {
  // ── Step 1: candidate pool ────────────────────────────────────
  // Page through ALL contacts so large workspaces (e.g. after the Shopify
  // backfill imports thousands) segment PRECISELY — not just the first
  // 5000. Capped at MAX as a runaway guard.
  const PAGE = 1000;
  const MAX = 100000;
  const contacts: Contact[] = [];
  let total = 0;
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, count, error } = await supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (count != null) total = count;
    const batch = (data ?? []) as Contact[];
    contacts.push(...batch);
    if (batch.length < PAGE) break;
  }
  if (contacts.length === 0 || rules.length === 0) {
    return { contacts: rules.length === 0 ? contacts : [], total };
  }

  // ── Step 2: pull aux data only if some rule needs it ──────────
  // Chunk the id lists — a single `.in()` over thousands of UUIDs blows
  // past PostgREST's URL/arg limits and silently truncates.
  const needsTags = rules.some((r) => r.type === 'tag');
  const needsCustom = rules.some((r) => r.type === 'custom_field');

  const ids = contacts.map((c) => c.id);
  const ID_CHUNK = 300;
  const tagsByContact = new Map<string, Set<string>>();
  const customByContact = new Map<string, Map<string, string>>();

  if (needsTags) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      // Paginado dentro del lote: 300 contactos con varias etiquetas cada uno
      // pasan de las 1.000 filas por respuesta, y una etiqueta que no llega
      // hace que una regla "tiene la etiqueta X" deje fuera a quien sí la tiene.
      const ct = await fetchAllRows<{ contact_id: string; tag_id: string }>(
        (from, to) =>
          supabase
            .from('contact_tags')
            .select('contact_id, tag_id')
            .in('contact_id', ids.slice(i, i + ID_CHUNK))
            .order('contact_id', { ascending: true })
            .order('tag_id', { ascending: true })
            .range(from, to),
      );
      for (const row of ct) {
        const set = tagsByContact.get(row.contact_id) ?? new Set<string>();
        set.add(row.tag_id);
        tagsByContact.set(row.contact_id, set);
      }
    }
  }

  if (needsCustom) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const ccv = await fetchAllRows<{
        contact_id: string;
        custom_field_id: string;
        value: string | null;
      }>((from, to) =>
        supabase
          .from('contact_custom_values')
          .select('contact_id, custom_field_id, value')
          .in('contact_id', ids.slice(i, i + ID_CHUNK))
          .order('contact_id', { ascending: true })
          .order('custom_field_id', { ascending: true })
          .range(from, to),
      );
      for (const row of ccv) {
        const m =
          customByContact.get(row.contact_id) ?? new Map<string, string>();
        m.set(row.custom_field_id, row.value ?? '');
        customByContact.set(row.contact_id, m);
      }
    }
  }

  // ── Step 3: evaluate rules ────────────────────────────────────
  let matched = contacts.filter((c) =>
    evaluateContact(
      c,
      rules,
      matchMode,
      tagsByContact.get(c.id) ?? null,
      customByContact.get(c.id) ?? null,
    ),
  );

  // Precisión: al mostrar el conteo "enviable" (preview del editor), excluir a
  // quienes se dieron de baja — así el número coincide con lo que realmente se
  // envía (broadcasts filtran opted_out al despachar).
  if (opts.excludeOptedOut) {
    matched = matched.filter(
      (c) => (c as unknown as { opted_out?: boolean }).opted_out !== true,
    );
  }

  return { contacts: matched, total };
}

function evaluateContact(
  contact: Contact,
  rules: SegmentRule[],
  matchMode: SegmentMatchMode,
  tags: Set<string> | null,
  customValues: Map<string, string> | null,
): boolean {
  const results = rules.map((r) => evaluateRule(r, contact, tags, customValues));
  if (matchMode === 'all') return results.every(Boolean);
  return results.some(Boolean);
}

function evaluateRule(
  rule: SegmentRule,
  contact: Contact,
  tags: Set<string> | null,
  customValues: Map<string, string> | null,
): boolean {
  switch (rule.type) {
    case 'tag': {
      const has = tags?.has(rule.tagId) ?? false;
      return rule.op === 'has' ? has : !has;
    }
    case 'channel': {
      const matches = contact.channel === rule.channel;
      return rule.op === 'is' ? matches : !matches;
    }
    case 'created': {
      const created = new Date(contact.created_at).getTime();
      if (Number.isNaN(created)) return false;
      if (rule.op === 'last_n_days') {
        const n = Number(rule.value);
        if (!Number.isFinite(n) || n < 0) return false;
        const cutoff = Date.now() - n * 24 * 60 * 60 * 1000;
        return created >= cutoff;
      }
      const ref = new Date(rule.value).getTime();
      if (Number.isNaN(ref)) return false;
      return rule.op === 'before' ? created < ref : created > ref;
    }
    case 'has_field': {
      const v = (contact as unknown as Record<string, unknown>)[rule.field];
      const present = typeof v === 'string' && v.trim().length > 0;
      return rule.op === 'present' ? present : !present;
    }
    case 'text': {
      const v =
        ((contact as unknown as Record<string, unknown>)[rule.field] as
          | string
          | undefined) ?? '';
      const needle = rule.value.toLowerCase();
      const hay = v.toLowerCase();
      if (rule.op === 'contains') return hay.includes(needle);
      if (rule.op === 'equals') return hay === needle;
      return hay.startsWith(needle);
    }
    case 'custom_field': {
      const v = customValues?.get(rule.fieldId) ?? '';
      const needle = rule.value.toLowerCase();
      const hay = v.toLowerCase();
      if (rule.op === 'equals') return hay === needle;
      if (rule.op === 'not_equals') return hay !== needle;
      return hay.includes(needle);
    }
    case 'shopify': {
      const isCustomer = Boolean(
        (contact as unknown as Record<string, unknown>).is_shopify_customer,
      );
      return rule.op === 'is_customer' ? isCustomer : !isCustomer;
    }
    case 'offer': {
      const v = String(
        (contact as unknown as Record<string, unknown>).last_offer_chosen ?? '',
      ).toLowerCase();
      const needle = String(rule.value ?? '').toLowerCase();
      if (rule.op === 'any') return v.length > 0;
      if (rule.op === 'is') return v === needle;
      if (rule.op === 'is_not') return v !== needle;
      return v.includes(needle); // contains
    }
    case 'units': {
      const n = Number(
        (contact as unknown as Record<string, unknown>).last_offer_units,
      );
      if (!Number.isFinite(n)) return false;
      const a = Number(rule.value);
      if (!Number.isFinite(a)) return false;
      if (rule.op === 'eq') return n === a;
      if (rule.op === 'gte') return n >= a;
      if (rule.op === 'lte') return n <= a;
      const b = Number(rule.value2); // between
      if (!Number.isFinite(b)) return false;
      return n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    case 'activity_date': {
      const column =
        rule.field === 'last_purchase'
          ? 'last_offer_at'
          : rule.field === 'last_activity'
            ? 'last_inbound_at'
            : 'last_ai_conversation_at';
      const raw = (contact as unknown as Record<string, unknown>)[column];
      if (!raw) return false; // never happened → never matches a date window
      const ts = new Date(String(raw)).getTime();
      if (Number.isNaN(ts)) return false;
      if (rule.op === 'last_n_days') {
        const n = Number(rule.value);
        if (!Number.isFinite(n) || n < 0) return false;
        return ts >= Date.now() - n * 24 * 60 * 60 * 1000;
      }
      const ref = new Date(rule.value).getTime();
      if (Number.isNaN(ref)) return false;
      return rule.op === 'before' ? ts < ref : ts > ref;
    }
    case 'spend': {
      const n = shopNumber(contact, ['total_spent', 'totalSpent']);
      if (n == null) return false;
      const a = Number(rule.value);
      if (!Number.isFinite(a)) return false;
      if (rule.op === 'gte') return n >= a;
      if (rule.op === 'lte') return n <= a;
      const b = Number(rule.value2); // between
      if (!Number.isFinite(b)) return false;
      return n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    case 'orders': {
      const n = shopNumber(contact, ['orders_count', 'ordersCount']);
      if (n == null) return false;
      const a = Number(rule.value);
      if (!Number.isFinite(a)) return false;
      if (rule.op === 'eq') return n === a;
      if (rule.op === 'gte') return n >= a;
      if (rule.op === 'lte') return n <= a;
      const b = Number(rule.value2); // between
      if (!Number.isFinite(b)) return false;
      return n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    case 'location': {
      const addr = shopAddress(contact);
      const v = String(addr?.[rule.field] ?? '').toLowerCase();
      const needle = String(rule.value ?? '').toLowerCase();
      if (!needle) return false;
      return rule.op === 'is' ? v === needle : v.includes(needle);
    }
    default:
      return false;
  }
}

/** Snapshot jsonb de Shopify del contacto. */
function shopData(contact: Contact): Record<string, unknown> | null {
  return (
    (contact as unknown as { shopify_customer_data?: Record<string, unknown> | null })
      .shopify_customer_data ?? null
  );
}
/** Lee un número del snapshot probando varias claves (snake/camel). */
function shopNumber(contact: Contact, keys: string[]): number | null {
  const sd = shopData(contact);
  if (!sd) return null;
  for (const k of keys) {
    const n = Number(sd[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
/** Dirección por defecto del snapshot de Shopify. */
function shopAddress(contact: Contact): Record<string, unknown> | null {
  const sd = shopData(contact);
  return (sd?.default_address ?? sd?.address ?? null) as Record<string, unknown> | null;
}

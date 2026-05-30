import type { Contact } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SegmentMatchMode, SegmentRule } from './types';

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
): Promise<{ contacts: Contact[]; total: number }> {
  // ── Step 1: candidate pool ────────────────────────────────────
  const { data: contactsRaw, count, error } = await supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  const contacts = (contactsRaw ?? []) as Contact[];
  if (contacts.length === 0 || rules.length === 0) {
    return { contacts: rules.length === 0 ? contacts : [], total: count ?? 0 };
  }

  // ── Step 2: pull aux data only if some rule needs it ──────────
  const needsTags = rules.some((r) => r.type === 'tag');
  const needsCustom = rules.some((r) => r.type === 'custom_field');

  const ids = contacts.map((c) => c.id);
  const tagsByContact = new Map<string, Set<string>>();
  const customByContact = new Map<string, Map<string, string>>();

  if (needsTags) {
    const { data: ct } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', ids);
    for (const row of (ct ?? []) as { contact_id: string; tag_id: string }[]) {
      const set = tagsByContact.get(row.contact_id) ?? new Set<string>();
      set.add(row.tag_id);
      tagsByContact.set(row.contact_id, set);
    }
  }

  if (needsCustom) {
    const { data: ccv } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', ids);
    for (const row of (ccv ?? []) as {
      contact_id: string;
      custom_field_id: string;
      value: string | null;
    }[]) {
      const m = customByContact.get(row.contact_id) ?? new Map<string, string>();
      m.set(row.custom_field_id, row.value ?? '');
      customByContact.set(row.contact_id, m);
    }
  }

  // ── Step 3: evaluate rules ────────────────────────────────────
  const matched = contacts.filter((c) =>
    evaluateContact(
      c,
      rules,
      matchMode,
      tagsByContact.get(c.id) ?? null,
      customByContact.get(c.id) ?? null,
    ),
  );

  return { contacts: matched, total: count ?? 0 };
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
    default:
      return false;
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evaluateCase,
  summarizeCases,
  isAiMessage,
  type OutcomeConversation,
  type OutcomeMessage,
  type OutcomeReport,
  type OutcomeVerification,
} from './outcomes';

export async function allRows<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

const CONVERSATION_COLUMNS =
  'id, channel, status, needs_human_at, needs_human_reason, last_message_at, contacts(name)';
const MESSAGE_COLUMNS =
  'id, conversation_id, sender_type, origin, status, created_at';

export async function readThread(
  db: SupabaseClient,
  workspaceId: string,
  id: string
) {
  const { data, error } = await db
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const messages = await allRows<OutcomeMessage>((from, to) =>
    db
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', id)
      .order('created_at')
      .order('id')
      .range(from, to)
  );
  return evaluateCase(data as unknown as OutcomeConversation, messages);
}

export async function readOutcomes(
  db: SupabaseClient,
  workspaceId: string,
  range: { start: string; end: string }
): Promise<OutcomeReport> {
  const [activity, reviews, pending, subscription] = await Promise.all([
    allRows<OutcomeMessage>((from, to) =>
      db
        .from('messages')
        .select(
          `${MESSAGE_COLUMNS}, conversations!inner(workspace_id, deleted_at)`
        )
        .eq('conversations.workspace_id', workspaceId)
        .is('conversations.deleted_at', null)
        .gte('created_at', range.start)
        .lt('created_at', range.end)
        .order('created_at')
        .order('id')
        .range(from, to)
    ),
    allRows<OutcomeVerification>((from, to) =>
      db
        .from('conversation_outcomes')
        .select('conversation_id, last_message_id, category, verified_at')
        .eq('workspace_id', workspaceId)
        .order('conversation_id')
        .range(from, to)
    ),
    allRows<OutcomeConversation>(
      (from, to) =>
        db
          .from('conversations')
          .select(CONVERSATION_COLUMNS)
          .eq('workspace_id', workspaceId)
          .is('deleted_at', null)
          .not('needs_human_at', 'is', null)
          .not('status', 'in', '(closed,resolved)')
          .order('needs_human_at')
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: OutcomeConversation[] | null;
          error: unknown;
        }>
    ),
    db
      .from('workspace_subscriptions')
      .select('estado, prueba_hasta')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);
  if (subscription.error) throw subscription.error;
  const ids = new Set(
    activity.filter(isAiMessage).map((m) => m.conversation_id)
  );
  for (const r of reviews)
    if (r.verified_at >= range.start && r.verified_at < range.end)
      ids.add(r.conversation_id);
  const reviewMap = new Map(reviews.map((r) => [r.conversation_id, r]));
  const cases: OutcomeReport['cases'] = [];
  const list = [...ids];
  // Small IN lists avoid URL limits. Fetch full histories, never just the window:
  // a human reply last month must not become an AI-only resolution this month.
  for (let offset = 0; offset < list.length; offset += 100) {
    const batch = list.slice(offset, offset + 100);
    const [conversations, messages] = await Promise.all([
      allRows<OutcomeConversation>(
        (from, to) =>
          db
            .from('conversations')
            .select(CONVERSATION_COLUMNS)
            .eq('workspace_id', workspaceId)
            .is('deleted_at', null)
            .in('id', batch)
            .order('id')
            .range(from, to) as unknown as PromiseLike<{
            data: OutcomeConversation[] | null;
            error: unknown;
          }>
      ),
      allRows<OutcomeMessage>((from, to) =>
        db
          .from('messages')
          .select(MESSAGE_COLUMNS)
          .in('conversation_id', batch)
          .order('created_at')
          .order('id')
          .range(from, to)
      ),
    ]);
    const byConversation = new Map<string, OutcomeMessage[]>();
    for (const m of messages) {
      const group = byConversation.get(m.conversation_id) ?? [];
      group.push(m);
      byConversation.set(m.conversation_id, group);
    }
    for (const c of conversations) {
      const result = evaluateCase(
        c,
        byConversation.get(c.id) ?? [],
        reviewMap.get(c.id)
      );
      if (result) cases.push(result);
    }
  }
  cases.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {
    range,
    ...summarizeCases(cases),
    cases,
    pending: pending.map((c) => ({
      id: c.id,
      name: c.contacts?.name ?? null,
      channel: c.channel,
      reason: c.needs_human_reason,
      at: c.needs_human_at,
    })),
    trial:
      subscription.data?.estado === 'prueba'
        ? { until: subscription.data.prueba_hasta }
        : null,
  };
}

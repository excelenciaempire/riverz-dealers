import type { SupabaseClient } from '@supabase/supabase-js';
import { assertDashboardScope, visibleDashboardCases } from './access';
import { evaluateCase, summarizeCases, isAiMessage, type OutcomeConversation,
  type OutcomeMessage, type OutcomeReport, type OutcomeVerification } from './outcomes';

export async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 500_000; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error('dashboard_source_unavailable');
    if (!Array.isArray(data)) throw new Error('dashboard_source_unavailable');
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  throw new Error('dashboard_source_limit');
}
const CONVERSATION_COLUMNS = 'id,channel,status,needs_human_at,needs_human_reason,last_message_at,contacts(name)';
const MESSAGE_COLUMNS = 'id,conversation_id,sender_type,origin,status,created_at,deleted_at';

export async function readThread(db: SupabaseClient, workspaceId: string, id: string, actorId: string) {
  const visible = await visibleDashboardCases(db, workspaceId, actorId);
  if (!visible.has(id)) return null;
  const result = await db.from('conversations').select(CONVERSATION_COLUMNS).eq('workspace_id', workspaceId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (result.error) throw new Error('dashboard_source_unavailable');
  if (!result.data) return null;
  const messages = await allRows<OutcomeMessage>((from, to) => db.from('messages').select(MESSAGE_COLUMNS)
    .eq('conversation_id', id).order('created_at').order('id').range(from, to));
  await assertDashboardScope(db, workspaceId, actorId, visible);
  return evaluateCase(result.data as unknown as OutcomeConversation, messages);
}

export async function readOutcomes(db: SupabaseClient, workspaceId: string, range: { start: string; end: string }, actorId: string): Promise<OutcomeReport> {
  const start = Date.parse(range.start), end = Date.parse(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('invalid_dashboard_range');
  const visible = await visibleDashboardCases(db, workspaceId, actorId);
  const list = [...visible], cases: OutcomeReport['cases'] = [], pending: OutcomeReport['pending'] = [];
  // Entire visible histories preserve the conservative rule: an earlier human
  // reply cannot turn into an AI-only resolution when the reporting window moves.
  for (let offset = 0; offset < list.length; offset += 100) {
    const batch = list.slice(offset, offset + 100);
    const [conversations, messages, reviews] = await Promise.all([
      allRows<OutcomeConversation>((from, to) => db.from('conversations').select(CONVERSATION_COLUMNS).eq('workspace_id', workspaceId)
        .is('deleted_at', null).in('id', batch).order('id').range(from, to) as unknown as PromiseLike<{ data: OutcomeConversation[] | null; error: unknown }>),
      allRows<OutcomeMessage>((from, to) => db.from('messages').select(MESSAGE_COLUMNS).in('conversation_id', batch)
        .order('created_at').order('id').range(from, to)),
      allRows<OutcomeVerification>((from, to) => db.from('conversation_outcomes').select('conversation_id,last_message_id,category,verified_at')
        .eq('workspace_id', workspaceId).in('conversation_id', batch).order('conversation_id').range(from, to)),
    ]);
    const byCase = new Map<string, OutcomeMessage[]>(), reviewMap = new Map(reviews.map(r => [r.conversation_id, r]));
    for (const m of messages) {
      if (!batch.includes(m.conversation_id)) throw new Error('dashboard_source_unavailable');
      const group = byCase.get(m.conversation_id) ?? []; group.push(m); byCase.set(m.conversation_id, group);
    }
    for (const c of conversations) {
      if (!batch.includes(c.id)) throw new Error('dashboard_source_unavailable');
      if (c.needs_human_at && !['closed', 'resolved'].includes(c.status)) pending.push({ id: c.id, name: c.contacts?.name ?? null,
        channel: c.channel, reason: c.needs_human_reason, at: c.needs_human_at });
      const history = byCase.get(c.id) ?? [], review = reviewMap.get(c.id);
      const inWindow = (date: string) => { const time = Date.parse(date); return time >= start && time < end; };
      if (!history.some(m => !m.deleted_at && isAiMessage(m) && inWindow(m.created_at)) && !(review && inWindow(review.verified_at))) continue;
      const result = evaluateCase(c, history, review);
      if (result) cases.push(result);
    }
  }
  const subscription = await db.from('workspace_subscriptions').select('estado,prueba_hasta').eq('workspace_id', workspaceId).maybeSingle();
  if (subscription.error) throw new Error('dashboard_source_unavailable');
  await assertDashboardScope(db, workspaceId, actorId, visible);
  cases.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  pending.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.id.localeCompare(b.id));
  return { range, ...summarizeCases(cases), cases, pending,
    trial: subscription.data?.estado === 'prueba' ? { until: subscription.data.prueba_hasta } : null };
}

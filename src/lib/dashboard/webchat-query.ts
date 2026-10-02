import type { SupabaseClient } from '@supabase/supabase-js';
import { assertDashboardScope, visibleDashboardCases } from './access';
import { summarizeOrders, type SummaryOrder } from './order-summary';
import { firstResponseSamples, mediana, type Mensaje } from './servicio';
import { readOutcomes } from './outcomes-query';
import { summarizeCases } from './outcomes';

interface Conversation {
  id: string; status: string | null; assigned_agent_id: string | null;
  needs_human_at: string | null; csat: number | null; created_at: string;
}
interface Order extends SummaryOrder { id: string; conversation_id: string | null }

async function rows<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < 500_000; from += 1000) {
    const result = await make(from, from + 999);
    if (result.error || !Array.isArray(result.data)) throw new Error('dashboard_source_unavailable');
    all.push(...result.data);
    if (result.data.length < 1000) return all;
  }
  throw new Error('dashboard_source_limit');
}

/** Current case authority, complete metadata cohorts, and cached paid totals. */
export async function readWebchatStats(db: SupabaseClient, workspaceId: string, actorId: string, through: Date) {
  const end = through.toISOString();
  const start = new Date(through.getTime() - 30 * 86_400_000).toISOString();
  const previous = new Date(through.getTime() - 60 * 86_400_000).toISOString();
  const visible = await visibleDashboardCases(db, workspaceId, actorId);
  const ids = [...visible];
  const conversations: Conversation[] = [];
  const messages: Mensaje[] = [];
  const orders: Order[] = [];
  const orderPage = () => db.from('orders').select('id,total_price,currency,status,financial_status,conversation_id')
    .eq('workspace_id', workspaceId).eq('channel', 'webchat').gte('created_at', start).lt('created_at', end).order('id');
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const cohort = await rows<Conversation>((from, to) => db.from('conversations')
      .select('id,status,assigned_agent_id,needs_human_at,csat,created_at')
      .eq('workspace_id', workspaceId).eq('channel', 'webchat').is('deleted_at', null)
      .in('id', batch).gte('created_at', previous).lt('created_at', end).order('id').range(from, to));
    if (cohort.some(c => !batch.includes(c.id))) throw new Error('dashboard_source_unavailable');
    conversations.push(...cohort);
    const linkedOrders = await rows<Order>((from, to) => orderPage().in('conversation_id', batch).range(from, to));
    if (linkedOrders.some(o => !o.conversation_id || !batch.includes(o.conversation_id))) throw new Error('dashboard_source_unavailable');
    orders.push(...linkedOrders);
    const current = cohort.filter(c => c.created_at >= start).map(c => c.id);
    if (!current.length) continue;
    const evidence = await rows<Mensaje>((from, to) => db.from('messages')
      .select('conversation_id,sender_type,created_at,origin,status')
      .in('conversation_id', current).is('deleted_at', null).lt('created_at', end)
      .order('created_at').order('id').range(from, to));
    if (evidence.some(m => !m.conversation_id || !current.includes(m.conversation_id))) throw new Error('dashboard_source_unavailable');
    messages.push(...evidence);
  }
  const [unlinkedOrders, outcomeReport] = await Promise.all([
    rows<Order>((from, to) => orderPage().is('conversation_id', null).range(from, to)),
    readOutcomes(db, workspaceId, { start, end }, actorId),
  ]);
  if (unlinkedOrders.some(o => o.conversation_id !== null)) throw new Error('dashboard_source_unavailable');
  const totals = summarizeOrders([...orders, ...unlinkedOrders]);
  const current = conversations.filter(c => c.created_at >= start);
  const rated = current.filter(c => c.csat === 1 || c.csat === -1);
  const samples = firstResponseSamples(messages).map(s => s.seconds);
  const outcomes = summarizeCases(outcomeReport.cases.filter(c => c.channel === 'webchat'));
  await assertDashboardScope(db, workspaceId, actorId, visible);
  return {
    period_days: 30,
    conversations: current.length,
    conversations_previous: conversations.length - current.length,
    resolved: outcomes.verified,
    escalated: current.filter(c => Boolean(c.needs_human_at) || Boolean(c.assigned_agent_id)).length,
    orders: totals.cantidad,
    paid_orders: totals.pagados,
    excluded_orders: totals.excluidos,
    unavailable_amounts: totals.importes_no_disponibles,
    revenue: totals.facturado,
    currency: totals.moneda,
    revenue_by_currency: totals.por_moneda.map(g => ({ currency: g.moneda, amount: g.importe, orders: g.cantidad })),
    revenue_basis: totals.criterio,
    resolution_rate: outcomes.rate === null ? null : Math.round(outcomes.rate * 100),
    resolution_rate_previous: null,
    rated: rated.length,
    satisfaction_rate: rated.length ? Math.round(rated.filter(c => c.csat === 1).length / rated.length * 100) : null,
    first_response_seconds: mediana(samples),
    first_response_samples: samples.length,
    first_response_unavailable: current.length - samples.length,
    first_response_basis: 'first_customer_to_first_successful_reply_in_current_case_before_period_end',
  };
}

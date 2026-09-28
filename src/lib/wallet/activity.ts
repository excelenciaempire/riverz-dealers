import type { SupabaseClient } from '@supabase/supabase-js';
import { esConsumoCobrado, movimientosDelPeriodo, type MovimientoResumen, type Rango } from './movimientos';

export interface BilledActivity {
  contacts: number;
  charges: number;
  chargedCentavos: number;
  byChannel: Array<{ channel: string; contacts: number; charges: number; chargedCentavos: number }>;
}
type Conversation = { id: string; channel: string; contact_id: string | null };
const text = (value: unknown) => typeof value === 'string' && value ? value : null;
function conversationId(row: MovimientoResumen): string | null {
  return text(row.detalle?.conversacion) ?? text(row.detalle?.conversationId) ?? text(row.detalle?.conversation_id) ??
    (['conversation', 'conversacion'].includes(row.referencia_tipo ?? '') ? row.referencia_id ?? null : null);
}

/** A billed request isn't necessarily a sent message. Never infer delivery or
 * include an entire conversation merely because one request was paid. */
export function summarizeActivity(rows: MovimientoResumen[], conversations: Conversation[] = []): BilledActivity {
  const contacts = new Set<string>();
  const lookup = new Map(conversations.map(c => [c.id, c]));
  const channels = new Map<string, { contacts: Set<string>; charges: number; chargedCentavos: number }>();
  for (const row of rows.filter(esConsumoCobrado)) {
    const conversation = lookup.get(conversationId(row) ?? '');
    const channel = conversation?.channel ?? text(row.detalle?.canal) ?? text(row.detalle?.channel) ??
      (row.detalle?.superficie === 'panel' || ['ia_asistencia', 'ia_operador'].includes(row.concepto) ? 'panel' : 'unattributed');
    const group = channels.get(channel) ?? { contacts: new Set<string>(), charges: 0, chargedCentavos: 0 };
    channels.set(channel, group);
    group.charges++;
    group.chargedCentavos += -Number(row.centavos);
    if (conversation?.contact_id) {
      contacts.add(conversation.contact_id);
      group.contacts.add(conversation.contact_id);
    }
  }
  const byChannel = [...channels].map(([channel, g]) => ({ channel, contacts: g.contacts.size, charges: g.charges, chargedCentavos: g.chargedCentavos }))
    .sort((a, b) => b.chargedCentavos - a.chargedCentavos);
  return { contacts: contacts.size, charges: byChannel.reduce((n, c) => n + c.charges, 0), chargedCentavos: byChannel.reduce((n, c) => n + c.chargedCentavos, 0), byChannel };
}

export async function walletActivity(db: SupabaseClient, workspaceId: string, range: Rango, snapshot?: MovimientoResumen[]): Promise<BilledActivity> {
  const rows = (snapshot ?? await movimientosDelPeriodo(db, workspaceId, range)).filter(esConsumoCobrado).map(row => ({ ...row }));
  const operationIds = [...new Set(rows.filter(r => r.referencia_tipo === 'provider_operation' && r.referencia_id).map(r => r.referencia_id!))];
  const details = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < operationIds.length; i += 200) {
    const result = await db.from('wallet_operaciones').select('id, detalle').eq('workspace_id', workspaceId).in('id', operationIds.slice(i, i + 200));
    if (result.error) throw result.error;
    for (const row of result.data ?? []) details.set(row.id, row.detalle ?? {});
  }
  for (const row of rows) row.detalle = { ...details.get(row.referencia_id ?? ''), ...row.detalle };
  const ids = [...new Set(rows.map(conversationId).filter((id): id is string => !!id))];
  const conversations: Conversation[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const result = await db.from('conversations').select('id, channel, contact_id').eq('workspace_id', workspaceId).in('id', ids.slice(i, i + 200));
    if (result.error) throw result.error;
    conversations.push(...(result.data ?? []) as Conversation[]);
  }
  return summarizeActivity(rows, conversations);
}

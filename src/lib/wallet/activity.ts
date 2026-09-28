import type { SupabaseClient } from '@supabase/supabase-js';
import {
  esConsumoCobrado,
  movimientosDelPeriodo,
  type MovimientoResumen,
  type Rango,
} from './movimientos';

export interface BilledActivity {
  contacts: number;
  charges: number;
  chargedCentavos: number;
  byChannel: Array<{
    channel: string;
    contacts: number;
    charges: number;
    chargedCentavos: number;
  }>;
  /** Preserved separately: missing historical evidence is not a channel. */
  unrecorded?: {
    charges: number;
    chargedCentavos: number;
    firstAt: string;
    lastAt: string;
  };
}
type Conversation = { id: string; channel: string; contact_id: string | null };
const text = (value: unknown) =>
  typeof value === 'string' && value ? value : null;
function conversationId(row: MovimientoResumen): string | null {
  return (
    text(row.detalle?.conversacion) ??
    text(row.detalle?.conversationId) ??
    text(row.detalle?.conversation_id) ??
    reference(row, ['conversation', 'conversacion'])
  );
}
function reference(row: MovimientoResumen, types: string[]): string | null {
  return types.includes(row.referencia_tipo ?? '')
    ? text(row.referencia_id)
    : types.includes(text(row.detalle?.referenciaTipo) ?? '')
      ? text(row.detalle?.referenciaId)
      : null;
}

/** A billed request isn't necessarily a sent message. Never infer delivery or
 * include an entire conversation merely because one request was paid. */
export function summarizeActivity(
  rows: MovimientoResumen[],
  conversations: Conversation[] = []
): BilledActivity {
  const contacts = new Set<string>();
  const lookup = new Map(conversations.map((c) => [c.id, c]));
  const channels = new Map<
    string,
    { contacts: Set<string>; charges: number; chargedCentavos: number }
  >();
  let unrecorded: BilledActivity['unrecorded'];
  for (const row of rows.filter(esConsumoCobrado)) {
    const conversation = lookup.get(conversationId(row) ?? '');
    const channel =
      conversation?.channel ??
      text(row.detalle?.canal) ??
      text(row.detalle?.channel) ??
      (row.detalle?.superficie === 'panel' ||
      row.concepto === 'ia_operador'
        ? 'panel'
        : ['llamada_ia', 'llamada_voz', 'voz_stt', 'numero_telefono'].includes(
              row.concepto
            ) || text(row.detalle?.callId)
          ? 'calls'
          : 'unattributed');
    if (channel === 'unattributed') {
      unrecorded ??= {
        charges: 0,
        chargedCentavos: 0,
        firstAt: row.creado_en,
        lastAt: row.creado_en,
      };
      unrecorded.charges++;
      unrecorded.chargedCentavos += -Number(row.centavos);
      if (Date.parse(row.creado_en) < Date.parse(unrecorded.firstAt))
        unrecorded.firstAt = row.creado_en;
      if (Date.parse(row.creado_en) > Date.parse(unrecorded.lastAt))
        unrecorded.lastAt = row.creado_en;
    }
    const group = channels.get(channel) ?? {
      contacts: new Set<string>(),
      charges: 0,
      chargedCentavos: 0,
    };
    channels.set(channel, group);
    group.charges++;
    group.chargedCentavos += -Number(row.centavos);
    const contactId =
      conversation?.contact_id ?? text(row.detalle?.billingContactId);
    if (contactId) {
      contacts.add(contactId);
      group.contacts.add(contactId);
    }
  }
  const byChannel = [...channels]
    .map(([channel, g]) => ({
      channel,
      contacts: g.contacts.size,
      charges: g.charges,
      chargedCentavos: g.chargedCentavos,
    }))
    .sort((a, b) => b.chargedCentavos - a.chargedCentavos);
  return {
    contacts: contacts.size,
    charges: byChannel.reduce((n, c) => n + c.charges, 0),
    chargedCentavos: byChannel.reduce((n, c) => n + c.chargedCentavos, 0),
    byChannel,
    ...(unrecorded ? { unrecorded } : {}),
  };
}

export async function walletActivity(
  db: SupabaseClient,
  workspaceId: string,
  range: Rango,
  snapshot?: MovimientoResumen[]
): Promise<BilledActivity> {
  const rows = (
    snapshot ?? (await movimientosDelPeriodo(db, workspaceId, range))
  )
    .filter(esConsumoCobrado)
    .map((row) => ({ ...row }));
  const operationIds = [
    ...new Set(
      rows
        .filter(
          (r) => r.referencia_tipo === 'provider_operation' && r.referencia_id
        )
        .map((r) => r.referencia_id!)
    ),
  ];
  const details = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < operationIds.length; i += 200) {
    const result = await db
      .from('wallet_operaciones')
      .select('id, detalle')
      .eq('workspace_id', workspaceId)
      .in('id', operationIds.slice(i, i + 200));
    if (result.error) throw result.error;
    for (const row of result.data ?? []) details.set(row.id, row.detalle ?? {});
  }
  for (const row of rows)
    row.detalle = { ...details.get(row.referencia_id ?? ''), ...row.detalle };
  // Exact foreign-key evidence only. Never match a charge to a nearby message
  // by timestamp, amount, model or the workspace's most popular channel.
  const contactIds = [
    ...new Set(
      rows
        .map(
          (row) =>
            reference(row, ['contact', 'contacto']) ??
            text(row.detalle?.contactId)
        )
        .filter((id): id is string => !!id)
    ),
  ];
  for (let i = 0; i < contactIds.length; i += 200) {
    const result = await db
      .from('contacts')
      .select('id, channel')
      .eq('workspace_id', workspaceId)
      .in('id', contactIds.slice(i, i + 200));
    if (result.error) throw result.error;
    const contacts = new Map((result.data ?? []).map((c) => [c.id, c]));
    for (const row of rows) {
      const contact = contacts.get(
        reference(row, ['contact', 'contacto']) ??
          text(row.detalle?.contactId) ??
          ''
      );
      if (contact)
        row.detalle = {
          ...row.detalle,
          canal: text(row.detalle?.canal) ?? contact.channel,
          billingContactId: contact.id,
        };
    }
  }
  const callIds = [
    ...new Set(
      rows
        .map(
          (row) => reference(row, ['voice_call']) ?? text(row.detalle?.callId)
        )
        .filter((id): id is string => !!id)
    ),
  ];
  for (let i = 0; i < callIds.length; i += 200) {
    const result = await db
      .from('voice_calls')
      .select('id, contact_id')
      .eq('workspace_id', workspaceId)
      .in('id', callIds.slice(i, i + 200));
    if (result.error) throw result.error;
    const calls = new Map((result.data ?? []).map((c) => [c.id, c]));
    for (const row of rows) {
      const call = calls.get(
        reference(row, ['voice_call']) ?? text(row.detalle?.callId) ?? ''
      );
      if (call)
        row.detalle = {
          ...row.detalle,
          canal: 'calls',
          billingContactId: call.contact_id,
        };
    }
  }
  const postIds = [
    ...new Set(
      rows
        .map((row) => reference(row, ['publicacion', 'publication']))
        .filter((id): id is string => !!id)
    ),
  ];
  for (let i = 0; i < postIds.length; i += 200) {
    const result = await db
      .from('publicacion_contexto')
      .select('external_id, channel')
      .eq('workspace_id', workspaceId)
      .in('external_id', postIds.slice(i, i + 200));
    if (result.error) throw result.error;
    const posts = new Map<string, string | null>();
    for (const post of result.data ?? []) {
      // External IDs can overlap across networks. An ambiguous reference is
      // not evidence for whichever database row happens to come last.
      if (posts.has(post.external_id) && posts.get(post.external_id) !== post.channel)
        posts.set(post.external_id, null);
      else if (!posts.has(post.external_id)) posts.set(post.external_id, post.channel);
    }
    for (const row of rows) {
      const channel = posts.get(
        reference(row, ['publicacion', 'publication']) ?? ''
      );
      if (channel) row.detalle = { ...row.detalle, canal: text(row.detalle?.canal) ?? text(row.detalle?.channel) ?? channel };
    }
  }
  const ids = [
    ...new Set(rows.map(conversationId).filter((id): id is string => !!id)),
  ];
  const conversations: Conversation[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const result = await db
      .from('conversations')
      .select('id, channel, contact_id')
      .eq('workspace_id', workspaceId)
      .in('id', ids.slice(i, i + 200));
    if (result.error) throw result.error;
    conversations.push(...((result.data ?? []) as Conversation[]));
  }
  return summarizeActivity(rows, conversations);
}

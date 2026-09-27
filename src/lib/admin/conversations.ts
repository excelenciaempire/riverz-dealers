import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertMetadataOnly } from './pii';
import { workspaceNames } from './queries';

/**
 * Todas las conversaciones de la plataforma, por comercio.
 *
 * Hasta acá el panel podía ver cuántas conversaciones tenía cada cuenta y nada
 * más: para entender por qué un comercio dice que «la IA no contesta» había que
 * entrar a su cuenta. Esto lo contesta desde afuera — qué canal, quién la tiene,
 * si la IA está prendida ahí, cuántos mensajes lleva y cuándo fue el último.
 *
 * **Sin una sola palabra de lo que se dijeron.** El cuerpo de un mensaje, el
 * nombre y el teléfono del comprador siguen del otro lado de la barrera: son
 * datos de los clientes DE un comercio, que nunca aceptaron nada con Riverz.
 * `assertMetadataOnly` lo hace fallar ruidosamente si alguien pide una de esas
 * columnas, en vez de recortarla en silencio.
 */

export interface AdminConversationRow {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  channel: string;
  status: string | null;
  /** Si la IA está habilitada en ESTE hilo. */
  ai_enabled: boolean;
  assigned_agent_id: string | null;
  needs_human: boolean;
  messages_count: number;
  created_at: string;
  last_message_at: string | null;
}

export interface AdminConversationFilters {
  workspaceId?: string;
  channel?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

const COLUMNAS =
  'id, workspace_id, channel, status, ai_enabled, assigned_agent_id, needs_human_reason, created_at, last_message_at';

export async function listConversations(
  f: AdminConversationFilters,
): Promise<{ rows: AdminConversationRow[]; total: number }> {
  const db = supabaseAdmin();
  assertMetadataOnly('conversations', COLUMNAS);

  const limit = Math.min(f.limit ?? 100, 300);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = db
    .from('conversations')
    .select(COLUMNAS, { count: 'exact' })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(f.offset ?? 0, (f.offset ?? 0) + limit - 1);

  if (f.workspaceId) q = q.eq('workspace_id', f.workspaceId);
  if (f.channel) q = q.eq('channel', f.channel);
  if (f.status) q = q.eq('status', f.status);

  const { data, count, error } = await q;
  if (error) throw new Error(`[admin/conversations] ${error.message}`);

  const filas = (data ?? []) as Array<
    Omit<AdminConversationRow, 'workspace_name' | 'messages_count' | 'needs_human'> & {
      needs_human_reason: string | null;
    }
  >;

  // Los nombres de comercio y el conteo de mensajes van en dos consultas más y
  // no en un join por fila: con trescientas conversaciones, un join por fila son
  // trescientas consultas.
  const nombres = await workspaceNames([...new Set(filas.map((r) => r.workspace_id))]);

  const conteos = new Map<string, number>();
  if (filas.length > 0) {
    assertMetadataOnly('messages', 'conversation_id');
    const { data: msgs, error: messagesError } = await db
      .from('messages')
      .select('conversation_id')
      .in(
        'conversation_id',
        filas.map((r) => r.id),
      )
      .limit(50_000);
    if (messagesError) throw new Error(`[admin/conversations] ${messagesError.message}`);
    for (const m of (msgs ?? []) as { conversation_id: string }[]) {
      conteos.set(m.conversation_id, (conteos.get(m.conversation_id) ?? 0) + 1);
    }
  }

  return {
    rows: filas.map((r) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      channel: r.channel,
      status: r.status,
      ai_enabled: r.ai_enabled,
      assigned_agent_id: r.assigned_agent_id,
      needs_human: r.needs_human_reason !== null,
      created_at: r.created_at,
      last_message_at: r.last_message_at,
      workspace_name: nombres.get(r.workspace_id) ?? null,
      messages_count: conteos.get(r.id) ?? 0,
    })),
    total: count ?? filas.length,
  };
}

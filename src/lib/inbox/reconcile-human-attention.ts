import type { SupabaseClient } from '@supabase/supabase-js';

export interface AttentionMessage {
  id: string;
  created_at: string;
  sender_type: string;
  origin?: string | null;
  status?: string | null;
  content_text?: string | null;
  deleted_at?: string | null;
  held_for_quality?: boolean | null;
}

export function isSimpleClosure(text: string | null | undefined): boolean {
  const normalized = (text ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:ok|okay|genial|perfecto|perfect|excelente|excellent|bien|dale|listo) ?)?(?:(?:muchas|mil|muchisimas) )?gracias(?: por (?:todo|responderme|la ayuda))?$/.test(normalized) ||
    /^(?:ok|okay|genial|perfecto|perfect|excelente|excellent|listo|thanks|thank you|thank you very much)$/.test(normalized) ||
    /^(?:👍|🙏|❤️|💛)[\s!]*$/u.test((text ?? '').trim());
}

/** Only an actual answer, followed by acknowledgements (not new requests),
 * proves resolution. Automations and mere promises to involve a person do not. */
export function hasResolutionEvidence(at: string | null, messages: AttentionMessage[]): boolean {
  if (!at || !Number.isFinite(Date.parse(at))) return false;
  const ordered = [...messages].filter(m => !m.deleted_at && m.status !== 'failed')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
  let customerClosed = false;
  for (const message of ordered) {
    if (Date.parse(message.created_at) < Date.parse(at)) return false;
    if (message.sender_type === 'customer') {
      if (!isSimpleClosure(message.content_text)) return false;
      customerClosed = true;
      continue;
    }
    if (message.origin === 'automation') continue;
    if (!['sent', 'delivered', 'read'].includes(message.status ?? '') ||
        (message.held_for_quality && message.status === 'sent')) return false;
    if (message.sender_type === 'agent' && (!message.origin || message.origin === 'manual')) {
      // Older comment-to-DM mirrors were stored without an origin. They are
      // not evidence that a person handled a private order/payment complaint.
      if (/^(?:Vi tu comentario|I saw your comment)\s*:/i.test(message.content_text ?? '')) return false;
      return true;
    }
    if (!customerClosed || message.origin !== 'ai_agent') return false;
    const text = message.content_text ?? '';
    // An acknowledgement of a handoff is not completion of the underlying task.
    if (/\b(?:persona|humano|equipo|team|human|person|refund|reembolso|devolucion|devolución|comprobante|receipt)\b/i.test(text)) return false;
    return /(?:figura pagad[oa]|ya (?:esta|está|quedó|quedo) (?:pagad[oa]|confirmad[oa]|resuelto)|qued[oó] todo en orden|problema (?:esta |está )?resuelto|payment (?:is )?confirmed|(?:has been|is now) resolved)/i.test(text);
  }
  return false;
}

/** Compare-and-set the alert AND conversation revision. Never toggle the
 * assistant, assign a person, close a chat, or send a customer message. */
export async function reconcileHumanAttention(db: SupabaseClient, conversationId: string): Promise<boolean> {
  try {
    const snapshot = await db.from('conversations')
      .select('id,needs_human_reason,needs_human_at,last_message_at,updated_at')
      .eq('id', conversationId).maybeSingle();
    const conversation = snapshot.data;
    if (snapshot.error || !conversation?.needs_human_reason || !conversation.needs_human_at || !conversation.updated_at) return false;
    const history = await db.from('messages')
      .select('id,created_at,sender_type,origin,status,content_text,deleted_at,held_for_quality')
      .eq('conversation_id', conversationId).is('deleted_at', null)
      .neq('status', 'failed').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(40);
    if (history.error || !hasResolutionEvidence(conversation.needs_human_at, history.data ?? [])) return false;
    // Recheck messages as well: ingestion can insert a message before updating
    // the conversation's last_message_at. Failed/deleted messages do not count.
    const latest = await db.from('messages').select('id').eq('conversation_id', conversationId)
      .is('deleted_at', null).neq('status', 'failed')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
    if (latest.error || latest.data?.id !== history.data?.[0]?.id) return false;
    let update = db.from('conversations').update({
      needs_human_reason: null, needs_human_at: null, needs_human_summary: null,
      needs_human_visto_at: null, needs_human_avisado_at: null, updated_at: new Date().toISOString(),
    }).eq('id', conversationId).eq('needs_human_at', conversation.needs_human_at)
      .eq('needs_human_reason', conversation.needs_human_reason).eq('updated_at', conversation.updated_at);
    update = conversation.last_message_at ? update.eq('last_message_at', conversation.last_message_at) : update.is('last_message_at', null);
    const result = await update.select('id');
    if (result.error) return false;
    return Boolean(result.data?.length);
  } catch { return false; }
}

/** Sixteen deterministic shards avoid repeatedly checking only the first old
 * alerts. The existing five-minute self-heal job visits each shard in 80 min;
 * incoming acknowledgements are reconciled immediately by the inbox writer. */
export async function healResolvedHumanAttention(db: SupabaseClient, now = new Date()) {
  const shard = Math.floor(now.getTime() / 300_000) % 16;
  const prefix = shard.toString(16);
  const query = db.from('conversations').select('id')
    .not('needs_human_reason', 'is', null).is('deleted_at', null)
    .gte('id', `${prefix}0000000-0000-0000-0000-000000000000`)
    .lte('id', `${prefix}fffffff-ffff-ffff-ffff-ffffffffffff`).order('id').limit(1000);
  const { data, error } = await query;
  if (error) return { checked: 0, resolved: 0, error: error.code };
  let resolved = 0;
  for (let offset = 0; offset < (data?.length ?? 0); offset += 5) {
    const results = await Promise.all(data!.slice(offset, offset + 5).map(row => reconcileHumanAttention(db, row.id)));
    resolved += results.filter(Boolean).length;
  }
  return { checked: data?.length ?? 0, resolved, shard, truncated: data?.length === 1000 };
}

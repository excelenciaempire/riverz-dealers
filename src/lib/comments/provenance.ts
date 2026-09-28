import type { SupabaseClient } from '@supabase/supabase-js';
import { briefDePublicacionPorOrigen } from '@/lib/channels/publicacion';

export interface CommentSource {
  messageId: string;
  conversationId: string;
  createdAt: string;
  text: string;
  postId: string;
  channel: 'ig_comment' | 'fb_comment' | 'tiktok_comment';
  connectionId: string | null;
  permalink: string | null;
  caption: string | null;
}

/** Tenant-bound exact FK only. Never infer a post from a grouped thread. */
export async function loadCommentSource(db: SupabaseClient, workspaceId: string, id: string): Promise<CommentSource | null> {
  const { data: m } = await db.from('messages')
    .select('id, conversation_id, created_at, content_text, channel, conversations!inner(workspace_id, deleted_at)')
    .eq('id', id).eq('conversations.workspace_id', workspaceId)
    .is('conversations.deleted_at', null).is('deleted_at', null).maybeSingle();
  if (!m || !['ig_comment', 'fb_comment', 'tiktok_comment'].includes(m.channel)) return null;
  const { data: meta } = await db.from('comments_meta')
    .select('post_id, connection_id, permalink').eq('message_id', m.id).maybeSingle();
  if (!meta?.post_id) return null;
  const { data: cached } = await db.from('publicacion_contexto').select('titulo, cuerpo')
    .eq('workspace_id', workspaceId).eq('channel', m.channel).eq('external_id', meta.post_id).maybeSingle();
  return { messageId: m.id, conversationId: m.conversation_id, createdAt: m.created_at,
    text: m.content_text ?? '', postId: meta.post_id, channel: m.channel,
    connectionId: meta.connection_id, permalink: safePostLink(meta.permalink),
    caption: cached?.cuerpo ?? cached?.titulo ?? null };
}

export function safePostLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && /(^|\.)(instagram\.com|facebook\.com|tiktok\.com)$/.test(u.hostname)
      ? u.href : null;
  } catch { return null; }
}

/** The exact inbound comment, or the latest linked origin of a private conversation. */
export async function commentBriefForTurn(db: SupabaseClient, workspaceId: string, conversationId: string, inboundId?: string): Promise<string | null> {
  const { data: conv } = await db.from('conversations').select('channel')
    .eq('id', conversationId).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle();
  if (!conv) return null;
  let sourceId = inboundId;
  const privateThread = conv.channel === 'instagram' || conv.channel === 'messenger';
  if (privateThread) {
    const { data: linked } = await db.from('messages').select('reply_to_message_id')
      .eq('conversation_id', conversationId).in('origin', ['comment_inbound', 'comment_ai'])
      .not('reply_to_message_id', 'is', null).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    sourceId = linked?.reply_to_message_id;
  } else if (!sourceId && ['ig_comment', 'fb_comment', 'tiktok_comment'].includes(conv.channel)) {
    // Manual drafting has no inbound id. Use the most recent real inbound
    // comment, never the first publication stored on the grouped thread.
    const { data: latest } = await db.from('messages').select('id')
      .eq('conversation_id', conversationId).eq('sender_type', 'customer')
      .is('deleted_at', null).order('created_at', { ascending: false })
      .order('id', { ascending: false }).limit(1).maybeSingle();
    sourceId = latest?.id;
  }
  if (!sourceId) return null;
  const source = await loadCommentSource(db, workspaceId, sourceId);
  if (!source || (!privateThread && source.conversationId !== conversationId)) return null;
  const brief = await briefDePublicacionPorOrigen(db, { workspaceId, channel: source.channel,
    postId: source.postId, connectionId: source.connectionId });
  return brief ? `${privateThread ? 'Origen histórico del privado. No reemplaza la consulta actual; si ya compró o reclama, no reinicies una venta.\n' : ''}${brief}` : null;
}

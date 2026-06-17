import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { igCommentAdapter } from '@/lib/channels/ig_comment/adapter';
import type { InstagramCampaign } from './types';

/**
 * Responde públicamente a los comentarios de alta intención de la audiencia
 * (moderación de comentarios estilo Blueberry): publica `plan.comment_reply`
 * como respuesta al comentario de origen para mover la conversación al DM
 * privado.
 *
 * Usa el id real del comentario (messages.message_id del evento ig_comment) y
 * la conexión de Instagram del workspace (la conexión ig_comment comparte el
 * page access token; si no existe una fila ig_comment, cae a la de instagram).
 *
 * Idempotente: solo responde a destinatarios cuyo comment_replied_at es null.
 * Service-role: el cron no tiene sesión.
 */
export async function replyToComments(
  db: SupabaseClient,
  campaign: Pick<InstagramCampaign, 'id' | 'workspace_id' | 'plan'>,
  limit = 25,
): Promise<{ replied: number; failed: number; skipped?: string }> {
  const text = campaign.plan.comment_reply?.trim();
  if (!text) return { replied: 0, failed: 0, skipped: 'no_comment_reply' };

  const connection = await loadCommentConnection(db, campaign.workspace_id);
  if (!connection) {
    return { replied: 0, failed: 0, skipped: 'instagram_not_connected' };
  }

  // Destinatarios cuyo contacto es comentarista y aún sin respuesta pública.
  const { data: recipients } = await db
    .from('instagram_campaign_recipients')
    .select('id, contact_id, contacts(channel)')
    .eq('campaign_id', campaign.id)
    .is('comment_replied_at', null)
    .eq('is_spam', false)
    .not('contact_id', 'is', null)
    .limit(limit * 3);

  type Row = {
    id: string;
    contact_id: string;
    contacts: { channel: string | null } | { channel: string | null }[] | null;
  };
  const rows = (recipients ?? []) as unknown as Row[];
  const commenters = rows
    .filter((r) => {
      const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
      return c?.channel === 'ig_comment';
    })
    .slice(0, limit);
  if (commenters.length === 0) return { replied: 0, failed: 0 };

  let replied = 0;
  let failed = 0;

  for (const r of commenters) {
    const commentId = await latestCommentId(db, r.contact_id);
    if (!commentId) continue; // sin comentario rastreable: lo cubre el DM

    try {
      const result = await igCommentAdapter.sendText({
        channel: 'ig_comment',
        connection,
        conversation: { id: '', thread_external_id: commentId } as unknown as Conversation,
        contact: { id: r.contact_id } as unknown as Contact,
        text,
        replyToExternalId: commentId,
      } satisfies OutboundText);

      await db
        .from('instagram_campaign_recipients')
        .update({
          comment_replied_at: new Date().toISOString(),
          comment_reply_external_id: result.externalMessageId ?? null,
        })
        .eq('id', r.id);
      replied += 1;
    } catch {
      failed += 1;
    }
  }

  return { replied, failed };
}

/** Conexión para responder comentarios: prefiere ig_comment, cae a instagram. */
async function loadCommentConnection(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ChannelConnection | null> {
  for (const channel of ['ig_comment', 'instagram'] as const) {
    const { data } = await db
      .from('channel_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as ChannelConnection;
  }
  return null;
}

/** Id del comentario más reciente del contacto (messages.message_id ig_comment). */
async function latestCommentId(
  db: SupabaseClient,
  contactId: string,
): Promise<string | null> {
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('channel', 'ig_comment');
  const convIds = (convs ?? []).map((c) => (c as { id: string }).id);
  if (convIds.length === 0) return null;

  const { data: msgs } = await db
    .from('messages')
    .select('message_id')
    .in('conversation_id', convIds)
    .eq('sender_type', 'customer')
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const top = (msgs ?? [])[0] as { message_id: string | null } | undefined;
  return top?.message_id ?? null;
}

import { getAdapter } from '@/lib/channels/registry';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { assertStoredConnectionCanSend } from '@/lib/channels/send-guard';
import { humanizarTexto } from '@/lib/ai/estilo-humano';
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
  // La escribió el modelo cuando armó el plan: se limpia acá, que es donde se
  // publica, para que abajo de la foto no aparezcan asteriscos ni rayas.
  const text = humanizarTexto(campaign.plan.comment_reply);
  if (!text) return { replied: 0, failed: 0, skipped: 'no_comment_reply' };

  // Fallback cuando el comentario no trae conexión rastreable; cada respuesta
  // intenta primero la conexión de SU conversación (multi-cuenta correcto).
  const fallback = await loadCommentConnection(db, campaign.workspace_id);
  if (!fallback) {
    return { replied: 0, failed: 0, skipped: 'instagram_not_connected' };
  }
  const connCache = new Map<string, ChannelConnection>();

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
    const found = await latestComment(db, r.contact_id);
    if (!found) continue; // sin comentario rastreable: lo cubre el DM
    const { commentId, connectionId } = found;

    // La cuenta que POSEE el comentario: la conexión de su conversación.
    let connection = fallback;
    if (connectionId) {
      const cached = connCache.get(connectionId);
      if (cached) {
        connection = cached;
      } else {
        const { data: cRow } = await db
          .from('channel_connections')
          .select('*')
          .eq('id', connectionId)
          .maybeSingle();
        if ((cRow as ChannelConnection | null)?.status === 'disconnected') {
          failed += 1;
          continue;
        }
        if (cRow) {
          connection = cRow as ChannelConnection;
          connCache.set(connectionId, connection);
        }
      }
    }

    try {
      await assertStoredConnectionCanSend(db, connection.id);
      const result = await getAdapter('ig_comment').sendText({
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
    } catch (err) {
      failed += 1;
      // Don't swallow it — the usual cause is Meta Advanced Access not being
      // approved for instagram_manage_comments (works for the owner's own
      // app-role account, fails for other merchants until App Review). Log the
      // reason so it's diagnosable instead of a silent "0 replied".
      console.warn(
        `[ig-agent] public comment reply failed (comment ${commentId}):`,
        err instanceof Error ? err.message : String(err),
      );
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
      .neq('status', 'disconnected')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as ChannelConnection;
  }
  return null;
}

/** Comentario más reciente del contacto (messages.message_id ig_comment) +
 *  la conexión de su conversación (la cuenta que posee el comentario). */
async function latestComment(
  db: SupabaseClient,
  contactId: string,
): Promise<{ commentId: string; connectionId: string | null } | null> {
  const { data: convs } = await db
    .from('conversations')
    .select('id, connection_id')
    .eq('contact_id', contactId)
    .eq('channel', 'ig_comment');
  const convRows = (convs ?? []) as Array<{ id: string; connection_id: string | null }>;
  if (convRows.length === 0) return null;
  const connByConv = new Map(convRows.map((c) => [c.id, c.connection_id]));

  const { data: msgs } = await db
    .from('messages')
    .select('message_id, conversation_id, comments_meta(connection_id)')
    .in('conversation_id', convRows.map((c) => c.id))
    .eq('sender_type', 'customer')
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const top = (msgs ?? [])[0] as
    | {
        message_id: string | null;
        conversation_id: string | null;
        comments_meta:
          | { connection_id: string | null }
          | { connection_id: string | null }[]
          | null;
      }
    | undefined;
  if (!top?.message_id) return null;
  // Prefer the comment's OWN connection (migration 117) — the account that
  // actually received it. Fall back to the conversation's connection only if
  // the per-comment stamp is missing (comments ingested before 117).
  const meta = Array.isArray(top.comments_meta) ? top.comments_meta[0] : top.comments_meta;
  const ownConnectionId = meta?.connection_id ?? null;
  const convConnectionId = top.conversation_id
    ? (connByConv.get(top.conversation_id) ?? null)
    : null;
  return {
    commentId: top.message_id,
    connectionId: ownConnectionId ?? convConnectionId,
  };
}

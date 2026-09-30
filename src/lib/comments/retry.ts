import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation, Message } from '@/types';
import { findMessageByExternalId } from '@/lib/channels/message-lookup';
import { syncExternalReplies } from '@/lib/billing/external-replies';
import { withRecoverySendGuard } from '@/lib/billing/recovery-send-guard';
import { workspaceReadOnly } from '@/lib/billing/read-only';
import { motorApagado } from '@/lib/workspaces/motor';
import { loadCommentSettings } from '@/lib/instagram-agent/controls';
import type { CommentChannel } from './hilo';
import { puertaDeIa } from '@/lib/wallet/puerta';

export function recoverableCommentFailure(reason: string): boolean {
  return ['comment_error', 'comment_no_se_pudo_publicar', 'comment_sin_saldo'].includes(reason);
}

export async function queueCommentRetry(db: SupabaseClient, args: {
  workspaceId: string; channel: CommentChannel; commentId: string; reason: string;
}) {
  if (!recoverableCommentFailure(args.reason) || args.channel === 'tiktok_comment') return;
  const inbound = await findMessageByExternalId<{ id: string; conversation_id: string }>(db, {
    workspaceId: args.workspaceId, channel: args.channel, externalMessageId: args.commentId,
    select: 'id,conversation_id',
  });
  if (!inbound) throw new Error('comment_retry_inbound_unavailable');
  const result = await db.from('comment_reply_retries').upsert({ inbound_message_id: inbound.id,
    conversation_id: inbound.conversation_id, workspace_id: args.workspaceId, reason: args.reason },
  { onConflict: 'inbound_message_id', ignoreDuplicates: true });
  if (result.error) throw new Error('comment_retry_queue_unavailable');
}

type RetryJob = { inbound_message_id: string; workspace_id: string; conversation_id: string;
  lease_id: string; attempts: number; };

function disposition(c: Conversation): string | null {
  if (c.deleted_at || c.status === 'closed') return 'case_closed';
  if (c.is_spam) return 'case_moderated';
  if (c.ai_enabled === false || c.assigned_agent_id) return 'human_ownership';
  return null;
}

/** One leased comment per cron. Verify Meta first; recover only its public reply. */
export async function retryFailedComments(db: SupabaseClient) {
  const claimed = await db.rpc('claim_comment_reply_retry');
  if (claimed.error) throw new Error('comment_retry_claim_unavailable');
  const job = claimed.data?.[0] as RetryJob | undefined;
  if (!job) return { attempted: 0, recovered: 0 };
  async function finish(outcome: string, again = false, defer = false) {
    const status = defer ? 'pending' : again ? job!.attempts < 3 ? 'pending' : 'review' : 'done';
    const result = await db.from('comment_reply_retries').update({ status, outcome, lease_id: null, lease_until: null,
      ...(defer ? { attempts: Math.max(0, job!.attempts - 1) } : {}),
      next_attempt_at: new Date(Date.now() + 120000 * 2 ** job!.attempts).toISOString(),
      ...(status !== 'pending' ? { finished_at: new Date().toISOString() } : {}) })
      .eq('inbound_message_id', job!.inbound_message_id).eq('lease_id', job!.lease_id);
    if (result.error) throw new Error('comment_retry_result_unavailable');
    if (status === 'review') await db.from('conversations').update({ needs_human_reason: 'ia_caida',
      needs_human_at: new Date().toISOString() }).eq('id', job!.conversation_id)
      .eq('workspace_id', job!.workspace_id).is('needs_human_reason', null);
  }
  try {
    if (await workspaceReadOnly(db, job.workspace_id) || await motorApagado(db, job.workspace_id)) {
      await finish('workspace_paused', true, true); return { attempted: 1, recovered: 0 };
    }
    const row = await db.from('conversations').select('*').eq('id', job.conversation_id)
      .eq('workspace_id', job.workspace_id).single();
    if (row.error) throw new Error('comment_retry_case_unavailable');
    const conversation = row.data as Conversation;
    const stopped = disposition(conversation);
    if (stopped) { await finish(stopped); return { attempted: 1, recovered: 0 }; }
    const cfg = await loadCommentSettings(db, job.workspace_id);
    if (!cfg.publicReply || !(conversation.channel === 'fb_comment' ? cfg.facebook : cfg.instagram)) {
      await finish('public_replies_disabled'); return { attempted: 1, recovered: 0 };
    }
    if (!(await puertaDeIa(db, job.workspace_id)).puede) {
      await finish('ia_balance_paused', true, true); return { attempted: 1, recovered: 0 };
    }
    const [message, metadata, person] = await Promise.all([
      db.from('messages').select('*').eq('id', job.inbound_message_id).eq('conversation_id', conversation.id).single(),
      db.from('comments_meta').select('*').eq('message_id', job.inbound_message_id).single(),
      db.from('contacts').select('*').eq('id', conversation.contact_id).eq('workspace_id', job.workspace_id).single(),
    ]);
    if (message.error || metadata.error || person.error) throw new Error('comment_retry_context_unavailable');
    const inbound = message.data as Message, contact = person.data as Contact;
    // Visibility belongs to the source comment, not the contact's newest post.
    if (inbound.is_hidden) {
      await finish('comment_moderated'); return { attempted: 1, recovered: 0 };
    }
    if (!inbound.message_id || inbound.deleted_at || !inbound.content_text || inbound.content_text === '[deleted]') {
      await finish('comment_deleted'); return { attempted: 1, recovered: 0 };
    }
    const conn = await db.from('channel_connections').select('*').eq('workspace_id', job.workspace_id)
      .eq('id', metadata.data.connection_id ?? conversation.connection_id).single();
    if (conn.error || conn.data.status === 'disconnected') throw new Error('comment_retry_connection_unavailable');
    const connection = conn.data as ChannelConnection;
    const external = await syncExternalReplies(db, { connection, conversation, contact, inbound, comment: metadata.data });
    if (external?.publicCommentAnswered) {
      await finish('already_answered_on_meta'); return { attempted: 1, recovered: 0 };
    }
    const fresh = await db.from('conversations').select('*').eq('id', conversation.id)
      .eq('workspace_id', job.workspace_id).single();
    if (fresh.error) throw new Error('comment_retry_case_unavailable');
    if (disposition(fresh.data as Conversation)) { await finish('case_changed'); return { attempted: 1, recovered: 0 }; }
    const { replyToComment } = await import('@/lib/instagram-agent/realtime');
    const result = await withRecoverySendGuard({ conversationId: conversation.id,
      inboundId: inbound.id, createdAt: inbound.created_at, commentId: inbound.message_id }, () => replyToComment(db, {
      workspaceId: job.workspace_id, contact: { id: contact.id, name: contact.name ?? null, external_id: contact.external_id ?? null },
      commentChannel: conversation.channel as CommentChannel, connection, commentId: inbound.message_id,
      sourcePostId: metadata.data.post_id, engagementText: inbound.content_text ?? null, publicOnly: true,
    }));
    if (result) { await finish(result, recoverableCommentFailure(result)); return { attempted: 1, recovered: 0 }; }
    const confirmed = await syncExternalReplies(db, { connection, conversation, contact, inbound, comment: metadata.data });
    if (!confirmed?.publicCommentAnswered) throw new Error('comment_retry_delivery_unverified');
    await finish('public_reply_verified'); return { attempted: 1, recovered: 1 };
  } catch (error) {
    await finish(error instanceof Error ? error.message : 'comment_retry_failed', true);
    return { attempted: 1, recovered: 0 };
  }
}

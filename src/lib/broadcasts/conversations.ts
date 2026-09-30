import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Open (or reuse) a WhatsApp conversation in the unified inbox for a
 * broadcast recipient and record the template send as an outbound message.
 *
 * Powers the "crear conversaciones en la Bandeja" campaign toggle: after a
 * template goes out, the recipient shows up as a thread agents can follow up
 * on. Best-effort — callers wrap it so a failure here never aborts the send.
 *
 * Works with either the browser client (RLS, user owns the rows) or the
 * service-role admin client (cron). Conversation columns connection_id /
 * workspace_id are nullable (migration 013), so a missing WhatsApp channel
 * connection is fine.
 */
export async function recordBroadcastConversation(
  db: SupabaseClient,
  args: {
    contactId: string;
    workspaceId: string | null;
    connectionId: string | null;
    templateName: string;
    bodyPreview: string;
    whatsappMessageId: string | null;
    /** Nombre de la campaña, para que la bandeja diga CUÁL fue (migración 143). */
    broadcastName?: string | null;
  },
): Promise<void> {
  const {
    contactId,
    workspaceId,
    connectionId,
    templateName,
    bodyPreview,
    whatsappMessageId,
  } = args;

  // Replaying a confirmed receipt repairs recording after a crash without moving
  // an already recorded message out of its original (even closed) thread.
  if (whatsappMessageId && workspaceId) {
    const recorded = await db.from('messages')
      .select('id,conversation:conversations!inner(workspace_id,contact_id)')
      .eq('message_id', whatsappMessageId)
      .eq('conversation.workspace_id', workspaceId)
      .eq('conversation.contact_id', contactId).limit(1);
    if (recorded.error) throw new Error('broadcast_conversation_unavailable');
    if (recorded.data?.length) return;
  }

  // Find an existing open WhatsApp conversation for this contact, else create.
  // Soft-delete (migración 085): never reuse a thread the user deleted from
  // the bandeja — without this filter the send would land in an invisible
  // (deleted) row, or, when that row is `closed`, slip past `.neq(status)` and
  // resurrect the contact as a fresh live thread. Skipping deleted rows makes
  // the broadcast open a new VISIBLE thread instead, matching findOrCreate.
  let query = db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .is('deleted_at', null)
    .neq('status', 'closed');
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  if (connectionId) query = query.eq('connection_id', connectionId);
  const { data: existing, error: lookupError } = await query.limit(1).maybeSingle();
  if (lookupError) throw new Error('broadcast_conversation_unavailable');

  let conversationId = existing?.id as string | undefined;

  if (!conversationId) {
    const { data: created, error } = await db
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        contact_id: contactId,
        channel: 'whatsapp',
        connection_id: connectionId,
        status: 'open',
        unread_count: 0,
      })
      .select('id')
      .single();
    if (error || !created) {
      console.error('[broadcast] create conversation failed:', error);
      return;
    }
    conversationId = created.id as string;
  }

  const now = new Date().toISOString();

  const inserted = await db.from('messages').insert({
    conversation_id: conversationId,
    channel: 'whatsapp',
    sender_type: 'agent',
    content_type: 'template',
    content_text: bodyPreview,
    template_name: templateName,
    message_id: whatsappMessageId,
    status: whatsappMessageId ? 'sent' : 'failed',
    created_at: now,
    origin: 'broadcast',
    origin_name: args.broadcastName ?? null,
  });

  // A concurrent repair may have inserted the same message. Preserve its timestamp.
  if (inserted.error?.code === '23505') return;
  if (inserted.error) throw new Error('broadcast_conversation_unavailable');

  // Bump conversation summary. last_sender_type 'agent' keeps it out of the
  // "needs reply" set until the customer responds.
  await db
    .from('conversations')
    .update({
      last_message_text: bodyPreview.slice(0, 200),
      last_message_at: now,
      last_sender_type: 'agent',
      updated_at: now,
    })
    .eq('id', conversationId);
}

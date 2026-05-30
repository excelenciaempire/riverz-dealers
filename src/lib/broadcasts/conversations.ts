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

  // Find an existing open WhatsApp conversation for this contact, else create.
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .neq('status', 'closed')
    .limit(1)
    .maybeSingle();

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

  await db.from('messages').insert({
    conversation_id: conversationId,
    channel: 'whatsapp',
    sender_type: 'agent',
    content_type: 'template',
    content_text: bodyPreview,
    template_name: templateName,
    message_id: whatsappMessageId,
    status: whatsappMessageId ? 'sent' : 'failed',
    created_at: now,
  });

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

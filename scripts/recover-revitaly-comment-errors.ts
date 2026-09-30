/** Owner-authorized historical comment repair. Preview by default; --apply sends. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation, Message } from '@/types';

const workspaceId = '234604a9-909b-4e50-952b-acde4a85593a';
const replies = [
  ['69522e80-ea45-4737-aa1f-73c65a995cd1', '¡Hola! Revitaly es un shampoo cosmético con activos botánicos para el cuidado del cuero cabelludo. Los resultados varían y requieren constancia. ¿Quieres conocer los tratamientos o cómo comprar?'],
  ['acaff299-461d-449e-a2da-6a86a15733ed', 'Si tienes una duda sobre el producto, su uso o la compra, con gusto te ayudamos.'],
  ['85aba950-59e8-4eb1-8661-3a7ec224e478', 'Entiendo tu duda. Revitaly es un shampoo cosmético de uso externo; los resultados varían entre personas y no prometemos crecimiento garantizado.'],
  ['50db1aca-366e-43ee-a2cb-6b04e317ad4a', 'Entiendo tu duda sobre el anuncio. Podemos contarte cómo se usa Revitaly y qué ofrece el producto, sin prometer resultados garantizados.'],
  ['33d7eb69-0468-4f05-ad4b-6af93de6f1fb', '¡Hola! Disculpa la demora en responder. Si todavía te interesa, podemos contarte las opciones de compra y resolver tus dudas sobre Revitaly, sin prometer resultados garantizados.'],
] as const;

async function main() {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { getAdapter } = await import('@/lib/channels/registry');
  const { syncExternalReplies } = await import('@/lib/billing/external-replies');
  const { recordPublicCommentReply } = await import('@/lib/instagram-agent/record-dm');
  const { decrypt } = await import('@/lib/channels/encryption');
  const { withAppsecretProof } = await import('@/lib/channels/meta-graph');
  const proofPath = 'output/reevitaly-audit/comment-recovery.json';
  const previousEvidence = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')).evidence as Array<Record<string, unknown>> : [];
  const evidence: Array<Record<string, unknown>> = [];
  for (const [inboundId, text] of replies) {
    const incoming = await db.from('messages').select('*').eq('id', inboundId).single();
    if (incoming.error) throw incoming.error;
    const inbound = incoming.data as Message;
    const thread = await db.from('conversations').select('*').eq('id', inbound.conversation_id)
      .eq('workspace_id', workspaceId).is('deleted_at', null).single();
    if (thread.error) throw thread.error;
    const conversation = thread.data as Conversation;
    if (conversation.channel !== 'fb_comment' || !inbound.message_id
      || conversation.is_spam || conversation.assigned_agent_id || conversation.status === 'closed') {
      throw new Error(`Comment is no longer eligible: ${inboundId}`);
    }
    const [conn, person, meta] = await Promise.all([
      db.from('channel_connections').select('*').eq('id', conversation.connection_id).eq('workspace_id', workspaceId).single(),
      db.from('contacts').select('*').eq('id', conversation.contact_id).eq('workspace_id', workspaceId).single(),
      db.from('comments_meta').select('*').eq('message_id', inboundId).single(),
    ]);
    if (conn.error || person.error || meta.error) throw conn.error ?? person.error ?? meta.error;
    const connection = conn.data as ChannelConnection, contact = person.data as Contact;
    // A contact may have a newer hidden criticism under a different post.
    // The actual source comment decides visibility, not the thread preview.
    const token = decrypt((connection.secrets as Record<string, string>).access_token);
    const sourceUrl = new URL(`https://graph.facebook.com/v21.0/${inbound.message_id}`);
    sourceUrl.searchParams.set('fields', 'id,message,is_hidden'); sourceUrl.searchParams.set('access_token', token);
    const sourceResponse = await fetch(withAppsecretProof(sourceUrl.toString(), token), { signal: AbortSignal.timeout(15000) });
    const sourceComment = await sourceResponse.json();
    if (!sourceResponse.ok || sourceComment.is_hidden !== false || sourceComment.message !== inbound.content_text) {
      throw new Error(`Source comment changed or is hidden: ${inboundId}`);
    }
    await syncExternalReplies(db, { connection, conversation, contact, inbound, comment: meta.data });
    const previous = await db.from('comments_meta').select('message_id,messages!inner(sender_type,status)')
      .eq('parent_comment_id', inbound.message_id).eq('connection_id', connection.id);
    if (previous.error) throw previous.error;
    if (previous.data?.some(row => {
      const message = row.messages as unknown as { sender_type: string; status: string };
      return ['agent', 'bot'].includes(message.sender_type) && ['sent', 'read', 'delivered'].includes(message.status);
    })) {
      evidence.push({ inboundId, outcome: 'already_answered' });
      continue;
    }
    if (!process.argv.includes('--apply')) {
      evidence.push({ inboundId, comment: inbound.content_text, reply: text, outcome: 'preview' });
      continue;
    }
    const result = await getAdapter('fb_comment').sendText({
      channel: 'fb_comment', connection, conversation, contact, text,
      humanAgent: true, replyToExternalId: inbound.message_id,
    });
    if (!result.externalMessageId) throw new Error('Meta did not return a reply ID; do not resend.');
    // Check the provider before recording success. An uncertain send is not repeated.
    const url = new URL(`https://graph.facebook.com/v21.0/${result.externalMessageId}`);
    url.searchParams.set('fields', 'id,message'); url.searchParams.set('access_token', token);
    const verified = await fetch(withAppsecretProof(url.toString(), token), { signal: AbortSignal.timeout(15000) });
    const posted = await verified.json();
    if (!verified.ok || posted.message !== text) throw new Error('Posted reply could not be verified; do not resend.');
    await recordPublicCommentReply(db, { workspaceId, commentContactId: contact.id,
      commentChannel: 'fb_comment', text, externalId: result.externalMessageId, origin: 'comment_ai',
      originName: 'Recuperación de comentarios' });
    const stored = await db.from('messages').select('id').eq('conversation_id', conversation.id)
      .eq('message_id', result.externalMessageId).single();
    if (stored.error) throw stored.error;
    const linked = await db.from('comments_meta').upsert({ message_id: stored.data.id,
      connection_id: connection.id, post_id: meta.data.post_id, parent_comment_id: inbound.message_id });
    if (linked.error) throw linked.error;
    if (['ia_caida', 'comment_sin_moderar'].includes(conversation.needs_human_reason ?? '')) {
      const cleared = await db.from('conversations').update({ needs_human_reason: null, needs_human_at: null,
        needs_human_summary: null, ...(conversation.status === 'pending' ? { status: 'open' } : {}) })
        .eq('id', conversation.id).eq('workspace_id', workspaceId)
        .eq('needs_human_reason', conversation.needs_human_reason).is('assigned_agent_id', null);
      if (cleared.error) throw cleared.error;
    }
    evidence.push({ inboundId, conversationId: conversation.id, comment: inbound.content_text,
      reply: text, externalReplyId: result.externalMessageId, inboxMessageId: stored.data.id,
      outcome: 'sent_verified', sentAt: new Date().toISOString() });
    const allEvidence = new Map(previousEvidence.map(row => [row.inboundId, row]));
    for (const row of evidence) if (row.outcome === 'sent_verified' || !allEvidence.has(row.inboundId)) allEvidence.set(row.inboundId, row);
    writeFileSync(proofPath, JSON.stringify({ capturedAt: new Date().toISOString(), evidence: [...allEvidence.values()] }, null, 2));
  }
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

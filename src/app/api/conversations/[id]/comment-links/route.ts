import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { loadCommentSource } from '@/lib/comments/provenance';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const locale = await getLocale();
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: translate(locale, 'errInbox.unauthorized') }, { status: 401 });
  const db = supabaseAdmin();
  const { data: conv } = await db.from('conversations').select('workspace_id, channel')
    .eq('id', id).is('deleted_at', null).maybeSingle();
  if (!conv) return NextResponse.json({ error: translate(locale, 'errInbox.notFound') }, { status: 404 });
  const { data: member } = await db.from('workspace_members').select('id')
    .eq('workspace_id', conv.workspace_id).eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: translate(locale, 'errInbox.forbidden') }, { status: 403 });
  // IDs supplied by the visible thread also cover paginated, older messages.
  const ids = new URL(req.url).searchParams.getAll('message').slice(0, 100)
    .filter(value => /^[0-9a-f-]{36}$/i.test(value));
  let query = db.from('messages').select('id, reply_to_message_id, channel, created_at')
    .eq('conversation_id', id).is('deleted_at', null);
  if (ids.length) query = query.in('id', ids);
  const { data: messages } = await query.order('created_at', { ascending: false }).limit(100);
  const sourceIds = [...new Set((messages ?? []).map(m =>
    ['ig_comment', 'fb_comment', 'tiktok_comment'].includes(m.channel) ? m.id : m.reply_to_message_id
  ).filter((value): value is string => !!value))];
  const sources = new Map();
  // Bounded batches; failures never remove the underlying message.
  for (let offset = 0; offset < sourceIds.length; offset += 5) {
    await Promise.all(sourceIds.slice(offset, offset + 5).map(async sourceId => {
      const source = await loadCommentSource(db, conv.workspace_id, sourceId);
      if (source) sources.set(sourceId, source);
    }));
  }
  const links = (messages ?? []).flatMap(m => {
    const source = sources.get(m.reply_to_message_id ?? m.id);
    return source ? [{ messageId: m.id, source }] : [];
  });
  const reverse: { messageId: string; conversationId: string; createdAt: string }[] = [];
  if (['ig_comment', 'fb_comment'].includes(conv.channel) && sourceIds.length) {
    const { data: privateReplies } = await db.from('messages')
      .select('reply_to_message_id, conversation_id, created_at, conversations!inner(workspace_id, deleted_at)')
      .in('reply_to_message_id', sourceIds).in('channel', ['instagram', 'messenger'])
      .eq('sender_type', 'agent').eq('conversations.workspace_id', conv.workspace_id)
      .is('conversations.deleted_at', null).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(100);
    const seen = new Set<string>();
    for (const reply of privateReplies ?? []) {
      if (seen.has(reply.reply_to_message_id)) continue;
      seen.add(reply.reply_to_message_id);
      reverse.push({ messageId: reply.reply_to_message_id, conversationId: reply.conversation_id, createdAt: reply.created_at });
    }
  }
  return NextResponse.json({ links, reverse }, { headers: { 'Cache-Control': 'private, no-store' } });
}

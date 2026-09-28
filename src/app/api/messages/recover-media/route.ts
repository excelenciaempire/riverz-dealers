import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { decrypt } from '@/lib/channels/encryption';
import { ingestMetaAttachments } from '@/lib/channels/meta-attachments';
import { missingMediaText, repairStoredMetaMedia } from '@/lib/channels/repair-meta-media';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

// Per-process duplicate clicks are coalesced. Provider requests remain bounded.
const attempts = new Map<string, number>();
export async function POST(req: Request) {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const fail = (key: string, status: number) => NextResponse.json({ error: translate(locale, key) }, { status });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail('errInbox.unauthorized', 401);
  const body = await req.json().catch(() => null);
  if (typeof body?.message_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.message_id)) return fail('errInbox.missingIdGeneric', 400);
  const db = supabaseAdmin();
  const { data: m } = await db.from('messages').select('id, conversation_id, channel, message_id, content_text, media_url')
    .eq('id', body.message_id).is('deleted_at', null).maybeSingle();
  if (!m) return fail('errInbox.notFound', 404);
  const { data: conv } = await db.from('conversations').select('workspace_id, connection_id, contact_id')
    .eq('id', m.conversation_id).is('deleted_at', null).maybeSingle();
  if (!conv) return fail('errInbox.notFound', 404);
  const { data: member } = await db.from('workspace_members').select('id')
    .eq('workspace_id', conv.workspace_id).eq('user_id', user.id).maybeSingle();
  if (!member) return fail('errInbox.forbidden', 403);
  if (m.media_url) return NextResponse.json({ recovered: true });
  if (!['instagram', 'messenger'].includes(m.channel) || !m.message_id || !missingMediaText(m.content_text))
    return NextResponse.json({ recovered: false });
  const now = Date.now();
  if (now - (attempts.get(m.id) ?? 0) < 60_000) return NextResponse.json({ recovered: false, throttled: true });
  if (attempts.size > 2000) for (const [id, at] of attempts) if (now - at > 60_000) attempts.delete(id);
  attempts.set(m.id, now);
  const { data: conn } = await db.from('channel_connections').select('secrets')
    .eq('id', conv.connection_id).eq('workspace_id', conv.workspace_id).maybeSingle();
  const { data: contact } = await db.from('contacts').select('external_id')
    .eq('id', conv.contact_id).eq('workspace_id', conv.workspace_id).maybeSingle();
  const token = conn?.secrets?.access_token;
  if (!token || !contact?.external_id) return NextResponse.json({ recovered: false });
  try {
    const parsed = await ingestMetaAttachments({ workspaceId: conv.workspace_id,
      externalContactId: contact.external_id, externalMessageId: m.message_id,
      accessToken: decrypt(String(token)), recoverMissing: true });
    const recovered = await repairStoredMetaMedia(db, { workspaceId: conv.workspace_id,
      externalMessageId: m.message_id, channel: m.channel, media: parsed.media });
    return NextResponse.json({ recovered });
  } catch { return NextResponse.json({ recovered: false }); }
}

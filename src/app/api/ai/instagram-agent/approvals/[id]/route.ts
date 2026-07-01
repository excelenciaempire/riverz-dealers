import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { instagramAdapter } from '@/lib/channels/instagram/adapter';
import { latestInbound, withinMessagingWindow } from '@/lib/instagram-agent/engagement';
import { claimCommentPrivateReply } from '@/lib/instagram-agent/private-reply-lock';

/**
 * POST /api/ai/instagram-agent/approvals/[id]
 * Body: { action: 'approve' | 'reject', text?: string }
 *
 * Releases a proactive DM held for review. `approve` sends it (optionally with
 * human-edited text) as a private reply to the source comment, or as a normal
 * DM if still inside Meta's 24h window; `reject` skips it. RLS scopes the row to
 * the caller's workspace via the campaign policy.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = body.action === 'reject' ? 'reject' : 'approve';
  const editedText =
    typeof body.text === 'string' && body.text.trim() ? body.text.trim() : null;

  const { data: recRow } = await supabase
    .from('instagram_campaign_recipients')
    .select('id, status, draft_text, source_comment_id, contact_id, campaign_id')
    .eq('id', id)
    .maybeSingle();
  const rec = recRow as {
    id: string;
    status: string;
    draft_text: string | null;
    source_comment_id: string | null;
    contact_id: string | null;
    campaign_id: string;
  } | null;
  if (!rec) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.campaignNotFound') },
      { status: 404 },
    );
  }
  if (rec.status !== 'pending_review') {
    return NextResponse.json(
      { error: translate(locale, 'errAi.approvalNotPending') },
      { status: 400 },
    );
  }

  if (action === 'reject') {
    await supabase
      .from('instagram_campaign_recipients')
      .update({ status: 'skipped', error: 'rechazado por humano' })
      .eq('id', id)
      .eq('status', 'pending_review');
    return NextResponse.json({ success: true, status: 'skipped' });
  }

  // Approve → send. Load campaign workspace + the contact + the IG connection.
  const text = editedText ?? rec.draft_text ?? '';
  if (!text || !rec.contact_id) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.approvalNoDraft') },
      { status: 400 },
    );
  }

  const { data: campRow } = await supabase
    .from('instagram_campaigns')
    .select('workspace_id')
    .eq('id', rec.campaign_id)
    .maybeSingle();
  const workspaceId = (campRow as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.campaignNotFound') },
      { status: 404 },
    );
  }

  const { data: contactRow } = await supabase
    .from('contacts')
    .select('id, external_id, opted_out')
    .eq('id', rec.contact_id)
    .maybeSingle();
  const contact = contactRow as {
    id: string;
    external_id: string | null;
    opted_out: boolean | null;
  } | null;
  if (!contact?.external_id) {
    await supabase
      .from('instagram_campaign_recipients')
      .update({ status: 'skipped', error: 'sin external_id de Instagram' })
      .eq('id', id);
    return NextResponse.json({ success: true, status: 'skipped' });
  }
  // Honor opt-out even on manual approval — a hard compliance gate.
  if (contact.opted_out) {
    await supabase
      .from('instagram_campaign_recipients')
      .update({ status: 'skipped', error: 'opted_out' })
      .eq('id', id);
    return NextResponse.json({ success: true, status: 'skipped' });
  }

  const { data: connRow } = await supabase
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'instagram')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!connRow) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.instagramNotConnected') },
      { status: 400 },
    );
  }
  const connection = connRow as ChannelConnection;

  // Prefer a private reply to the source comment (one per comment — claim the
  // shared lock). If there's no comment, fall back to a normal DM, but only
  // inside Meta's 24h window.
  let commentId: string | undefined;
  if (rec.source_comment_id) {
    const won = await claimCommentPrivateReply(
      supabase,
      workspaceId,
      rec.source_comment_id,
      'campaign',
    );
    if (!won) {
      await supabase
        .from('instagram_campaign_recipients')
        .update({ status: 'skipped', error: 'comment ya respondido' })
        .eq('id', id);
      return NextResponse.json({ success: true, status: 'skipped' });
    }
    commentId = rec.source_comment_id;
  } else {
    const inbound = await latestInbound(supabase, contact.id).catch(() => ({
      text: null,
      at: null,
    }));
    if (!withinMessagingWindow(inbound.at)) {
      await supabase
        .from('instagram_campaign_recipients')
        .update({ status: 'skipped', error: 'outside_24h_window' })
        .eq('id', id);
      return NextResponse.json({ success: true, status: 'skipped' });
    }
  }

  try {
    await instagramAdapter.sendText({
      channel: 'instagram',
      connection,
      conversation: { id: '' } as unknown as Conversation,
      contact: {
        id: contact.id,
        external_id: contact.external_id,
      } as unknown as Contact,
      commentId,
      text,
    } satisfies OutboundText);
    await supabase
      .from('instagram_campaign_recipients')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        draft_text: text,
        error: null,
      })
      .eq('id', id);
    return NextResponse.json({ success: true, status: 'sent' });
  } catch (err) {
    await supabase
      .from('instagram_campaign_recipients')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : 'send failed',
      })
      .eq('id', id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'send failed' },
      { status: 502 },
    );
  }
}

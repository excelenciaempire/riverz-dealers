import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { instagramAdapter } from '@/lib/channels/instagram/adapter';
import { resolveIgReach } from '@/lib/instagram-agent/engagement';
import { claimCommentPrivateReply } from '@/lib/instagram-agent/private-reply-lock';
import { logProactiveSend } from '@/lib/instagram-agent/controls';
import { recordProactiveDm } from '@/lib/instagram-agent/record-dm';
import { supabaseAdmin } from '@/lib/channels/admin-client';

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

  // La cuenta que realmente atendió a esta persona (con varias cuentas de
  // Instagram conectadas, "la más reciente del workspace" enviaba por la
  // equivocada y Meta rechazaba el envío). Se resuelve por su conversación; si
  // no hay rastro, cae a la conexión activa más reciente.
  const connection = await resolveApprovalConnection(
    supabase,
    workspaceId,
    contact.id,
  );
  if (!connection) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.instagramNotConnected') },
      { status: 400 },
    );
  }

  // Ruta permitida por Meta AHORA: DM libre (ventana de 24h) o respuesta
  // privada al comentario (7 días). Se recalcula en el momento de aprobar
  // porque un borrador puede llevar días esperando y la ventana ya haber
  // cerrado — antes se enviaba igual y Meta lo rechazaba con un error opaco.
  const reach = await resolveIgReach(supabase, contact.id).catch(
    () => ({ kind: 'none', reason: 'no_engagement' }) as const,
  );
  if (reach.kind === 'none') {
    await supabase
      .from('instagram_campaign_recipients')
      .update({ status: 'skipped', error: reach.reason })
      .eq('id', id);
    return NextResponse.json({
      success: true,
      status: 'skipped',
      reason: reach.reason,
    });
  }
  const commentId = reach.kind === 'private_reply' ? reach.commentId : undefined;
  // Una sola respuesta privada por comentario, compartida con el motor de
  // comentario→DM: si el otro camino ya respondió, no insistimos.
  if (commentId) {
    const won = await claimCommentPrivateReply(
      supabase,
      workspaceId,
      commentId,
      'campaign',
    );
    if (!won) {
      await supabase
        .from('instagram_campaign_recipients')
        .update({ status: 'skipped', error: 'comment ya respondido' })
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
    await recordProactiveDm(supabaseAdmin(), {
      workspaceId,
      contactId: contact.id,
      externalId: contact.external_id,
      connection,
      text,
    });
    await logProactiveSend(supabaseAdmin(), {
      workspaceId,
      campaignId: rec.campaign_id,
      contactId: rec.contact_id,
      kind: 'approval',
      text,
    });
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

/**
 * La conexión de Instagram con la que hay que enviarle a ESTA persona: la que
 * atendió su conversación (instagram o, en su defecto, la hermana de la fila
 * ig_comment — misma cuenta, mismo token). Sin rastro, la conexión activa más
 * reciente del workspace.
 */
async function resolveApprovalConnection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  contactId: string,
): Promise<ChannelConnection | null> {
  const { data: active } = await supabase
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'instagram')
    .neq('status', 'disconnected')
    .order('updated_at', { ascending: false });
  const conns = (active ?? []) as ChannelConnection[];
  if (conns.length <= 1) return conns[0] ?? null;

  const { data: convs } = await supabase
    .from('conversations')
    .select('connection_id, channel, last_message_at')
    .eq('contact_id', contactId)
    .in('channel', ['instagram', 'ig_comment'])
    .not('connection_id', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(1);
  const connId = (convs ?? [])[0]?.connection_id as string | undefined;
  if (!connId) return conns[0];

  const direct = conns.find((c) => c.id === connId);
  if (direct) return direct;

  // La conversación apunta a la fila ig_comment: usar su hermana instagram.
  const { data: srcRow } = await supabase
    .from('channel_connections')
    .select('external_account_id')
    .eq('id', connId)
    .maybeSingle();
  const account = (srcRow as { external_account_id: string | null } | null)
    ?.external_account_id;
  return (
    conns.find(
      (c) => String(c.external_account_id ?? '') === String(account ?? ''),
    ) ?? conns[0]
  );
}

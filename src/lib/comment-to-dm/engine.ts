import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { getAdapter } from '@/lib/channels/registry';
import { claimCommentPrivateReply } from '@/lib/instagram-agent/private-reply-lock';
import { proactiveGate, logProactiveSend } from '@/lib/instagram-agent/controls';
import { composeDmText } from './rules';

/**
 * Comentario → DM (auto-DM on comments) — ManyChat's signature growth tool.
 *
 * Fired from `inbox-writer` on every inbound IG/FB comment. If the comment
 * matches an active rule, we (1) optionally post a PUBLIC reply on the comment
 * and (2) send a PRIVATE DM ("private reply" keyed by the comment id — the only
 * way to message someone who only commented; we don't have their PSID/IGSID
 * until they reply). The DM send paths live in the channel adapters
 * (`recipient: { comment_id }`). Idempotency + analytics live in
 * `comment_to_dm_log` (migration 086).
 */

type CommentChannel = 'ig_comment' | 'fb_comment';

interface CommentToDmRule {
  id: string;
  workspace_id: string;
  channel: CommentChannel;
  post_id: string | null;
  keywords: string[];
  match_type: 'contains' | 'exact';
  case_sensitive: boolean;
  public_reply_enabled: boolean;
  public_reply_templates: string[];
  dm_message: string;
  dm_button_label: string | null;
  dm_button_url: string | null;
  priority: number;
}

export interface CommentEvent {
  workspaceId: string;
  channel: CommentChannel;
  /** The comment connection (ig_comment/fb_comment) — shares the page token
   *  + page_id, so the DM adapter can send through it without loading a
   *  separate connection row. */
  connection: ChannelConnection;
  contact: { id: string; external_id: string | null; name: string | null };
  commentId: string | null;
  postId: string | null;
  parentCommentId: string | null;
  text: string;
}

/** Which DM surface to send the private reply on, per comment channel. */
const DM_CHANNEL: Record<CommentChannel, 'instagram' | 'messenger'> = {
  ig_comment: 'instagram',
  fb_comment: 'messenger',
};

export async function processCommentForDmRules(
  db: SupabaseClient,
  ev: CommentEvent,
): Promise<boolean> {
  if (!ev.commentId) return false;
  // Only top-level comments. A reply to a comment (incl. a reply to OUR own
  // public reply) carries a parent_id — skipping those avoids DM loops and
  // matches ManyChat's default of triggering on post/ad comments.
  if (ev.parentCommentId) return false;

  const { data: rules } = await db
    .from('comment_to_dm_rules')
    .select(
      'id, workspace_id, channel, post_id, keywords, match_type, case_sensitive, public_reply_enabled, public_reply_templates, dm_message, dm_button_label, dm_button_url, priority',
    )
    .eq('workspace_id', ev.workspaceId)
    .eq('channel', ev.channel)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  const list = (rules ?? []) as CommentToDmRule[];
  if (list.length === 0) return false;

  // First matching rule wins (post scope + keyword match).
  const rule = list.find(
    (r) =>
      (r.post_id == null || r.post_id === ev.postId) &&
      commentMatches(r, ev.text),
  );
  if (!rule) return false;

  // El freno de emergencia y el tope diario del workspace mandan también aquí.
  // No lo hacían: "Pausar todo" frenaba a la IA y a las campañas, pero las
  // reglas seguían mandando DMs — o sea, el interruptor prometía parar algo que
  // no paraba. Se comprueba DESPUÉS de encontrar la regla para no gastar una
  // consulta en cada comentario que no dispara nada.
  const gate = await proactiveGate(db, ev.workspaceId);
  if (!gate.ok) {
    // `false` = "no lo atendí": el router lo pasa al agente, que está frenado
    // por la misma puerta. Nadie escribe, que es justo lo que se pidió.
    return false;
  }

  // Idempotency claim: insert the log row BEFORE sending. A duplicate webhook
  // delivery for the same comment collides on UNIQUE (rule_id, comment) and we
  // bail here — so a comment is never DM'd twice.
  const { data: claim, error: claimErr } = await db
    .from('comment_to_dm_log')
    .insert({
      rule_id: rule.id,
      workspace_id: ev.workspaceId,
      contact_id: ev.contact.id,
      comment_external_id: ev.commentId,
      channel: ev.channel,
    })
    .select('id')
    .single();
  // SÓLO 23505 significa "otra entrega del webhook ya lo atendió": ahí sí
  // devolvemos true para que el router no lo mande además por el camino del
  // agente. Antes cualquier error de DB (una caída, un timeout) se reportaba
  // igual que un duplicado, y ese comentario quedaba sin respuesta de nadie:
  // ni la regla, que falló, ni el agente, al que acabábamos de frenar.
  if (claimErr) {
    const isDuplicate = (claimErr as { code?: string }).code === '23505';
    if (!isDuplicate) {
      console.error('[comment-to-dm] claim falló, se deja pasar al agente:', claimErr);
    }
    return isDuplicate;
  }
  if (!claim) return false;

  const logId = (claim as { id: string }).id;
  let publicReplyStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
  let publicReplyExternalId: string | null = null;
  let dmStatus: 'sent' | 'failed' | 'skipped' = 'failed';
  let dmExternalId: string | null = null;
  let errMsg: string | null = null;

  // 1. Public reply on the comment (rotate templates so repeated replies on a
  //    busy post don't all read identically — looks human, dodges spam heuristics).
  const templates = (rule.public_reply_templates ?? []).filter((t) => t.trim());
  if (rule.public_reply_enabled && templates.length > 0) {
    const text = templates[Math.floor(Math.random() * templates.length)];
    try {
      const res = await getAdapter(ev.channel).sendText({
        channel: ev.channel,
        connection: ev.connection,
        conversation: {
          id: '',
          thread_external_id: ev.commentId,
        } as unknown as Conversation,
        contact: { id: ev.contact.id } as unknown as Contact,
        text,
        replyToExternalId: ev.commentId,
      } satisfies OutboundText);
      publicReplyStatus = 'sent';
      publicReplyExternalId = res.externalMessageId ?? null;
    } catch (err) {
      publicReplyStatus = 'failed';
      errMsg =
        err instanceof Error ? err.message.slice(0, 400) : 'public reply failed';
    }
  }

  // 2. Private DM (private reply by comment id). Gate on the shared per-comment
  //    lock: Meta allows one private reply per comment, and the campaign
  //    instant-outreach path can also reply to this same comment — whoever
  //    claims first sends, the other skips.
  const dmText = composeDmText(rule);
  const wonReply = await claimCommentPrivateReply(
    db,
    ev.workspaceId,
    ev.commentId,
    'rule',
  );
  if (!wonReply) {
    dmStatus = 'skipped';
    errMsg = errMsg ?? 'private reply ya enviado para este comentario';
  } else {
    try {
      const res = await getAdapter(DM_CHANNEL[ev.channel]).sendText({
        channel: DM_CHANNEL[ev.channel],
        connection: ev.connection,
        conversation: { id: '' } as unknown as Conversation,
        contact: {
          id: ev.contact.id,
          external_id: ev.contact.external_id,
        } as unknown as Contact,
        commentId: ev.commentId,
        text: dmText,
      } satisfies OutboundText);
      dmStatus = 'sent';
      dmExternalId = res.externalMessageId ?? null;
      // Cuenta para el tope diario: es un DM proactivo más saliendo de esta
      // cuenta, y el límite protege la reputación del número, no una
      // funcionalidad concreta. `kind` lo mantiene separado en las
      // estadísticas.
      await logProactiveSend(db, {
        workspaceId: ev.workspaceId,
        contactId: ev.contact.id,
        kind: 'comment_rule',
        text: dmText,
      });
    } catch (err) {
      dmStatus = 'failed';
      errMsg =
        errMsg ?? (err instanceof Error ? err.message.slice(0, 400) : 'dm failed');
    }
  }

  await db
    .from('comment_to_dm_log')
    .update({
      public_reply_status: publicReplyStatus,
      public_reply_external_id: publicReplyExternalId,
      dm_status: dmStatus,
      dm_external_id: dmExternalId,
      error: errMsg,
    })
    .eq('id', logId);

  // Una regla del comercio se hizo cargo de este comentario: el router no debe
  // mandarlo además por el camino del agente.
  return true;
}

/** Empty keyword list = match ANY comment. Otherwise contains/exact. */
function commentMatches(rule: CommentToDmRule, text: string): boolean {
  const kws = (rule.keywords ?? []).filter((k) => k.trim());
  if (kws.length === 0) return true;
  const hay = rule.case_sensitive ? text : text.toLowerCase();
  return kws.some((k) => {
    const needle = rule.case_sensitive ? k.trim() : k.trim().toLowerCase();
    if (!needle) return false;
    return rule.match_type === 'exact'
      ? hay.trim() === needle
      : hay.includes(needle);
  });
}

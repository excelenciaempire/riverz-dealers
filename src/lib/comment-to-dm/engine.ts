import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { getAdapter } from '@/lib/channels/registry';
import { marcarParaCanal } from '@/lib/marketing/enlaces';
import { claimCommentPrivateReply } from '@/lib/instagram-agent/private-reply-lock';
import { proactiveGate, logProactiveSend } from '@/lib/instagram-agent/controls';
import {
  recordProactiveDm,
  recordPublicCommentReply,
} from '@/lib/instagram-agent/record-dm';
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

type CommentChannel = 'ig_comment' | 'fb_comment' | 'tiktok_comment';
/** Lo que una regla puede escuchar: una red, o las dos (migración 203). */
type RuleChannel = CommentChannel | 'both';

interface CommentToDmRule {
  id: string;
  name: string;
  workspace_id: string;
  channel: RuleChannel;
  post_id: string | null;
  keywords: string[];
  match_type: 'contains' | 'exact';
  case_sensitive: boolean;
  public_reply_enabled: boolean;
  public_reply_templates: string[];
  dm_message: string;
  dm_button_label: string | null;
  dm_button_url: string | null;
  dm_attachment_url: string | null;
  dm_attachment_type: 'image' | 'video' | 'audio' | 'file' | null;
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

/**
 * Por dónde sale el privado de cada red.
 *
 * TikTok no está: su API de mensajes está cerrada a terceros, así que una
 * regla de TikTok publica bajo el video y no manda nada por privado. No es una
 * decisión de producto — es lo único que TikTok deja hacer.
 */
const DM_CHANNEL: Record<CommentChannel, 'instagram' | 'messenger' | null> = {
  ig_comment: 'instagram',
  fb_comment: 'messenger',
  tiktok_comment: null,
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
      'id, name, workspace_id, channel, post_id, keywords, match_type, case_sensitive, public_reply_enabled, public_reply_templates, dm_message, dm_button_label, dm_button_url, dm_attachment_url, dm_attachment_type, priority',
    )
    .eq('workspace_id', ev.workspaceId)
    // 'both' escucha las dos redes: la misma regla ya no hay que escribirla
    // (y editarla) dos veces.
    .in('channel', [ev.channel, 'both'])
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
          thread_external_id: threadDeRespuesta(ev),
        } as unknown as Conversation,
        contact: { id: ev.contact.id } as unknown as Contact,
        text,
        replyToExternalId: ev.commentId,
      } satisfies OutboundText);
      publicReplyStatus = 'sent';
      publicReplyExternalId = res.externalMessageId ?? null;
      // Que se vea YA en la bandeja. Meta no manda webhook por los comentarios
      // de la propia cuenta, así que hasta ahora esta respuesta sólo aparecía
      // cuando pasaba la conciliación, diez minutos más tarde.
      await recordPublicCommentReply(db, {
        workspaceId: ev.workspaceId,
        commentContactId: ev.contact.id,
        commentChannel: ev.channel,
        text,
        externalId: publicReplyExternalId,
        origin: 'comment_rule',
        originName: rule.name ?? null,
      });
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
  //
  //    En TikTok no hay paso 2: la regla ya hizo todo lo que TikTok permite.
  const dmChannel = DM_CHANNEL[ev.channel];
  const wonReply = dmChannel
    ? await claimCommentPrivateReply(db, ev.workspaceId, ev.commentId, 'rule')
    : false;
  if (!dmChannel) {
    dmStatus = 'skipped';
    errMsg = errMsg ?? 'TikTok no tiene mensajes privados';
  } else if (!wonReply) {
    dmStatus = 'skipped';
    errMsg = errMsg ?? 'private reply ya enviado para este comentario';
  } else {
    // 2.a El recurso (catálogo, cupón, video) va PRIMERO y como adjunto de
    //     verdad. Si Meta lo rechaza —hay tipos que no admite en una respuesta
    //     privada—, el enlace se pega al final del texto: el recurso llega
    //     igual, sólo que como link. Por eso el adjunto se intenta antes de
    //     componer el texto.
    let attachmentFallbackUrl: string | null = null;
    if (rule.dm_attachment_url) {
      const dmAdapter = getAdapter(dmChannel);
      try {
        if (!dmAdapter.sendMedia) throw new Error('canal sin adjuntos');
        await dmAdapter.sendMedia({
          channel: dmChannel,
          connection: ev.connection,
          conversation: { id: '' } as unknown as Conversation,
          contact: {
            id: ev.contact.id,
            external_id: ev.contact.external_id,
          } as unknown as Contact,
          commentId: ev.commentId,
          mediaUrl: rule.dm_attachment_url,
          mediaType:
            rule.dm_attachment_type === 'file' || !rule.dm_attachment_type
              ? 'document'
              : rule.dm_attachment_type,
        });
      } catch (err) {
        attachmentFallbackUrl = rule.dm_attachment_url;
        console.warn(
          '[comment-to-dm] adjunto rechazado, va como enlace:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Marcado antes de enviar y de persistir: el hilo tiene que mostrar el
    // mismo texto que recibió la persona.
    const dmText = marcarParaCanal(
      attachmentFallbackUrl
        ? `${composeDmText(rule)}\n\n${attachmentFallbackUrl}`
        : composeDmText(rule),
      dmChannel,
    );
    try {
      const res = await getAdapter(dmChannel).sendText({
        channel: dmChannel,
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
      // Que se VEA en la bandeja, en el acto y en los dos hilos (el privado y
      // el del comentario). Antes dependía del eco de Meta: el comercio veía el
      // comentario del cliente y ninguna respuesta, aunque la regla hubiera
      // mandado el DM. Best-effort y con el id real del envío, así que el eco
      // no duplica nada.
      await recordProactiveDm(db, {
        workspaceId: ev.workspaceId,
        contactId: ev.contact.id,
        externalId: ev.contact.external_id,
        dmChannel: dmChannel,
        commentChannel: ev.channel,
        connection: ev.connection,
        text: dmText,
        dmMessageId: dmExternalId,
        // Con respuesta pública publicada, el hilo del comentario ya la
        // muestra: espejar encima el DM dejaba dos mensajes casi iguales.
        commentContactId: publicReplyStatus === 'sent' ? null : ev.contact.id,
        // Idem para una regla: el hilo privado tiene que decir a raíz de qué
        // comentario se abrió.
        commentText: ev.text,
        origin: 'comment_rule',
        originName: rule.name ?? null,
      });
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

/**
 * A qué hilo se le publica la respuesta.
 *
 * Meta identifica el comentario y basta. TikTok necesita además el video, y su
 * adapter lo lee de `thread_external_id` con la forma "video:<id>|comment:<id>"
 * (la misma que arma el poll). Sin el video, TikTok rechaza la respuesta.
 */
function threadDeRespuesta(ev: CommentEvent): string {
  if (ev.channel !== 'tiktok_comment') return ev.commentId ?? '';
  return `video:${ev.postId ?? ''}|comment:${ev.commentId ?? ''}`;
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

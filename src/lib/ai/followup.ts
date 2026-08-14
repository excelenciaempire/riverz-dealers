import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropic } from './anthropic-client';
import { resolveAnthropicKey } from './platform-key';
import { appendBusinessScopeGuardrails } from './guardrails';
import { getAdapter } from '@/lib/channels/registry';
import type { AiAgent } from './types';
import type { ChannelConnection, Contact, Conversation } from '@/types';

/**
 * Follow-up inteligente: cuando el cliente deja de responder tras nuestro
 * último mensaje, el asistente redacta UN seguimiento contextual a partir
 * del historial y lo envía por el canal. No es una plantilla fija — el
 * modelo lee la conversación y decide qué decir (o que no hay nada útil
 * que agregar, en cuyo caso responde SKIP y no se envía nada).
 *
 * El cron (`/api/cron/ai-followups`) decide A QUIÉN seguir y lleva el conteo
 * por racha de silencio; este módulo sólo genera + envía + persiste un
 * mensaje. Nunca lanza: cualquier fallo se devuelve como { sent: false }.
 */

const TONE_HINT: Record<string, string> = {
  friendly: 'cálido y cercano',
  formal: 'profesional y respetuoso',
  casual: 'directo y coloquial',
  concise: 'muy breve, una o dos frases',
};

const LANG_NAME: Record<string, string> = {
  es: 'español',
  en: 'inglés',
  pt: 'portugués',
  fr: 'francés',
};

export interface FollowUpResult {
  sent: boolean;
  reason?: string;
}


function describeSilence(hours: number): string {
  if (hours < 1) return 'menos de una hora';
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h} hora${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(hours / 24);
  return `${d} día${d === 1 ? '' : 's'}`;
}

function buildSystem(
  agent: AiAgent,
  silenceHours: number,
  campaignHint?: string | null,
): string {
  const tone = TONE_HINT[agent.tone] ?? 'natural';
  const lang = LANG_NAME[agent.language] ?? 'español';
  const parts: string[] = [];
  parts.push(agent.persona?.trim() || 'Eres un asistente de atención al cliente.');
  if (agent.knowledge?.trim()) {
    parts.push(`\nInformación del negocio:\n${agent.knowledge.trim()}`);
  }
  parts.push(
    [
      '',
      'TAREA: el cliente no ha respondido a tu último mensaje en ' +
        `${describeSilence(silenceHours)}. Escribe UN solo mensaje de ` +
        'seguimiento, proactivo y contextual, para retomar la conversación.',
      '',
      'Reglas del seguimiento:',
      `- Idioma: ${lang}. Tono ${tone}.`,
      '- Retoma el hilo concreto donde quedó (su última duda, el producto que miraba, el paso pendiente). NO empieces de cero.',
      '- Aporta algo de valor: resuelve la objeción probable, ofrece ayuda concreta o un siguiente paso claro.',
      '- No repitas tu mensaje anterior ni suenes a recordatorio automático. Que se sienta humano y oportuno.',
      '- No seas insistente ni presiones. Una sola idea, mensaje corto.',
      '- No te disculpes por escribir de nuevo ni digas que eres una IA.',
      '- Si NO hay nada útil ni natural que agregar (la conversación ya cerró, fue una despedida, o un follow-up sería molesto), responde EXACTAMENTE con la palabra SKIP y nada más.',
    ].join('\n'),
  );
  // Si la persona llegó por una campaña de Instagram viva, el seguimiento debe
  // continuar ESA conversación (su oferta, su código, el seguimiento que el
  // plan previó) en vez de ser un recordatorio genérico.
  if (campaignHint) parts.push(`\n${campaignHint}`);
  // Same server-enforced business-scope guardrails as the main runner: the
  // follow-up is still a customer-facing message, so it must stay in business
  // scope and in character regardless of the merchant's persona.
  appendBusinessScopeGuardrails(parts, agent.name);
  return parts.join('\n');
}

function extractText(resp: { content?: Array<{ type?: string; text?: string }> }): string {
  const blocks = resp.content ?? [];
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

export async function runFollowUp(
  db: SupabaseClient,
  args: {
    agent: AiAgent;
    conversation: Conversation;
    contact: Contact;
    connection: ChannelConnection;
    /** Horas transcurridas desde nuestro último mensaje (para el prompt). */
    silenceHours: number;
    /** Qué decir si la persona viene de una campaña de Instagram viva. */
    campaignHint?: string | null;
  },
): Promise<FollowUpResult> {
  const { agent, conversation, contact, connection, silenceHours } = args;
  try {
    // 0. Recuperación de pago: si el asistente envió un link de checkout y
    //    el cliente no pagó, este "seguimiento" se convierte en un mensaje
    //    de recuperación con el link (migraciones 081/082). Reusa el timing
    //    y los límites del cron de seguimientos. Se salta si ya hay un
    //    checkout abandonado de Shopify para el contacto (de eso se encarga
    //    el cron shopify-cart-recovery, para no pisarse).
    const pendingUrl = conversation.pending_checkout_url;
    if (conversation.pending_checkout_at && pendingUrl) {
      const orParts = [
        contact.phone ? `customer_phone.eq.${contact.phone}` : '',
        contact.email ? `customer_email.eq.${contact.email}` : '',
      ].filter(Boolean);
      if (orParts.length) {
        const { data: openCheckout } = await db
          .from('shopify_checkouts')
          .select('id')
          .eq('status', 'open')
          .or(orParts.join(','))
          .limit(1)
          .maybeSingle();
        if (openCheckout) return { sent: false, reason: 'cart_recovery_owns' };
      }
      const first = (contact.name || '').trim().split(/\s+/)[0];
      const text =
        `Hola${first ? ' ' + first : ''} 🙂 ¿Pudiste completar tu compra? ` +
        `Te dejo el link de pago de nuevo por si lo necesitas: ${pendingUrl}`;
      const adapter = getAdapter(conversation.channel);
      const sendResult = await adapter.sendText({
        channel: conversation.channel,
        connection,
        conversation,
        contact,
        text,
      });
      const now = new Date().toISOString();
      await db.from('messages').insert({
        conversation_id: conversation.id,
        channel: conversation.channel,
        sender_type: 'bot',
        content_type: 'text',
        content_text: text,
        message_id: sendResult.externalMessageId,
        status: sendResult.status ?? 'sent',
        origin: 'ai_followup',
        origin_name: agent.name ?? null,
      });
      await db
        .from('conversations')
        .update({
          last_message_text: text.slice(0, 200),
          last_message_at: now,
          last_sender_type: 'bot',
          updated_at: now,
          // Limpiamos el pago pendiente: ya mandamos UNA recuperación. Sin
          // esto, el cron reenviaría el link en cada corrida hasta tocar
          // followup_max_count (spam). Una sola recuperación por checkout.
          pending_checkout_at: null,
          pending_checkout_url: null,
        })
        .eq('id', conversation.id);
      return { sent: true };
    }

    // 1. Historial reciente (cronológico).
    const limit = Math.min(Math.max(agent.context_messages || 20, 6), 40);
    const { data: rows } = await db
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    const history = ((rows ?? []) as Array<{
      sender_type: string;
      content_text: string | null;
    }>)
      .reverse()
      .filter((m) => (m.content_text ?? '').trim());

    if (!history.some((m) => m.sender_type === 'customer')) {
      return { sent: false, reason: 'no_customer_message' };
    }

    // 2. Mensajes para el modelo. Debe arrancar con 'user' — recortamos
    //    cualquier mensaje 'assistant' al inicio.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = history.map(
      (m) => ({
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content: (m.content_text ?? '').trim(),
      }),
    );
    while (messages.length && messages[0].role === 'assistant') messages.shift();
    if (messages.length === 0) return { sent: false, reason: 'no_history' };
    // Instrucción final como turno de usuario para que el modelo produzca
    // el siguiente mensaje del asistente (el follow-up).
    messages.push({
      role: 'user',
      content:
        '(Instrucción interna, no la menciones: redacta ahora tu mensaje de seguimiento siguiendo las reglas. Solo el texto del mensaje, o SKIP.)',
    });

    // 3. Generación.
    const resolvedKey = await resolveAnthropicKey(db, {
      workspaceId: agent.workspace_id,
      agentKeyEncrypted: agent.api_key_encrypted,
    });
    if (!resolvedKey) return { sent: false, reason: 'no_api_key' };
    const apiKey = resolvedKey.key;

    const client = getAnthropic(apiKey);
    const resp = await client.messages.create({
      model: agent.model || 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: buildSystem(agent, silenceHours, args.campaignHint),
      messages,
    });
    const text = extractText(
      resp as unknown as { content?: Array<{ type?: string; text?: string }> },
    );
    if (!text || /^skip\.?$/i.test(text)) return { sent: false, reason: 'model_skip' };
    const finalText = text.slice(0, agent.max_response_chars || 500).trim();
    if (!finalText) return { sent: false, reason: 'empty' };

    // 4. Envío por el canal (solo DM: whatsapp / instagram / messenger).
    const adapter = getAdapter(conversation.channel);
    const sendResult = await adapter.sendText({
      channel: conversation.channel,
      connection,
      conversation,
      contact,
      text: finalText,
    });

    // 5. Persistencia (espejo del runner: mensaje 'bot' + bump de la conversación).
    const now = new Date().toISOString();
    await db.from('messages').insert({
      conversation_id: conversation.id,
      channel: conversation.channel,
      sender_type: 'bot',
      content_type: 'text',
      content_text: finalText,
      message_id: sendResult.externalMessageId,
      status: sendResult.status ?? 'sent',
      origin: 'ai_followup',
      origin_name: agent.name ?? null,
    });
    await db
      .from('conversations')
      .update({
        last_message_text: finalText.slice(0, 200),
        last_message_at: now,
        last_sender_type: 'bot',
        updated_at: now,
      })
      .eq('id', conversation.id);

    return { sent: true };
  } catch (err) {
    console.error('[ai/followup] failed for conversation', conversation.id, err);
    return { sent: false, reason: 'error' };
  }
}

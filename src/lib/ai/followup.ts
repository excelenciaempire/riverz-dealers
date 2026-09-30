import { withLatitudeTrace } from '@/lib/observability/latitude';
import { getAdapter } from '@/lib/channels/registry';
import {
  assertStoredConnectionCanSend,
  isChannelDisconnectedError,
  storedConnectionCanSend,
} from '@/lib/channels/send-guard';
import { prepararTextoParaCanal } from '@/lib/marketing/enlaces-salientes';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import { motorApagado } from '@/lib/workspaces/motor';
import { puertaDelPiloto } from '@/lib/piloto';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropic } from './anthropic-client';
import { MODELO_POR_DEFECTO, esfuerzo, reguladoPorEsfuerzo } from './esfuerzo';
import { estiloHumano, humanizarTexto } from './estilo-humano';
import { appendBusinessScopeGuardrails } from './guardrails';
import { cargarReglas, reglasATexto } from './guidance';
import { resolveAnthropicKey } from './platform-key';
import { largoDeChat } from './salida';
import {
  RIOPLATENSE_TEXTO,
  resolverRegistro,
  type Registro,
} from './registro-rioplatense';
import { toolEnabled } from './toolbox';
import type { AiAgent } from './types';

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
  /** Las reglas del comercio (migración 200). Un seguimiento también es un
   *  mensaje al cliente: lo que el agente no puede decir contestando tampoco
   *  lo puede decir por su cuenta. */
  reglas?: string | null,
  /** De vos o de tú, según de dónde sea el cliente. Ver `registro-rioplatense`. */
  registro: Registro = 'neutro'
): string {
  const tone = TONE_HINT[agent.tone] ?? 'natural';
  const lang = LANG_NAME[agent.language] ?? 'español';
  const esEspanol = (agent.language || 'es').toLowerCase().slice(0, 2) === 'es';
  const parts: string[] = [];
  parts.push(
    agent.persona?.trim() || 'Eres un asistente de atención al cliente.'
  );
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
      `- ${estiloHumano(agent.language)}`,
      // El seguimiento decía sólo "Idioma: español" y dejaba el trato al
      // criterio del modelo: el mismo hilo podía pasar de tú a vos entre la
      // respuesta y el seguimiento. Se decide con el mismo dato que el resto,
      // y sólo cuando el agente escribe en español.
      ...(esEspanol
        ? [
            registro === 'rioplatense'
              ? RIOPLATENSE_TEXTO
              : '- Español neutro, de tú: "tienes", "quieres". Nunca voseo rioplatense.',
          ]
        : []),
      '- Si NO hay nada útil ni natural que agregar (la conversación ya cerró, fue una despedida, o un follow-up sería molesto), responde EXACTAMENTE con la palabra SKIP y nada más.',
    ].join('\n')
  );
  // Si la persona llegó por una campaña de Instagram viva, el seguimiento debe
  // continuar ESA conversación (su oferta, su código, el seguimiento que el
  // plan previó) en vez de ser un recordatorio genérico.
  if (campaignHint) parts.push(`\n${campaignHint}`);
  // Same server-enforced business-scope guardrails as the main runner: the
  // follow-up is still a customer-facing message, so it must stay in business
  // scope and in character regardless of the merchant's persona.
  appendBusinessScopeGuardrails(parts, agent.name);
  if (reglas) parts.push(reglas);
  return parts.join('\n');
}

function extractText(resp: {
  content?: Array<{ type?: string; text?: string }>;
}): string {
  const blocks = resp.content ?? [];
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

/**
 * ¿Pidió la baja?
 *
 * El cron de reactivación lo chequea desde siempre (`opted_out = false` en su
 * consulta); el de seguimientos no lo miraba en ningún lado. Un contacto que
 * escribió "no me escribas más" —marcado en `inbox-writer`— seguía siendo
 * elegible para un mensaje que sale solo.
 */
async function estaDadoDeBaja(
  db: SupabaseClient,
  contactId: string
): Promise<boolean> {
  const { data } = await db
    .from('contacts')
    .select('opted_out')
    .eq('id', contactId)
    .maybeSingle();
  return (data as { opted_out?: boolean | null } | null)?.opted_out === true;
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
  }
): Promise<FollowUpResult> {
  return withLatitudeTrace('customer-followup', { workspaceId: args.agent.workspace_id, sessionId: args.conversation.id, userId: args.contact.id, channel: args.conversation.channel, agentId: args.agent.id, privateValues: [args.contact.name, args.contact.phone, args.contact.email, args.contact.external_id] }, () => runFollowUpInner(db, args));
}

async function runFollowUpInner(db: SupabaseClient, args: Parameters<typeof runFollowUp>[1]): Promise<FollowUpResult> {
  const { agent, conversation, contact, connection, silenceHours } = args;
  if (!(await storedConnectionCanSend(db, connection.id))) {
    return { sent: false, reason: 'channel_disconnected' };
  }
  // Motor apagado: la operación todavía no se aprobó o está suspendida, y un
  // seguimiento es justo lo que sale sin que nadie escriba primero.
  if (await motorApagado(db, agent.workspace_id)) {
    return { sent: false, reason: 'motor_apagado' };
  }
  // Sin saldo no se manda un seguimiento. Es un mensaje que sale SOLO, sin que
  // nadie lo pida: cobrarselo a Riverz porque el comercio no recargo es
  // exactamente lo que la puerta existe para evitar.
  if (!(await puedeUsarIa(db, args.agent.workspace_id))) {
    return { sent: false, reason: 'sin_saldo' };
  }
  // Piloto en vivo: un seguimiento cuenta como un mensaje del asistente, y con
  // "sólo estos números" no le llega a nadie más.
  const piloto = await puertaDelPiloto(db, {
    workspaceId: agent.workspace_id,
    tipo: 'mensaje',
    canal: conversation.channel,
    telefono: contact.phone ?? (conversation.channel === 'whatsapp' ? contact.external_id : null),
  });
  if (!piloto.permitido) {
    return { sent: false, reason: piloto.motivo };
  }

  try {
    // El permiso existía, tenía interruptor en la pantalla y entrada en cada
    // preset de rol — y no lo leía nadie: apagarlo no apagaba nada. Un
    // seguimiento es lo único que el agente manda sin que el cliente escriba
    // primero, así que es exactamente lo que ese permiso decide.
    if (!toolEnabled(agent, 'enviar_proactivo')) {
      return { sent: false, reason: 'proactive_not_allowed' };
    }
    // Quien pidió la baja no recibe un mensaje que sale solo. Faltaba en TODO
    // este camino —ni el cron ni esta función lo miraban—, así que un contacto
    // que escribió "no me escribas más" seguía siendo elegible; el cron de
    // reactivación sí lo chequeaba desde siempre. Va antes de la recuperación
    // de carrito, que hasta ahora se saltaba también este control y el de
    // aprobación por ser una rama anterior.
    if (await estaDadoDeBaja(db, contact.id)) {
      return { sent: false, reason: 'opted_out' };
    }
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
      const text = await prepararTextoParaCanal(db, {
        texto:
          `Hola${first ? ' ' + first : ''} 🙂 ¿Pudiste completar tu compra? ` +
          `Te dejo el link de pago de nuevo por si lo necesitas: ${pendingUrl}`,
        canal: conversation.channel,
        workspaceId: agent.workspace_id,
        contactId: contact.id,
      });
      // "Aprobar cada mensaje" vale también acá. Esta rama estaba ANTES del
      // chequeo de más abajo, así que un comercio que aprueba todo igual tenía
      // la recuperación de carrito saliendo sola. Se limpia el pendiente junto
      // con la propuesta: si no, el cron volvería a proponer lo mismo en cada
      // corrida.
      if (agent.requires_approval) {
        await db.from('ai_pending_replies').upsert(
          {
            workspace_id: agent.workspace_id,
            conversation_id: conversation.id,
            agent_id: agent.id,
            agent_name: agent.name ?? null,
            content_text: text,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'conversation_id' }
        );
        await db
          .from('conversations')
          .update({ pending_checkout_at: null, pending_checkout_url: null })
          .eq('id', conversation.id);
        return { sent: false, reason: 'awaiting_approval' };
      }
      const adapter = getAdapter(conversation.channel);
      await assertStoredConnectionCanSend(db, connection.id);
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
    const history = (
      (rows ?? []) as Array<{
        sender_type: string;
        content_text: string | null;
      }>
    )
      .reverse()
      .filter((m) => (m.content_text ?? '').trim());

    if (!history.some((m) => m.sender_type === 'customer')) {
      return { sent: false, reason: 'no_customer_message' };
    }

    // 2. Mensajes para el modelo. Debe arrancar con 'user' — recortamos
    //    cualquier mensaje 'assistant' al inicio.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> =
      history.map((m) => ({
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content: (m.content_text ?? '').trim(),
      }));
    while (messages.length && messages[0].role === 'assistant')
      messages.shift();
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

    const client = getAnthropic(apiKey, {
      db,
      workspaceId: agent.workspace_id,
      concepto: 'ia_seguimiento',
      detalle: { conversacion: conversation.id, canal: conversation.channel, para: 'seguimiento' },
      origenDeLaClave: resolvedKey.source,
    });
    const resp = await client.messages.create({
      model: agent.model || MODELO_POR_DEFECTO,
      // 400 alcanzaba para el mensaje; con un modelo que piensa antes de
      // escribir, lo que piensa sale del mismo presupuesto.
      max_tokens: reguladoPorEsfuerzo(agent.model || MODELO_POR_DEFECTO)
        ? 4400
        : 400,
      system: buildSystem(
        agent,
        silenceHours,
        args.campaignHint,
        reglasATexto(await cargarReglas(db, agent.workspace_id, agent.id)),
        await resolverRegistro({
          db,
          workspaceId: agent.workspace_id,
          idioma: agent.language,
          contact,
        })
      ),
      messages,
      ...esfuerzo(agent.model || MODELO_POR_DEFECTO, {
        effort: 'low',
        pensar: 'adaptive',
      }),
    });
    // El seguimiento se cobra aunque el modelo decida no escribir: pensarlo
    // costo igual, y el comercio recibio el servicio de que alguien mirara la
    // conversacion y decidiera.
    // Al que trae su clave de Anthropic ya le cobra Anthropic: cobrarle aca
    // seria cobrarle dos veces.

    const text = extractText(
      resp as unknown as { content?: Array<{ type?: string; text?: string }> }
    );
    if (!text || /^skip\.?$/i.test(text))
      return { sent: false, reason: 'model_skip' };
    // Marcado antes de recortar y de guardar: lo que se envía y lo que queda
    // en el hilo tienen que ser el mismo texto.
    const finalText = await prepararTextoParaCanal(db, {
      texto: largoDeChat(humanizarTexto(text), agent.max_response_chars),
      canal: conversation.channel,
      workspaceId: agent.workspace_id,
      contactId: contact.id,
    });
    if (!finalText) return { sent: false, reason: 'empty' };

    // Un agente que necesita aprobación tampoco manda seguimientos solo: el
    // seguimiento queda como propuesta, igual que una respuesta (migración 170).
    if (agent.requires_approval) {
      await db.from('ai_pending_replies').upsert(
        {
          workspace_id: agent.workspace_id,
          conversation_id: conversation.id,
          agent_id: agent.id,
          agent_name: agent.name ?? null,
          content_text: finalText,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'conversation_id' }
      );
      return { sent: false, reason: 'awaiting_approval' };
    }

    // 4. Envío por el canal (solo DM: whatsapp / instagram / messenger).
    const adapter = getAdapter(conversation.channel);
    await assertStoredConnectionCanSend(db, connection.id);
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
    if (isChannelDisconnectedError(err)) {
      return { sent: false, reason: 'channel_disconnected' };
    }
    console.error(
      '[ai/followup] failed for conversation',
      conversation.id,
      err
    );
    return { sent: false, reason: 'error' };
  }
}

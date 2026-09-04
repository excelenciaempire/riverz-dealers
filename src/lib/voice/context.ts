/**
 * Voice AI — system prompt + context builder.
 *
 * Single source of truth for the phone agent's brain: reuses the SAME
 * persona / knowledge / guardrails / catalog / order-policy that the text
 * runner builds (`buildSystemPrompt`), then layers a voice-specific
 * behavior block + the call objective + the order/cart context on top.
 * The Python worker pulls the result from GET /api/internal/voice/context.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Contact,
  Conversation,
  ShopifyCustomerSnapshot,
  VoiceCall,
  VoiceCallType,
} from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import {
  buildSystemPrompt,
  construirHerramientas,
  loadContext,
  loadRecentContactNotes,
  loadProductCatalog,
  resolveShopifyContext,
  type LoadedContext,
} from '@/lib/ai/runner';
import { BUSCAR_EN_INTERNET_TOOL } from '@/lib/ai/busqueda-web';
import { toolEnabled } from '@/lib/ai/toolbox';
import { cargarReglas, reglasATexto } from '@/lib/ai/guidance';
import { resolverRegistro } from '@/lib/ai/registro-rioplatense';
import { cargarPerfilOperativo } from '@/lib/operacion/perfil-operativo';
import { resolveStoreForLookup } from '@/lib/commerce/order-lookup';
import { topeDeDescuento } from '@/lib/shopify/discounts';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { loadPrimaryContact } from '@/lib/contacts/dedupe';
import {
  BUSINESS_FALLBACK,
  DEFAULT_GREETING_AR,
  DEFAULT_GREETINGS,
  DEFAULT_OBJECTIVES,
  DEFAULT_RECORDING_DISCLOSURE,
  RIOPLATENSE_SPEECH,
} from './constants';
import { getVoiceModelResolved, type VoiceMode } from './model-config';
import { effectiveBaseUrl } from './providers';
import { normalizeStack, resolveVoiceId } from './compat';
import {
  countryOfPhone,
  normalizeForDialing,
} from '@/lib/whatsapp/phone-utils';
import { publicVoiceContext, voiceExecutionMeta } from './execution-context';

/** A model layer's runtime coordinates for the worker. */
interface LayerCfg {
  provider: string;
  model: string;
  /** OpenAI-compatible endpoint (Modal) — null = use the built-in provider. */
  base_url: string | null;
  api_key: string | null;
}

/** Shape returned to the worker (GET /api/internal/voice/context). */
export interface VoiceContextPayload {
  call_id: string;
  direction: 'outbound' | 'inbound';
  call_type: VoiceCallType;
  phone: string;
  language: string;
  greeting: string;
  /** ¿El agente habla primero? Si es false, el worker no saluda y espera al cliente. */
  agent_greets_first: boolean;
  /** Segundos de espera antes de que el agente hable (sin apuro). */
  greeting_delay_seconds: number;
  /** Segundos de silencio del cliente antes de "¿sigues ahí?" y colgar (0 = off). */
  silence_timeout_seconds: number;
  system_prompt: string;
  /** Conversation engine mode (global admin setting). */
  mode: VoiceMode;
  voice: LayerCfg & { voice_id: string | null };
  llm: LayerCfg;
  stt: LayerCfg & { language: string };
  /** Present when mode='realtime' (full-duplex engine, e.g. PersonaPlex). */
  realtime: LayerCfg | null;
  /**
   * Estilo de habla del agente. 'rioplatense' hace que el worker reescriba el
   * texto fonéticamente antes del TTS (calle -> cashe) para marcar el acento.
   */
  speech_style: 'rioplatense' | null;
  /** Whether to record the call (compliance disclosure is in the greeting). */
  recording: { enabled: boolean };
  /** Warm/cold transfer target for the transfer_to_human tool. */
  transfer: { number: string | null };
  max_call_seconds: number;
  sip: { trunk_id: string | null; caller_number: string | null };
  contact: { id: string; name: string | null };
  /** Nombres, para el worker viejo que arma cada tool a mano. */
  tools_enabled: string[];
  /**
   * El esquema completo de cada herramienta. El worker las construye de acá,
   * genéricamente, así que sumar una capacidad al agente la deja disponible en
   * el teléfono sin desplegar el worker.
   */
  tools: { name: string; description: string; parameters: unknown }[];
}

/**
 * País por defecto para marcar, deducido del número de WhatsApp del comercio.
 * Sólo se usa cuando el teléfono del contacto está guardado en formato local
 * (sin código de país) y no hay dirección de Shopify de donde sacarlo.
 */
/**
 * Cómo se llama el comercio, para que el saludo lo diga.
 *
 * Sin esto el agente abría con «te llamo de parte de la tienda» y la clienta
 * respondía «¿cuál tienda?» antes de escuchar nada más.
 */
async function workspaceName(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data } = await db
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();
  return ((data as { name?: string } | null)?.name ?? '').trim() || null;
}

async function workspaceDialCountry(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data } = await db
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp')
    .limit(1)
    .maybeSingle();
  const display = (
    data as { config?: { display_phone_number?: string } } | null
  )?.config?.display_phone_number;
  return countryOfPhone(display);
}

function langOf(agent: AiAgent, call: VoiceCall): 'es' | 'en' {
  const l = (call.language || agent.language || 'es').toLowerCase().slice(0, 2);
  return l === 'en' ? 'en' : 'es';
}

/** Resolve the objective text for this call, honoring an automation override. */
function resolveObjective(agent: AiAgent, call: VoiceCall): string {
  const override =
    typeof call.context?.objective_override === 'string'
      ? (call.context.objective_override as string).trim()
      : '';
  if (override) return override;
  const configured =
    agent.voice_objectives?.[call.call_type]?.objective?.trim();
  if (configured) return configured;
  return DEFAULT_OBJECTIVES[call.call_type][langOf(agent, call)];
}

function contextValue(
  context: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = context[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
  }
  return '';
}

/**
 * The conversation used as an anchor for Riverz's cross-channel memory.
 * Explicit source wins; otherwise use the latest conversation of the same
 * unified person. A forged/manual source from another contact is ignored.
 */
export async function resolveVoiceContextConversation(
  db: SupabaseClient,
  call: VoiceCall,
  contact: Contact,
  primaryContact: Contact
): Promise<Conversation | null> {
  const meta = voiceExecutionMeta(call.context);
  if (meta?.conversationId) {
    const { data } = await db
      .from('conversations')
      .select('*')
      .eq('id', meta.conversationId)
      .eq('workspace_id', call.workspace_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) {
      const candidate = data as Conversation;
      const { data: sourceContactRow } = await db
        .from('contacts')
        .select('*')
        .eq('id', candidate.contact_id)
        .eq('workspace_id', call.workspace_id)
        .maybeSingle();
      if (sourceContactRow) {
        const sourcePrimary = await loadPrimaryContact(
          db,
          sourceContactRow as Contact
        );
        if (sourcePrimary.id === primaryContact.id) return candidate;
      }
    }
  }

  const { data: aliases } = await db
    .from('contacts')
    .select('id')
    .eq('workspace_id', call.workspace_id)
    .eq('unified_contact_id', primaryContact.id);
  const contactIds = [contact.id, primaryContact.id]
    .concat(((aliases ?? []) as { id: string }[]).map((row) => row.id))
    .filter((id, index, all) => all.indexOf(id) === index);
  const { data } = await db
    .from('conversations')
    .select('*')
    .eq('workspace_id', call.workspace_id)
    .in('contact_id', contactIds)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as Conversation | null) ?? null;
}

/**
 * Voice owns voice/operations; a linked chat assistant owns business knowledge.
 * An explicit assistant is used only when it really links to this voice profile.
 * For standalone/automation/inbound calls, one unambiguous link is inherited.
 */
export async function resolveVoiceBrainAgent(
  db: SupabaseClient,
  call: VoiceCall,
  voiceAgent: AiAgent,
  conversation: Conversation | null
): Promise<AiAgent> {
  const meta = voiceExecutionMeta(call.context);
  let candidateId = meta?.assistantId ?? null;

  if (!candidateId && conversation) {
    const { data } = await db
      .from('ai_replies')
      .select('agent_id')
      .eq('conversation_id', conversation.id)
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    candidateId =
      (data as { agent_id?: string | null } | null)?.agent_id ?? null;
  }

  if (candidateId) {
    const { data } = await db
      .from('ai_agents')
      .select('*')
      .eq('id', candidateId)
      .eq('workspace_id', call.workspace_id)
      .eq('voice_agent_id', voiceAgent.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) return data as AiAgent;
  }

  const { data: linked } = await db
    .from('ai_agents')
    .select('*')
    .eq('workspace_id', call.workspace_id)
    .eq('voice_agent_id', voiceAgent.id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .limit(2);
  return linked?.length === 1 ? (linked[0] as AiAgent) : voiceAgent;
}

/** Recent cross-channel turns, compact enough for a live-call latency budget. */
function recentConversationBlock(
  context: LoadedContext,
  lang: 'es' | 'en'
): string {
  const lines = context.messages
    .filter(
      (message) =>
        !/\b(queued|dialing|in_progress)\b/i.test(String(message.content ?? ''))
    )
    .slice(-12)
    .map((message) => {
      const who =
        message.role === 'user'
          ? lang === 'en'
            ? 'Customer'
            : 'Cliente'
          : lang === 'en'
            ? 'Business'
            : 'Negocio';
      return `${who}: ${String(message.content ?? '').trim()}`;
    })
    .filter((line) => !line.endsWith(': '));
  if (!lines.length) return '';
  const body = lines.join('\n').slice(-2400);
  return lang === 'en'
    ? `## Recent customer context\nUse this only as context; do not repeat it unless relevant.\n${body}`
    : `## Contexto reciente del cliente\nÚsalo sólo como contexto; no lo repitas salvo que sea relevante.\n${body}`;
}

export function interpolateVoiceGreeting(
  template: string,
  values: Record<string, string>
): string {
  const contactName = values.contact_name?.trim().split(/\s+/)[0] ?? '';
  return template
    .replace(
      /\{\{\s*contact_name\s*\}\}/gi,
      contactName ? ` ${contactName}` : ''
    )
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) =>
      Object.hasOwn(values, key.toLowerCase()) ? values[key.toLowerCase()] : ''
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

/**
 * Interpola sólo datos que realmente llegaron con la llamada. Las entrantes y
 * las pruebas normalmente no traen pedido; en ese caso el marcador desaparece
 * en vez de ser leído en voz alta o inventar información.
 */
function resolveGreeting(
  agent: AiAgent,
  contact: Contact,
  call: VoiceCall,
  isArgentina = false,
  businessName?: string | null
): string {
  const lang = langOf(agent, call);
  const fallback =
    isArgentina && lang === 'es'
      ? DEFAULT_GREETING_AR
      : DEFAULT_GREETINGS[lang];
  const raw = (agent.voice_greeting && agent.voice_greeting.trim()) || fallback;
  const context = call.context ?? {};
  const values: Record<string, string> = {
    contact_name: (contact.name ?? '').trim(),
    business_name: (businessName ?? '').trim() || BUSINESS_FALLBACK[lang],
    customer_name:
      contextValue(context, 'customer_name') || (contact.name ?? '').trim(),
    order_number: contextValue(context, 'order_number', 'order_name'),
    order_total: contextValue(context, 'order_total', 'total_price', 'total'),
    product_name: contextValue(context, 'product_name', 'product_title'),
    shipping_city: contextValue(context, 'shipping_city', 'city'),
    tracking_number: contextValue(context, 'tracking_number'),
  };
  return interpolateVoiceGreeting(raw, values);
}

/**
 * Voice-specific behavior block. Appended AFTER the shared system prompt so
 * the phone agent inherits the exact same persona/guardrails but speaks like
 * a person on a call.
 */
function buildVoiceInstructions(
  agent: AiAgent,
  call: VoiceCall,
  objective: string
): string {
  const lang = langOf(agent, call);
  const extra =
    agent.voice_objectives?.[call.call_type]?.extra_instructions?.trim();
  const ctx = publicVoiceContext(call.context);
  const contextLines = Object.entries(ctx)
    .filter(([k]) => k !== 'objective_override')
    .map(
      ([k, v]) =>
        `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
    )
    .join('\n');

  if (lang === 'en') {
    return [
      '## You are on a phone call',
      'You are speaking OUT LOUD on a live phone call, not typing. Everything you say is converted to speech.',
      'Rules for sounding human and natural:',
      '- Speak in short, simple sentences. One idea at a time.',
      '- Say numbers, prices and dates as words (e.g. "twenty-three thousand pesos", "March fifth"), never as digits or symbols.',
      '- No markdown, emojis, links, bullet points or asterisks, they cannot be spoken.',
      '- Ask only ONE question at a time, then wait for the answer.',
      '- Use natural fillers and acknowledgements ("sure", "got it", "one sec") so it flows.',
      '- If you need to read back an address or an order, do it slowly and confirm.',
      "- Never say you are an AI unless directly asked; act as a member of the store's team.",
      ...(call.direction === 'outbound'
        ? [
            '## YOU called THEM',
            'They did not ask for this call. They picked up an unknown number, so the first thing they need is who you are and why you are calling.',
            `- Your very first sentence after the greeting must say WHY you are calling, in plain words. Not "how can I help you": you called them, so the reason is yours to give.`,
            '- NEVER open with "how can I help you?" or "what can I do for you?". That flips the roles and makes people think it is a scam.',
            '- If they ask who you are or which store, answer immediately and concretely, with the business name, and then give the reason again in one short sentence.',
            '- Only state facts you actually have in the call context. If there is no order or cart in the context, do NOT claim they bought something.',
            '- Get to the point within the first two sentences. If they sound busy or confused, say the reason in one line and ask if it is a good time.',
          ]
        : []),
      '## Do not claim it is done before it is',
      'When you use a tool (send a WhatsApp, create an order, look up a shipment), the action has NOT happened until the tool returns its result.',
      '- Before using it, say what you are about to do in the present ("I am sending it over WhatsApp now").',
      '- Only AFTER the tool comes back successfully, say it is done.',
      '- If the tool fails or does not respond, say so honestly and offer another way. Never say "done" or "I just sent it" without having confirmed it.',
      '## Prices are read, not computed',
      'The offers and prices above are a CLOSED list, not a basis for arithmetic.',
      '- Quote ONLY a price that appears verbatim in the list, with the exact unit count from that same line.',
      '- NEVER add, multiply, combine or repeat packs to build a quantity that is not listed. If the customer asks for a quantity with no offer of its own, offer the closest listed option and state its exact units and price.',
      '- If you are unsure about a price or what it includes, say so and offer to send it over WhatsApp. Making a number up is worse than not knowing it.',
      '- Do not promise gifts, discounts or shipping that are not written there.',
      '## Sound like a person, not a script',
      'You are having a CONVERSATION, not reciting. Nobody wants a catalog read to them over the phone.',
      '- React to what the customer says before moving on. If they share something, acknowledge it.',
      '- Never dump two or three things in a row. Say one, then ask.',
      "- If you don't know something about the customer that changes what you'd offer, ASK before offering.",
      '- Vary how you say things. Reusing the same phrasing is exactly what sounds robotic.',
      '- No spoken lists ("option one, option two, option three"). That is a form, not a chat.',
      '## Sell well (without pushing)',
      'You are a good salesperson: you listen, you understand what they need it for, and only then recommend.',
      '- Understand the need with one or two short questions first. Then recommend.',
      '- Recommend ONE concrete option, the one that fits them best, and say why it suits THEM. Do not list the whole menu.',
      '- If they ask about all the options, say them in one natural flowing sentence, like you would to a friend, not as a numbered list.',
      '- ALWAYS ask how many units they want before closing. It is the question that moves the sale the most.',
      '- If a bigger pack is a better deal, mention it as an advantage for them, in one sentence, once.',
      '- On an objection: listen, acknowledge it, answer short and honestly, and hand back a question.',
      '- If they say no, accept it the first time. Pushing twice loses both the sale and the customer.',
      '## Links and data you cannot dictate',
      'NEVER say a web address, an email or a long code out loud: they are unintelligible over the phone and spelling them out sounds terrible.',
      'When you have a payment link, do NOT read it. Say you are sending it over WhatsApp and use send_whatsapp to send it. Confirm they got it.',
      `Objective of THIS call: ${objective}`,
      contextLines ? `Call context:\n${contextLines}` : '',
      extra ? `Extra instructions: ${extra}` : '',
      '## Ending the call (important, always end cleanly)',
      'ALWAYS end by saying a short, warm goodbye OUT LOUD and THEN calling end_call to hang up, never go silent or leave the line open.',
      'End the call when ANY of these happens: the objective is met; the customer says goodbye ("thanks, bye", "that\'s all", "nothing else"); the customer clearly has nothing more to ask; or the conversation has naturally finished.',
      'To end: (1) briefly confirm the outcome, (2) call report_outcome with the result, (3) say a cordial one-line goodbye ("Perfect, thank you so much, have a great day!"), (4) call end_call. Do this promptly, do not linger or repeat yourself.',
      '## Voicemail / answering machine',
      'You spoke the greeting first. If what answers is NOT a real person talking WITH you but a recording, a voicemail/answering-machine greeting ("you\'ve reached…", "leave a message after the tone", "I\'m not available"), an automated menu/IVR, a beep, or a long one-way message that ignores you, then call detected_answering_machine IMMEDIATELY and hang up. Do NOT leave a message and do NOT keep talking.',
      'If the customer asks not to be called again, call customer_requests_no_more_calls, apologize briefly, say goodbye and hang up.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '## Estás en una llamada telefónica',
    'Estás hablando EN VOZ ALTA en una llamada en vivo, no estás escribiendo. Todo lo que digas se convierte en audio.',
    'Reglas para sonar humano y natural:',
    '- Habla con frases cortas y simples. Una idea a la vez.',
    '- Di los números, precios y fechas con palabras (ej. "veintitrés mil pesos", "cinco de marzo"), nunca con dígitos ni símbolos.',
    '- Sin markdown, emojis, links, viñetas ni asteriscos, no se pueden pronunciar.',
    '- Haz UNA sola pregunta a la vez y espera la respuesta.',
    '- Usa muletillas y confirmaciones naturales ("claro", "perfecto", "un momento") para que fluya.',
    '- Si tienes que repetir una dirección o un pedido, hazlo despacio y confirma.',
    '- Nunca digas que eres una IA a menos que te lo pregunten directamente; actúa como alguien del equipo de la tienda.',
    // Lo que faltaba, visto en la primera llamada real: el agente abrió con
    // «te llamo de parte de la tienda», la clienta preguntó «¿cuál tienda?», y
    // en vez de decir para qué llamaba respondió «¿en qué puedo ayudarte?».
    // Ella contestó «¿qué me llamas?» y colgó. Nunca supo por qué sonó el
    // teléfono, y encima el agente le afirmó una compra que no estaba en el
    // contexto de la llamada.
    ...(call.direction === 'outbound'
      ? [
          '## Vos llamaste, no al revés',
          'La persona no pidió esta llamada. Atendió un número desconocido, así que lo primero que necesita saber es quién sos y para qué la llamás.',
          '- Tu primera frase después del saludo tiene que decir POR QUÉ llamás, en palabras simples. El motivo lo ponés vos, que sos quien llamó.',
          '- NUNCA abras con "¿en qué puedo ayudarte?" ni "¿qué necesitas?". Invierte los roles y hace que la llamada parezca un engaño.',
          '- Si te preguntan quién sos o de qué tienda, respondé al toque y concreto, con el nombre del negocio, y volvé a dar el motivo en una frase corta.',
          '- Afirmá SÓLO lo que está en el contexto de la llamada. Si ahí no hay un pedido ni un carrito, no digas que compró algo: inventarlo quema la confianza en el primer minuto.',
          '- Andá al punto en las primeras dos frases. Si la persona suena ocupada o confundida, decí el motivo en una línea y preguntá si es buen momento.',
        ]
      : []),
    // El error más caro visto en producción (2026-08-28). El cliente pidió 8
    // unidades; las ofertas eran 1=$39.990, 3=$69.900, 4=$99.900. El agente
    // inventó «llevá el pack de 4 dos veces, son 8 unidades por 99.900 pesos»:
    // combinó packs por su cuenta y cobró ocho unidades al precio de cuatro.
    // Un modelo haciendo aritmética de packs en voz alta, sin poder chequear
    // nada, regala la mitad del pedido sin que nadie se entere hasta facturar.
    // En la llamada del 2026-08-28 el agente dijo «un momento, déjame generar
    // el link», después «ya está», y después «te lo acabo de mandar». No mandó
    // nada: el link nunca salió. El cliente colgó esperando un WhatsApp que no
    // existía. Narrar el resultado antes de tenerlo es la peor promesa posible,
    // porque el cliente se va convencido de que ya está resuelto.
    '## No cantes victoria antes de tiempo',
    'Cuando uses una herramienta (mandar un WhatsApp, crear un pedido, buscar un envío), la acción NO ocurrió hasta que la herramienta te devuelve el resultado.',
    '- Antes de usarla, avisá en presente lo que vas a hacer ("te lo mando por WhatsApp ahora").',
    '- Recién DESPUÉS de que la herramienta responde bien, decí que está hecho.',
    '- Si la herramienta falla o no responde, decilo con honestidad y ofrecé otra vía. Nunca digas "ya está" ni "ya te lo mandé" sin haberlo confirmado.',
    '## Los precios se leen, no se calculan',
    'Las ofertas y los precios que tenés arriba son una lista CERRADA. No son una base para hacer cuentas.',
    '- Decí SÓLO un precio que figure tal cual en la lista, con las unidades que dice esa misma línea.',
    '- NUNCA sumes, multipliques, combines ni repitas packs para armar una cantidad que no está. Si el cliente pide una cantidad sin oferta propia, ofrecé la opción de la lista más cercana y decí sus unidades y su precio exactos.',
    '- Si no estás seguro de un precio o de qué incluye, decilo y ofrecé mandarlo por WhatsApp. Inventar un número es peor que no saberlo.',
    '- No prometas regalos, descuentos ni envíos que no estén escritos ahí.',
    '## Suena a persona, no a guion',
    'Estás CONVERSANDO, no recitando. Nadie quiere que le lean un catálogo por teléfono.',
    '- Reaccioná a lo que dice el cliente antes de seguir con lo tuyo. Si te cuenta algo, comentalo.',
    '- Nunca sueltes dos o tres cosas seguidas de corrido. Decí una, y preguntá.',
    '- Si no sabés algo del cliente que cambia lo que le vas a ofrecer, PREGUNTÁLO antes de ofrecer.',
    '- Variá cómo lo decís. Si ya usaste una frase, buscá otra: repetir la misma fórmula es lo que suena a robot.',
    '- Nada de listas habladas ("opción uno, opción dos, opción tres"). Eso es un formulario, no una charla.',
    '## Vendé bien (sin apretar)',
    'Sos un buen vendedor: escuchás, entendés para qué lo quiere, y recién ahí recomendás.',
    '- Primero entendé la necesidad con una o dos preguntas cortas. Después recomendá.',
    '- Recomendá UNA opción concreta, la que mejor le sirva, y decí por qué le conviene a ÉL. No enumeres todo el menú.',
    '- Si preguntan por todas las opciones, contálas en una frase fluida y natural, como se lo dirías a un amigo, no como una lista numerada.',
    '- Preguntá SIEMPRE cuántas unidades quiere llevar antes de cerrar. Es la pregunta que más cambia la venta.',
    '- Si hay una promo mejor por llevar más, mencionala como una ventaja para él, en una frase, una sola vez.',
    '- Ante una objeción: escuchá, reconocela, respondé corto y honesto, y devolvé una pregunta.',
    '- Si dice que no, aceptalo a la primera. Insistir dos veces pierde la venta y al cliente.',
    '## Links y datos que no se pueden dictar',
    'NUNCA digas en voz alta una dirección web, un correo ni un código largo: no se entienden por teléfono y suena pésimo deletrearlos.',
    'Cuando tengas un link de pago, NO lo leas. Decí que se lo mandás por WhatsApp y usá send_whatsapp para enviárselo. Confirmá que le llegó.',
    `Objetivo de ESTA llamada: ${objective}`,
    contextLines ? `Contexto de la llamada:\n${contextLines}` : '',
    extra ? `Instrucciones adicionales: ${extra}` : '',
    '## Cómo terminar la llamada (importante, siempre cierra bien)',
    'SIEMPRE termina diciendo una despedida corta y cordial EN VOZ ALTA y LUEGO llama a end_call para colgar, nunca te quedes en silencio ni dejes la línea abierta.',
    'Termina la llamada cuando pase CUALQUIERA de estas: cumpliste el objetivo; el cliente se despide ("listo, gracias", "eso es todo", "nada más"); el cliente claramente no tiene más que preguntar; o la conversación terminó de forma natural.',
    'Para terminar: (1) confirma brevemente el resultado, (2) llama a report_outcome con el resultado, (3) di una despedida cordial de una línea ("¡Perfecto, muchas gracias, que tengas un lindo día!"), (4) llama a end_call. Hazlo pronto, no te quedes dando vueltas ni repitas lo mismo.',
    '## Buzón de voz / contestador',
    'Vos saludaste primero. Si lo que contesta NO es una persona real hablando CON vos sino una grabación, un saludo de buzón/contestador ("dejá tu mensaje después del tono", "no estoy disponible", "has llamado a…"), un menú automático/IVR, un tono/beep, o un mensaje largo de una sola vía que te ignora, entonces llama a detected_answering_machine DE INMEDIATO y cuelga. NO dejes mensaje y NO sigas hablando.',
    'Si el cliente pide que no lo llamen más, llama a customer_requests_no_more_calls, discúlpate brevemente, despídete y cuelga.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Build the full context payload the voice worker needs to run a call.
 * Reuses the text runner's loaders so the phone agent behaves identically
 * to the chat agent (same catalog, guardrails, order policy).
 */
export async function buildVoiceContext(
  db: SupabaseClient,
  call: VoiceCall,
  opts: {
    trunkId: string | null;
    callerNumber: string | null;
    recordingEnabled?: boolean;
    /** Decir en voz alta que la llamada puede ser grabada (default: no). */
    recordingDisclosure?: boolean;
    transferNumber?: string | null;
    /** ¿El agente habla primero? (resuelto por dirección en el route). */
    agentGreetsFirst?: boolean;
    /** Segundos de espera antes de que el agente hable (sin apuro). */
    greetingDelaySeconds?: number;
    /** Segundos de silencio del cliente antes de "¿sigues ahí?" y colgar (0 = off). */
    silenceTimeoutSeconds?: number;
  }
): Promise<VoiceContextPayload> {
  const { data: agentRow } = await db
    .from('ai_agents')
    .select('*')
    .eq('id', call.agent_id)
    .maybeSingle();
  if (!agentRow) throw new Error(`voice agent ${call.agent_id} not found`);
  const voiceAgent = agentRow as AiAgent;

  const { data: contactRow } = await db
    .from('contacts')
    .select('*')
    .eq('id', call.contact_id)
    .maybeSingle();
  if (!contactRow)
    throw new Error(`voice contact ${call.contact_id} not found`);
  const contact = contactRow as Contact;
  const primaryContact = await loadPrimaryContact(db, contact);
  const contextConversation = await resolveVoiceContextConversation(
    db,
    call,
    contact,
    primaryContact
  );
  const resolvedBrain = await resolveVoiceBrainAgent(
    db,
    call,
    voiceAgent,
    contextConversation
  );
  // The origin decides the language for this call; everything else comes from
  // the assistant brain (when linked) or the self-contained voice profile.
  const agent: AiAgent = {
    ...resolvedBrain,
    language: call.language || resolvedBrain.language,
  };

  const businessCurrency = await resolveWorkspaceCurrency(
    db,
    call.workspace_id
  );

  // Same Shopify context the chat agent uses (order policy + tools). No
  // pinned product for a call (there's no message to detect from).
  const shopify = await resolveShopifyContext(
    db,
    call.workspace_id,
    contact,
    null
  );
  if (shopify) {
    shopify.canCreateOrders = agent.puede_crear_pedidos === true;
    shopify.workspaceId = call.workspace_id;
    shopify.agentId = agent.id;
    shopify.contactId = primaryContact.id;
    shopify.conversationId = contextConversation?.id ?? call.conversation_id;
    shopify.channel = 'voice';
    shopify.contactName = contact.name ?? null;
    shopify.currency = shopify.config?.currency || businessCurrency;
  }

  const products = await loadProductCatalog(db, agent, call.workspace_id, null);
  const emptyContext: LoadedContext = {
    messages: [],
    rollingSummary: null,
    idleResetHint: null,
  };
  const sharedContext = contextConversation
    ? await loadContext(
        db,
        contextConversation,
        Math.min(30, Math.max(1, agent.context_messages || 30))
      )
    : emptyContext;
  const shopifySnapshot =
    (primaryContact.shopify_customer_data as ShopifyCustomerSnapshot | null) ??
    null;
  const recentNotes = await loadRecentContactNotes(db, primaryContact.id);
  const reglas = reglasATexto(
    await cargarReglas(db, call.workspace_id, agent.id)
  );
  const perfilOperativo = await cargarPerfilOperativo(db, call.workspace_id);
  const registro = await resolverRegistro({
    db,
    workspaceId: call.workspace_id,
    idioma: agent.language,
    contact,
    primaryContact,
    paisEnLaTienda:
      (shopifySnapshot?.default_address as
        | { country_code?: string | null }
        | undefined)?.country_code ??
      shopifySnapshot?.default_address?.country ??
      null,
  });

  const base = buildSystemPrompt(
    agent,
    contact,
    primaryContact,
    shopifySnapshot,
    recentNotes,
    sharedContext,
    products,
    null,
    shopify,
    null,
    businessCurrency,
    reglas,
    registro,
    perfilOperativo
  );

  const objective = resolveObjective(voiceAgent, call);

  // In-call upsell: only on order confirmation, when enabled, and when we have
  // an order to edit (order_id in context) and a Shopify connection.
  const upsell = voiceAgent.voice_objectives?.order_confirmation?.upsell;
  const upsellOn =
    call.call_type === 'order_confirmation' &&
    !!upsell?.enabled &&
    !!shopify &&
    !!call.context?.order_id;

  const lang0 = langOf(agent, call);
  const upsellBlock = upsellOn
    ? '\n' +
      (lang0 === 'en'
        ? `## Upsell\nAfter confirming the order, naturally offer more units${upsell?.discount ? ` (${upsell.discount})` : ''}. ${upsell?.offer_text ?? ''} If they accept, call update_order with the extra units, it updates the real order. Only once, only after they clearly say yes.`
        : `## Upsell\nDespués de confirmar el pedido, ofrecé con naturalidad llevar más unidades${upsell?.discount ? ` (${upsell.discount})` : ''}. ${upsell?.offer_text ?? ''} Si acepta, llamá update_order con las unidades extra, actualiza el pedido real. Una sola vez, sólo cuando diga que sí claramente.`)
    : '';

  // Instrucciones de sistema propias de las llamadas (campo del agente). Se suman
  // al persona base + bloque de voz; el comercio las edita en la pestaña Llamadas.
  const voiceSystem = voiceAgent.voice_system_prompt?.trim();
  const voiceSystemBlock = voiceSystem
    ? `\n\n${lang0 === 'en' ? '## Call instructions' : '## Instrucciones de la llamada'}\n${voiceSystem}`
    : '';

  // El sistema decide el formato marcable ANTES de llamar: normaliza el teléfono
  // a E.164 por país (incl. el 9 de móvil AR) en vez de marcar lo que venga
  // guardado. El país sólo hace falta cuando el número está en formato local:
  // primero la dirección de Shopify, y si no hay, el país del propio número de
  // WhatsApp del comercio (sus clientes suelen ser del mismo país). Fail-soft:
  // si no se puede resolver, marca lo guardado.
  const dialCountry =
    (
      shopifySnapshot as {
        default_address?: { country_code?: string | null };
      } | null
    )?.default_address?.country_code ??
    (await workspaceDialCountry(db, call.workspace_id));
  const dialPhone = normalizeForDialing(call.phone, dialCountry) || call.phone;

  // ¿Del otro lado hay un argentino? Se decide por el país del NÚMERO ya
  // normalizado (sirve igual para salientes y entrantes), no por el del
  // comercio: una tienda colombiana que le vende a Buenos Aires también habla
  // rioplatense en esa llamada. Sólo aplica en español.
  const isArgentina = lang0 === 'es' && countryOfPhone(dialPhone) === 'AR';

  const rioplatenseBlock = isArgentina ? `\n\n${RIOPLATENSE_SPEECH}` : '';

  const conversationBlock = recentConversationBlock(
    sharedContext,
    langOf(agent, call)
  );
  const voiceBlock =
    buildVoiceInstructions(voiceAgent, call, objective) +
    upsellBlock +
    rioplatenseBlock +
    voiceSystemBlock +
    (conversationBlock ? `\n\n${conversationBlock}` : '');

  // El system prompt se re-envía en CADA turno, así que su tamaño multiplica el
  // costo, la latencia y los tokens-por-minuto. El grueso vive en `base`
  // (catálogo/ficha de producto); lo acotamos a un presupuesto de caracteres y
  // NUNCA tocamos el bloque de comportamiento de voz.
  //
  // El techo bajó de 14.000 a 6.000 el 2026-08-28, midiendo una llamada real:
  // con 14k el prompt pesaba ~5.600 tokens POR TURNO, y el plan gratis de Groq
  // corta en 8.000 tokens por minuto. O sea que el segundo turno daba 429
  // siempre: el agente saludaba, contestaba una vez y se quedaba mudo mientras
  // el cliente seguía hablando. No era azar, era aritmética.
  //
  // Seis mil caracteres siguen siendo una ficha de producto entera; lo que se
  // recorta es la cola del catálogo, y para eso está la línea que le dice al
  // agente que pregunte si necesita un detalle puntual.
  // Configurable con VOICE_SYSTEM_PROMPT_MAX_CHARS.
  const PROMPT_CHAR_BUDGET = Number(
    process.env.VOICE_SYSTEM_PROMPT_MAX_CHARS || 6000
  );
  const baseTrimmed =
    base.length > PROMPT_CHAR_BUDGET
      ? base.slice(0, PROMPT_CHAR_BUDGET) +
        (langOf(agent, call) === 'en'
          ? '\n\n[Product details truncated, ask the customer for specifics if needed.]'
          : '\n\n[Ficha de producto recortada, si hace falta un detalle puntual, pregúntalo al cliente.]')
      : base;

  // WhatsApp durante la llamada: sólo se ofrece si el workspace lo tiene
  // conectado. Darle la tool a un agente sin WhatsApp lo llevaría a prometer
  // "ya te lo mando" y que nunca llegue nada.
  const { data: waCfg } = await db
    .from('whatsapp_config')
    .select('phone_number_id')
    .eq('workspace_id', call.workspace_id)
    .maybeSingle();
  const hasWhatsApp = !!(waCfg as { phone_number_id?: string } | null)
    ?.phone_number_id;

  /**
   * Todo lo que el agente sabe hacer, también por teléfono.
   *
   * Esto era una lista a mano de cinco herramientas —pedido, checkout, crear
   * pedido, editar pedido, WhatsApp— mientras el mismo agente por chat tenía
   * diecisiete. El teléfono quedaba con un agente mutilado: no podía buscar un
   * producto en el catálogo, ni abrir una devolución, ni mirar la ficha del
   * cliente, ni anotar lo que no supo contestar. Y se notó caro: sin
   * `buscar_producto` el modelo inventó de memoria una oferta que no existía y
   * cotizó ocho unidades al precio de cuatro.
   *
   * Ahora sale de `construirHerramientas`, la MISMA función que arma las del
   * chat, así que respeta la pizarra del comercio (apagada / con aprobación /
   * automática) y una capacidad nueva llega a la llamada sin tocar nada acá.
   *
   * Se sacan dos que no significan nada en una llamada: `escalate_to_call`
   * (ya estamos en una) y la búsqueda web, que es una tool de servidor y en
   * mitad de una conversación hablada tarda más de lo que nadie espera.
   */
  const otherStore = shopify
    ? null
    : await (async () => {
        const t = await resolveStoreForLookup(db, call.workspace_id);
        if (!t || t.platform === 'shopify') return null;
        return { ...t, customerEmail: null, customerPhone: null };
      })();
  const topeDescuento = await topeDeDescuento(db, call.workspace_id).catch(
    () => 0
  );

  const NO_EN_LLAMADA = new Set(['escalate_to_call']);
  const herramientas = construirHerramientas({
    agent,
    hayContacto: true,
    shopify,
    otherStore,
    voiceCtx: null,
    topeDescuento,
  })
    // Sólo las de esquema propio. La de servidor —la búsqueda web— no tiene
    // `input_schema` y se cae acá; vuelve más abajo por el puente, como una
    // herramienta común.
    .map(
      (t) =>
        t as unknown as {
          name?: string;
          description?: string;
          input_schema?: unknown;
        }
    )
    .filter(
      (t): t is { name: string; description?: string; input_schema: unknown } =>
        typeof t.name === 'string' && t.input_schema !== undefined
    )
    .filter((t) => !NO_EN_LLAMADA.has(t.name));

  // El upsell en llamada necesita un pedido en contexto; sin eso `update_order`
  // no tiene sobre qué trabajar y sólo confunde al modelo.
  const utiles = herramientas.filter(
    (t) => t.name !== 'update_order' || upsellOn
  );

  const toolSpecs = [
    ...utiles.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema,
    })),
    // Sólo del teléfono: un link no se puede dictar en voz alta, así que se
    // manda por WhatsApp al mismo número al que se está llamando.
    ...(hasWhatsApp
      ? [
          {
            name: 'send_whatsapp',
            description:
              'Envía un WhatsApp al mismo número de esta llamada. Úsalo para mandar links de pago, datos de transferencia, seguimiento del envío, información de un producto o el resumen de lo acordado: todo lo que no se pueda dictar por teléfono. ESPERÁ el resultado antes de decir que lo mandaste: si devuelve un error, decíselo al cliente y ofrecé otra vía.',
            parameters: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: 'El mensaje a enviar. Claro y completo.',
                },
                // Fuera de la ventana de 24 h de Meta sólo se puede escribir con
                // una plantilla aprobada, y hay una por escenario. El encabezado
                // es lo único que el cliente lee antes de abrir el mensaje, así
                // que elegir bien acá es la diferencia entre que lo lea o no.
                scenario: {
                  type: 'string',
                  enum: [
                    'link_de_pago',
                    'transferencia',
                    'resumen_pedido',
                    'info_producto',
                    'seguimiento_envio',
                    'otro',
                  ],
                  description:
                    'Qué te pidió el cliente: link_de_pago para completar una compra, transferencia para los datos bancarios, resumen_pedido para confirmar lo acordado, info_producto para la ficha de un producto, seguimiento_envio para el estado de un envío, otro si no encaja en ninguno.',
                },
              },
              required: ['text', 'scenario'],
            },
          },
        ]
      : []),
    // Internet. La corre el servidor y vuelve como texto, así que para el
    // worker es una herramienta común. Sigue la misma pizarra que el chat:
    // nace apagada y se enciende por agente.
    ...(toolEnabled(agent, 'buscar_en_internet')
      ? [
          {
            name: BUSCAR_EN_INTERNET_TOOL.name,
            description: BUSCAR_EN_INTERNET_TOOL.description ?? '',
            parameters: BUSCAR_EN_INTERNET_TOOL.input_schema,
          },
        ]
      : []),
  ];

  const toolsEnabled = toolSpecs.map((t) => t.name);

  // Global model stack (platform-admin setting). STT/TTS/mode + endpoints are
  // platform-wide; the LLM model still honors a per-agent override when set.
  // `normalizeStack` es la red de seguridad de lectura: si la fila quedó torcida
  // (modelo/voz/endpoint de un proveedor anterior), el worker igual recibe algo
  // coherente en vez de una llamada muda.
  const { config: model, changes } = normalizeStack(
    await getVoiceModelResolved(db)
  );
  if (changes.length) {
    console.warn(
      '[voice/context] stack corregido al vuelo',
      changes.map((c) => `${c.layer}.${c.field}: ${c.from} → ${c.to}`)
    );
  }

  // El aviso de grabación se antepone al saludo SÓLO si el comercio lo pide
  // (Ajustes → Voz). Va aparte de `recordingEnabled` porque son dos decisiones
  // distintas: grabar y avisar. Grabar sin avisar es ilegal en varios sitios
  // (estados de consentimiento de ambas partes en EE.UU., RGPD en la UE), y esa
  // decisión es del comercio, que es quien conoce a quién llama.
  const lang = langOf(agent, call);
  const negocio = await workspaceName(db, call.workspace_id);
  let greeting = resolveGreeting(
    voiceAgent,
    contact,
    call,
    isArgentina,
    negocio
  );
  const recordingEnabled =
    voiceAgent.voice_recording_enabled ?? opts.recordingEnabled ?? true;
  const recordingDisclosure =
    voiceAgent.voice_recording_disclosure ?? opts.recordingDisclosure ?? false;
  if (recordingEnabled && recordingDisclosure) {
    greeting = `${DEFAULT_RECORDING_DISCLOSURE[lang]} ${greeting}`;
  }

  return {
    call_id: call.id,
    direction: call.direction,
    call_type: call.call_type,
    phone: dialPhone,
    language: lang,
    greeting,
    agent_greets_first: opts.agentGreetsFirst !== false,
    greeting_delay_seconds: Math.max(
      0,
      Math.min(Number(opts.greetingDelaySeconds) || 0, 10)
    ),
    silence_timeout_seconds: Math.max(
      0,
      Math.min(Number(opts.silenceTimeoutSeconds ?? 8), 60)
    ),
    system_prompt: `${baseTrimmed}\n\n${voiceBlock}`,
    mode: model.mode,
    voice: {
      provider: model.tts_provider,
      // La voz del agente manda, salvo que no sea del proveedor activo (un id
      // de ElevenLabs en Fish deja la llamada muda) → default de la plataforma
      // → default del catálogo. En realtime la voz la nombra el motor S2S.
      voice_id:
        model.mode === 'realtime'
          ? resolveVoiceId(
              'realtime',
              model.realtime_provider,
              voiceAgent.voice_id,
              model.tts_default_voice_id
            )
          : resolveVoiceId(
              'tts',
              model.tts_provider,
              voiceAgent.voice_id,
              model.tts_default_voice_id
            ),
      model: model.tts_model,
      // OpenAI/VoxCPM enrutan por base_url; deepgram/cartesia/elevenlabs/gemini
      // no tienen baseUrl en el catálogo → null → plugin nativo del worker.
      base_url: effectiveBaseUrl('tts', model.tts_provider, model.tts_base_url),
      api_key: model.tts_api_key,
    },
    llm: (() => {
      // base_url efectivo: el de la config o el del catálogo del proveedor (Groq,
      // Gemini, Cerebras, OpenAI… enrutan por OpenAI-compat). Anthropic = null → nativo.
      const llmBase = effectiveBaseUrl(
        'llm',
        model.llm_provider,
        model.llm_base_url
      );
      return {
        provider: model.llm_provider,
        // Con endpoint OpenAI-compat el NOMBRE de modelo lo dicta ese endpoint →
        // usamos el de la config, NO el agent.model (que puede ser de otro
        // proveedor, ej. claude-*, y rompería el endpoint). Sin base_url (Anthropic)
        // respetamos el override por-agente.
        model: llmBase
          ? model.llm_model || agent.model
          : agent.model || model.llm_model,
        base_url: llmBase,
        api_key: model.llm_api_key,
      };
    })(),
    stt: {
      provider: model.stt_provider,
      model: model.stt_model,
      language: model.stt_language,
      // Deepgram = nativo (sin baseUrl); openai/groq (whisper) enrutan por base_url.
      base_url: effectiveBaseUrl('stt', model.stt_provider, model.stt_base_url),
      api_key: model.stt_api_key,
    },
    realtime:
      model.mode === 'realtime' &&
      model.realtime_provider &&
      model.realtime_model
        ? {
            provider: model.realtime_provider,
            model: model.realtime_model,
            base_url: model.realtime_base_url,
            api_key: model.realtime_api_key,
          }
        : null,
    speech_style: isArgentina ? 'rioplatense' : null,
    recording: { enabled: recordingEnabled },
    transfer: {
      // La persona correcta depende del agente (ventas, soporte, cobros).
      // El valor antiguo de la conexión queda como fallback de compatibilidad.
      number: voiceAgent.voice_transfer_number ?? opts.transferNumber ?? null,
    },
    max_call_seconds: voiceAgent.voice_max_call_seconds || 300,
    sip: { trunk_id: opts.trunkId, caller_number: opts.callerNumber },
    contact: { id: contact.id, name: contact.name ?? null },
    tools_enabled: toolsEnabled,
    tools: toolSpecs,
  };
}

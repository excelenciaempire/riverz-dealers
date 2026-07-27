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
  ShopifyCustomerSnapshot,
  VoiceCall,
  VoiceCallType,
} from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import {
  buildSystemPrompt,
  loadProductCatalog,
  resolveShopifyContext,
  type LoadedContext,
} from '@/lib/ai/runner';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { loadPrimaryContact } from '@/lib/contacts/dedupe';
import {
  DEFAULT_GREETINGS,
  DEFAULT_OBJECTIVES,
  DEFAULT_RECORDING_DISCLOSURE,
} from './constants';
import { getVoiceModelResolved, type VoiceMode } from './model-config';
import { effectiveBaseUrl } from './providers';
import { countryOfPhone, normalizeForDialing } from '@/lib/whatsapp/phone-utils';

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
  system_prompt: string;
  /** Conversation engine mode (global admin setting). */
  mode: VoiceMode;
  voice: LayerCfg & { voice_id: string | null };
  llm: LayerCfg;
  stt: LayerCfg & { language: string };
  /** Present when mode='realtime' (full-duplex engine, e.g. PersonaPlex). */
  realtime: LayerCfg | null;
  /** Whether to record the call (compliance disclosure is in the greeting). */
  recording: { enabled: boolean };
  /** Warm/cold transfer target for the transfer_to_human tool. */
  transfer: { number: string | null };
  max_call_seconds: number;
  sip: { trunk_id: string | null; caller_number: string | null };
  contact: { id: string; name: string | null };
  tools_enabled: string[];
}

/**
 * País por defecto para marcar, deducido del número de WhatsApp del comercio.
 * Sólo se usa cuando el teléfono del contacto está guardado en formato local
 * (sin código de país) y no hay dirección de Shopify de donde sacarlo.
 */
async function workspaceDialCountry(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await db
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp')
    .limit(1)
    .maybeSingle();
  const display = (data as { config?: { display_phone_number?: string } } | null)
    ?.config?.display_phone_number;
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
  const configured = agent.voice_objectives?.[call.call_type]?.objective?.trim();
  if (configured) return configured;
  return DEFAULT_OBJECTIVES[call.call_type][langOf(agent, call)];
}

/** Interpolate {{contact_name}} in the greeting; falls back to a default. */
function resolveGreeting(agent: AiAgent, contact: Contact, call: VoiceCall): string {
  const raw =
    (agent.voice_greeting && agent.voice_greeting.trim()) ||
    DEFAULT_GREETINGS[langOf(agent, call)];
  const first = (contact.name ?? '').trim().split(/\s+/)[0] ?? '';
  // "{{contact_name}}" is meant to sit after "Hola"/"Hi" — inject a leading
  // space + name when known, or collapse to nothing so it reads naturally.
  return raw.replace(/\{\{\s*contact_name\s*\}\}/gi, first ? ` ${first}` : '');
}

/**
 * Voice-specific behavior block. Appended AFTER the shared system prompt so
 * the phone agent inherits the exact same persona/guardrails but speaks like
 * a person on a call.
 */
function buildVoiceInstructions(
  agent: AiAgent,
  call: VoiceCall,
  objective: string,
): string {
  const lang = langOf(agent, call);
  const extra = agent.voice_objectives?.[call.call_type]?.extra_instructions?.trim();
  const ctx = call.context ?? {};
  const contextLines = Object.entries(ctx)
    .filter(([k]) => k !== 'objective_override')
    .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');

  if (lang === 'en') {
    return [
      '## You are on a phone call',
      "You are speaking OUT LOUD on a live phone call — not typing. Everything you say is converted to speech.",
      'Rules for sounding human and natural:',
      '- Speak in short, simple sentences. One idea at a time.',
      '- Say numbers, prices and dates as words (e.g. "twenty-three thousand pesos", "March fifth"), never as digits or symbols.',
      '- No markdown, emojis, links, bullet points or asterisks — they cannot be spoken.',
      '- Ask only ONE question at a time, then wait for the answer.',
      '- Use natural fillers and acknowledgements ("sure", "got it", "one sec") so it flows.',
      '- If you need to read back an address or an order, do it slowly and confirm.',
      "- Never say you are an AI unless directly asked; act as a member of the store's team.",
      `Objective of THIS call: ${objective}`,
      contextLines ? `Call context:\n${contextLines}` : '',
      extra ? `Extra instructions: ${extra}` : '',
      '## Ending the call (important — always end cleanly)',
      'ALWAYS end by saying a short, warm goodbye OUT LOUD and THEN calling end_call to hang up — never go silent or leave the line open.',
      'End the call when ANY of these happens: the objective is met; the customer says goodbye ("thanks, bye", "that\'s all", "nothing else"); the customer clearly has nothing more to ask; or the conversation has naturally finished.',
      'To end: (1) briefly confirm the outcome, (2) call report_outcome with the result, (3) say a cordial one-line goodbye ("Perfect, thank you so much, have a great day!"), (4) call end_call. Do this promptly — do not linger or repeat yourself.',
      '## Voicemail / answering machine',
      'You spoke the greeting first. If what answers is NOT a real person talking WITH you but a recording — a voicemail/answering-machine greeting ("you\'ve reached…", "leave a message after the tone", "I\'m not available"), an automated menu/IVR, a beep, or a long one-way message that ignores you — then call detected_answering_machine IMMEDIATELY and hang up. Do NOT leave a message and do NOT keep talking.',
      'If the customer asks not to be called again, call customer_requests_no_more_calls, apologize briefly, say goodbye and hang up.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '## Estás en una llamada telefónica',
    'Estás hablando EN VOZ ALTA en una llamada en vivo — no estás escribiendo. Todo lo que digas se convierte en audio.',
    'Reglas para sonar humano y natural:',
    '- Habla con frases cortas y simples. Una idea a la vez.',
    '- Di los números, precios y fechas con palabras (ej. "veintitrés mil pesos", "cinco de marzo"), nunca con dígitos ni símbolos.',
    '- Sin markdown, emojis, links, viñetas ni asteriscos — no se pueden pronunciar.',
    '- Haz UNA sola pregunta a la vez y espera la respuesta.',
    '- Usa muletillas y confirmaciones naturales ("claro", "perfecto", "un momento") para que fluya.',
    '- Si tienes que repetir una dirección o un pedido, hazlo despacio y confirma.',
    '- Nunca digas que eres una IA a menos que te lo pregunten directamente; actúa como alguien del equipo de la tienda.',
    `Objetivo de ESTA llamada: ${objective}`,
    contextLines ? `Contexto de la llamada:\n${contextLines}` : '',
    extra ? `Instrucciones adicionales: ${extra}` : '',
    '## Cómo terminar la llamada (importante — siempre cierra bien)',
    'SIEMPRE termina diciendo una despedida corta y cordial EN VOZ ALTA y LUEGO llama a end_call para colgar — nunca te quedes en silencio ni dejes la línea abierta.',
    'Termina la llamada cuando pase CUALQUIERA de estas: cumpliste el objetivo; el cliente se despide ("listo, gracias", "eso es todo", "nada más"); el cliente claramente no tiene más que preguntar; o la conversación terminó de forma natural.',
    'Para terminar: (1) confirma brevemente el resultado, (2) llama a report_outcome con el resultado, (3) di una despedida cordial de una línea ("¡Perfecto, muchas gracias, que tengas un lindo día!"), (4) llama a end_call. Hazlo pronto — no te quedes dando vueltas ni repitas lo mismo.',
    '## Buzón de voz / contestador',
    'Vos saludaste primero. Si lo que contesta NO es una persona real hablando CON vos sino una grabación —un saludo de buzón/contestador ("dejá tu mensaje después del tono", "no estoy disponible", "has llamado a…"), un menú automático/IVR, un tono/beep, o un mensaje largo de una sola vía que te ignora— entonces llama a detected_answering_machine DE INMEDIATO y cuelga. NO dejes mensaje y NO sigas hablando.',
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
    transferNumber?: string | null;
    /** ¿El agente habla primero? (resuelto por dirección en el route). */
    agentGreetsFirst?: boolean;
    /** Segundos de espera antes de que el agente hable (sin apuro). */
    greetingDelaySeconds?: number;
  },
): Promise<VoiceContextPayload> {
  const { data: agentRow } = await db
    .from('ai_agents')
    .select('*')
    .eq('id', call.agent_id)
    .maybeSingle();
  if (!agentRow) throw new Error(`voice agent ${call.agent_id} not found`);
  const agent = agentRow as AiAgent;

  const { data: contactRow } = await db
    .from('contacts')
    .select('*')
    .eq('id', call.contact_id)
    .maybeSingle();
  if (!contactRow) throw new Error(`voice contact ${call.contact_id} not found`);
  const contact = contactRow as Contact;
  const primaryContact = await loadPrimaryContact(db, contact);

  const businessCurrency = await resolveWorkspaceCurrency(db, call.workspace_id);

  // Same Shopify context the chat agent uses (order policy + tools). No
  // pinned product for a call (there's no message to detect from).
  const shopify = await resolveShopifyContext(db, call.workspace_id, contact, null);
  if (shopify) {
    shopify.canCreateOrders = agent.puede_crear_pedidos === true;
    shopify.workspaceId = call.workspace_id;
    shopify.agentId = agent.id;
    shopify.contactId = primaryContact.id;
    shopify.conversationId = call.conversation_id;
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
  const shopifySnapshot =
    (primaryContact.shopify_customer_data as ShopifyCustomerSnapshot | null) ?? null;

  const base = buildSystemPrompt(
    agent,
    contact,
    primaryContact,
    shopifySnapshot,
    [],
    emptyContext,
    products,
    null,
    shopify,
    null,
    businessCurrency,
  );

  const objective = resolveObjective(agent, call);

  // In-call upsell: only on order confirmation, when enabled, and when we have
  // an order to edit (order_id in context) and a Shopify connection.
  const upsell = agent.voice_objectives?.order_confirmation?.upsell;
  const upsellOn =
    call.call_type === 'order_confirmation' &&
    !!upsell?.enabled &&
    !!shopify &&
    !!call.context?.order_id;

  const lang0 = langOf(agent, call);
  const upsellBlock = upsellOn
    ? '\n' +
      (lang0 === 'en'
        ? `## Upsell\nAfter confirming the order, naturally offer more units${upsell?.discount ? ` (${upsell.discount})` : ''}. ${upsell?.offer_text ?? ''} If they accept, call update_order with the extra units — it updates the real order. Only once, only after they clearly say yes.`
        : `## Upsell\nDespués de confirmar el pedido, ofrecé con naturalidad llevar más unidades${upsell?.discount ? ` (${upsell.discount})` : ''}. ${upsell?.offer_text ?? ''} Si acepta, llamá update_order con las unidades extra — actualiza el pedido real. Una sola vez, sólo cuando diga que sí claramente.`)
    : '';

  const voiceBlock = buildVoiceInstructions(agent, call, objective) + upsellBlock;

  // El system prompt se re-envía en CADA turno, así que su tamaño multiplica el
  // costo y los tokens-por-minuto (los tiers gratis, ej. Groq, cortan en ~12k
  // TPM). El grueso vive en `base` (catálogo/ficha de producto); lo acotamos a
  // un presupuesto de caracteres y NUNCA tocamos el bloque de comportamiento de
  // voz. Configurable con VOICE_SYSTEM_PROMPT_MAX_CHARS.
  const PROMPT_CHAR_BUDGET = Number(process.env.VOICE_SYSTEM_PROMPT_MAX_CHARS || 14000);
  const baseTrimmed =
    base.length > PROMPT_CHAR_BUDGET
      ? base.slice(0, PROMPT_CHAR_BUDGET) +
        (langOf(agent, call) === 'en'
          ? '\n\n[Product details truncated — ask the customer for specifics if needed.]'
          : '\n\n[Ficha de producto recortada — si hace falta un detalle puntual, pregúntalo al cliente.]')
      : base;

  const toolsEnabled = shopify
    ? [
        'lookup_order',
        'create_checkout',
        ...(shopify.canCreateOrders ? ['create_order'] : []),
        ...(upsellOn ? ['update_order'] : []),
      ]
    : [];

  // El sistema decide el formato marcable ANTES de llamar: normaliza el teléfono
  // a E.164 por país (incl. el 9 de móvil AR) en vez de marcar lo que venga
  // guardado. El país sólo hace falta cuando el número está en formato local:
  // primero la dirección de Shopify, y si no hay, el país del propio número de
  // WhatsApp del comercio (sus clientes suelen ser del mismo país). Fail-soft:
  // si no se puede resolver, marca lo guardado.
  const dialCountry =
    (shopifySnapshot as { default_address?: { country_code?: string | null } } | null)
      ?.default_address?.country_code ??
    (await workspaceDialCountry(db, call.workspace_id));
  const dialPhone = normalizeForDialing(call.phone, dialCountry) || call.phone;

  // Global model stack (platform-admin setting). STT/TTS/mode + endpoints are
  // platform-wide; the LLM model still honors a per-agent override when set.
  const model = await getVoiceModelResolved(db);

  // Recording disclosure is prepended to the greeting when recording is on, so
  // the customer is informed the moment the call connects (compliance).
  const lang = langOf(agent, call);
  let greeting = resolveGreeting(agent, contact, call);
  if (opts.recordingEnabled) {
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
    greeting_delay_seconds: Math.max(0, Math.min(Number(opts.greetingDelaySeconds) || 0, 10)),
    system_prompt: `${baseTrimmed}\n\n${voiceBlock}`,
    mode: model.mode,
    voice: {
      provider: model.tts_provider,
      voice_id: agent.voice_id || model.tts_default_voice_id,
      model: model.tts_model,
      // OpenAI/VoxCPM enrutan por base_url; deepgram/cartesia/elevenlabs/gemini
      // no tienen baseUrl en el catálogo → null → plugin nativo del worker.
      base_url: effectiveBaseUrl('tts', model.tts_provider, model.tts_base_url),
      api_key: model.tts_api_key,
    },
    llm: (() => {
      // base_url efectivo: el de la config o el del catálogo del proveedor (Groq,
      // Gemini, Cerebras, OpenAI… enrutan por OpenAI-compat). Anthropic = null → nativo.
      const llmBase = effectiveBaseUrl('llm', model.llm_provider, model.llm_base_url);
      return {
        provider: model.llm_provider,
        // Con endpoint OpenAI-compat el NOMBRE de modelo lo dicta ese endpoint →
        // usamos el de la config, NO el agent.model (que puede ser de otro
        // proveedor, ej. claude-*, y rompería el endpoint). Sin base_url (Anthropic)
        // respetamos el override por-agente.
        model: llmBase ? (model.llm_model || agent.model) : (agent.model || model.llm_model),
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
      model.mode === 'realtime' && model.realtime_provider && model.realtime_model
        ? {
            provider: model.realtime_provider,
            model: model.realtime_model,
            base_url: model.realtime_base_url,
            api_key: model.realtime_api_key,
          }
        : null,
    recording: { enabled: Boolean(opts.recordingEnabled) },
    transfer: { number: opts.transferNumber ?? null },
    max_call_seconds: agent.voice_max_call_seconds || 300,
    sip: { trunk_id: opts.trunkId, caller_number: opts.callerNumber },
    contact: { id: contact.id, name: contact.name ?? null },
    tools_enabled: toolsEnabled,
  };
}

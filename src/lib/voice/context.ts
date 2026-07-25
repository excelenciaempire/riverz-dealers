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
      'How to end: once the objective is met (or the customer wants to stop), briefly confirm the outcome, call the report_outcome tool with the result, thank them, and use end_call to hang up.',
      'If you reach a voicemail or an automated system, call detected_answering_machine and hang up without leaving a message.',
      'If the customer asks not to be called again, call customer_requests_no_more_calls, apologize briefly and hang up.',
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
    'Cómo terminar: cuando cumplas el objetivo (o el cliente quiera cortar), confirma brevemente el resultado, llama a la herramienta report_outcome con el resultado, agradece y usa end_call para colgar.',
    'Si cae un buzón de voz o un sistema automático, llama a detected_answering_machine y cuelga sin dejar mensaje.',
    'Si el cliente pide que no lo llamen más, llama a customer_requests_no_more_calls, discúlpate brevemente y cuelga.',
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

  const toolsEnabled = shopify
    ? [
        'lookup_order',
        'create_checkout',
        ...(shopify.canCreateOrders ? ['create_order'] : []),
        ...(upsellOn ? ['update_order'] : []),
      ]
    : [];

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
    phone: call.phone,
    language: lang,
    greeting,
    system_prompt: `${base}\n\n${voiceBlock}`,
    mode: model.mode,
    voice: {
      provider: model.tts_provider,
      voice_id: agent.voice_id || model.tts_default_voice_id,
      model: model.tts_model,
      base_url: model.tts_base_url,
      api_key: model.tts_api_key,
    },
    llm: {
      provider: model.llm_provider,
      model: agent.model || model.llm_model,
      base_url: model.llm_base_url,
      api_key: model.llm_api_key,
    },
    stt: {
      provider: model.stt_provider,
      model: model.stt_model,
      language: model.stt_language,
      base_url: model.stt_base_url,
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

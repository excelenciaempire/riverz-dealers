import type {
  Channel,
  VoiceCallingHours,
  VoiceObjectives,
} from '@/types';

export type AiProvider = 'anthropic' | 'openai';
export type AiTone = 'friendly' | 'formal' | 'casual' | 'concise';
export type AiScope = 'workspace' | 'channels';
export type AiProductScope = 'all' | 'specific';
/**
 * Modo de respuesta del asistente IA. Migration 034.
 *   - single  : una sola burbuja (default histórico).
 *   - multi   : el modelo arma su respuesta con \n\n como separador
 *               de ideas; el runner manda cada chunk como un mensaje
 *               separado para que sienta conversacional.
 *   - dynamic : el modelo decide según el largo. Respuesta corta
 *               (<280 chars) va en una burbuja; respuesta larga se
 *               parte en varios chunks naturales.
 */
export type AiResponseMode = 'single' | 'multi' | 'dynamic';

export interface BusinessHours {
  /** IANA timezone, e.g. "America/Bogota". */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday → list of HH:mm-HH:mm windows. */
  windows: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string[]>>;
}

export interface AiAgent {
  id: string;
  workspace_id: string;
  name: string;
  is_active: boolean;

  persona: string;
  knowledge: string | null;
  /** URL del sitio web fuente del conocimiento (Firecrawl). Migration 046. */
  knowledge_url: string | null;
  /** Fecha del último scrape exitoso. Migration 046. */
  knowledge_synced_at: string | null;
  language: string;
  tone: AiTone;

  max_response_chars: number;
  reply_delay_seconds: number;
  context_messages: number;
  /** Cómo el asistente entrega su respuesta. Migration 034. */
  response_mode: AiResponseMode;
  /** Segundos que el runner espera tras un inbound antes de generar
   *  la réplica. Si llega otro inbound durante la espera, este runner
   *  se cancela. 0 = desactivado. Migration 034. */
  inbound_debounce_seconds: number;

  reply_when_assigned: boolean;
  reply_outside_hours: boolean;
  business_hours: BusinessHours | null;
  escalate_keywords: string[];
  escalate_after_messages: number | null;

  /** Follow-up inteligente: si el cliente deja de responder tras nuestro
   *  último mensaje, el asistente envía un seguimiento contextual.
   *  Migration 079. */
  followup_enabled: boolean;
  /** Horas de silencio del cliente antes de enviar un follow-up. */
  followup_delay_hours: number;
  /** Máximo de follow-ups por racha de silencio (anti-spam). */
  followup_max_count: number;

  /** Nivel de automatización de los DMs proactivos de Instagram (Instagram
   *  1:1): auto (envía solo), hybrid_intent (auto para alta intención, el
   *  resto a revisión) o approval (todo espera aprobación humana). Siempre
   *  dentro de políticas de Meta. Migration 089. */
  proactive_send_mode?: 'auto' | 'hybrid_intent' | 'approval';

  /** Si está ON, el asistente puede armar y CREAR el pedido real en
   *  Shopify (tool create_order). OFF (default): no cierra pedidos por su
   *  cuenta; deja el cierre a una persona del equipo. Migration 080.
   *  Requiere el scope write_orders (reconectar Shopify). */
  puede_crear_pedidos: boolean;

  provider: AiProvider;
  model: string;
  /** Encrypted; never returned to the client. */
  api_key_encrypted?: string | null;

  scope: AiScope;
  product_scope: AiProductScope;
  priority: number;

  // ── Voice AI (migration 113) ──
  /** Master switch: this agent can place/answer phone calls. */
  voice_enabled: boolean;
  /** TTS provider for the call voice. MVP: 'elevenlabs'. */
  voice_provider: 'elevenlabs';
  /** Provider voice id (e.g. ElevenLabs voice_id). */
  voice_id: string | null;
  /** First line the agent speaks; supports {{contact_name}}. */
  voice_greeting: string | null;
  /** Per-call-type objectives/scripts. */
  voice_objectives: VoiceObjectives;
  /** Hard cap on call length (seconds). */
  voice_max_call_seconds: number;
  /** Allowed outbound calling window (workspace timezone). */
  voice_calling_hours: VoiceCallingHours | null;
  /** Retries when a call is not answered. */
  voice_max_retries: number;
  /** Minutes to wait before retrying an unanswered call. */
  voice_retry_delay_minutes: number;

  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface AiAgentChannel {
  agent_id: string;
  channel: Channel;
}

export interface ShopifyProductSummary {
  id: string;
  title: string;
  handle: string;
  product_type: string | null;
  vendor: string | null;
  price_min: number | null;
  price_max: number | null;
  image_url: string | null;
}

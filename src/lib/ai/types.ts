import type { Channel, VoiceCallingHours, VoiceObjectives } from '@/types';
import type { AgentPermissions, AgentRole } from './roles';
import type { AgentTools } from './toolbox';

/**
 * Piso real de la espera antes de responder (`inbound_debounce_seconds`).
 *
 * El runner SIEMPRE espera al menos esto para agrupar ráfagas del cliente
 * (tres mensajes seguidos = una sola respuesta), así que valores menores
 * no hacen nada. La UI usa la misma constante para no ofrecer un "0" que
 * en realidad espera 8 segundos.
 */
export const MIN_DEBOUNCE_SECONDS = 8;

/**
 * Lo mismo, para el chat web.
 *
 * Los 8 segundos están calibrados para WhatsApp, donde nadie mira la pantalla
 * esperando: la persona escribe, bloquea el teléfono y vuelve. En un chat
 * abierto en la web es al revés — se queda mirando el cursor, y ocho segundos
 * de nada parecen un widget roto. Dos alcanzan para agrupar la ráfaga de quien
 * manda tres frases seguidas, que es lo único que el debounce está evitando.
 *
 * Es un valor fijo del canal, no un piso: el `inbound_debounce_seconds` que el
 * comercio eligió lo eligió pensando en WhatsApp.
 */
export const WEBCHAT_DEBOUNCE_SECONDS = 2;

/**
 * Cortacircuitos: cuántos mensajes puede mandarle el sistema a UN contacto en
 * `BURST_WINDOW_MS` antes de darse por roto y apagarse.
 *
 * El 20 de agosto de 2026 el agente se trabó con el robot de Outlook y mandó
 * 549 correos en cuatro horas, hasta que Microsoft bloqueó la casilla del
 * comercio. Con este fusible se habría cortado en el número 20.
 *
 * Veinte por hora está bien arriba de cualquier conversación real: el debounce
 * ya agrupa las ráfagas del cliente, así que veinte respuestas en una hora al
 * mismo contacto no es una charla, es un lazo.
 */
export const BURST_MAX_REPLIES = 20;
export const BURST_WINDOW_MS = 60 * 60 * 1000;

/**
 * Cuánto hacia atrás se mira para decidir que un mensaje que no nos llegó ya
 * fue avisado. Media jornada: quien insiste con lo mismo lo hace en el rato, y
 * quien vuelve al día siguiente merece que se lo digan de nuevo antes de
 * mandarlo a la cola de una persona.
 */
export const NO_RECIBIDO_VENTANA_MS = 12 * 60 * 60 * 1000;

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
  /** Only receives conversations explicitly handed off by an automation. */
  assigned_only?: boolean;

  /**
   * Qué trabajo hace este agente. Migración 164.
   *
   * Sólo decide a quién le toca un mensaje cuando hay más de un agente en el
   * mismo canal; no habilita ni deshabilita nada (para eso está `permissions`).
   */
  role: AgentRole;
  /**
   * Permisos por acción. Migración 164. `null` = usar las columnas viejas,
   * que es como se comportan los agentes anteriores a la migración.
   */
  permissions: AgentPermissions | null;
  /**
   * La correa de cada herramienta. Migración 180.
   *
   * `{ "<herramienta>": "off" | "aprobacion" | "auto" }`. El modo del medio es
   * el punto: deja la propuesta armada y una persona confirma. `null` —o una
   * herramienta sin entrada— hereda de `permissions`, así que aplicar esto no
   * le cambió el agente a nadie. Ver `src/lib/ai/toolbox.ts`.
   */
  tools: AgentTools | null;

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

  /** Cuántas respuestas seguidas puede mandarle a un mismo contacto en una hora
   *  antes de apagarse en ese hilo. Es el fusible contra un bucle, no una
   *  política de atención. 0 = sin tope. Migración 192. */
  reply_burst_max: number;

  /** TRUE = el asistente escribe la respuesta pero no la manda: queda como
   *  propuesta en la bandeja y una persona la envía con un clic.
   *  FALSE (default) = responde solo. Migración 170. */
  requires_approval: boolean;

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
  /**
   * Cómo cierra la venta (migración 219).
   *
   *   checkout    — siempre a la caja de la tienda.
   *   chat        — siempre toma el pedido en la conversación.
   *   segun_pago  — contra-entrega en el chat, tarjeta a la caja.
   *
   * Elige entre lo que la pizarra de herramientas ya permite; nunca amplía
   * permisos. Con `crear_pedido` apagado manda a la caja diga lo que diga.
   */
  cobro_modo?: 'checkout' | 'chat' | 'segun_pago' | null;
  /**
   * Con qué se puede pagar (migración 228). Claves de `MEDIOS_PAGO`.
   *
   * `null` NO es la lista vacía: significa que el comercio todavía no lo
   * declaró, y con eso el agente no nombra ningún medio y no confirma contra
   * entrega — pasa a una persona. Es donde arranca todo asistente nuevo, y es
   * el lado seguro: suponerlo fue el error del 2026-08-29, cuando la IA le
   * prometió contra entrega a la clienta de un comercio que no lo acepta.
   *
   * El contra entrega es UNO de la lista y no un campo aparte: son la misma
   * pregunta, y separarlos daba dos lugares donde decir lo mismo.
   */
  medios_pago?: string[] | null;

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
  /** Voice profile used when this chat agent escalates a conversation by phone. */
  voice_agent_id?: string | null;
  /** TTS provider for the call voice. MVP: 'elevenlabs'. */
  voice_provider: 'elevenlabs';
  /** Provider voice id (e.g. ElevenLabs voice_id). */
  voice_id: string | null;
  /** First line the agent speaks; supports {{contact_name}}. */
  voice_greeting: string | null;
  /** Instrucciones de sistema propias de las llamadas (se suman al persona base;
   *  vacío = solo persona + objetivos). */
  voice_system_prompt: string | null;
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
  /** Whether this voice profile may answer calls to the workspace number. */
  voice_accepts_inbound?: boolean;
  /** E.164 destination used when this voice profile transfers to a person. */
  voice_transfer_number?: string | null;
  /** Maximum simultaneous calls handled by this voice profile. */
  voice_max_concurrent_calls?: number;
  /** Slots kept free for incoming calls to this profile. */
  voice_reserved_inbound_slots?: number;
  /** Campaign calls from this profile allowed at once. */
  voice_max_campaign_concurrent?: number;
  /** Automatic-call duplicate window in minutes; 0 disables it. */
  voice_dedupe_minutes?: number;
  /** Monthly talk-minute cap for this profile; null/0 = unlimited. */
  voice_monthly_minutes_limit?: number | null;
  /** Record calls handled by this profile. */
  voice_recording_enabled?: boolean;
  /** Announce recording before the greeting. */
  voice_recording_disclosure?: boolean;
  /** Let the chat agent decide, mid-conversation, to escalate to a phone
   *  call (via the escalate_to_call tool), within guardrails. Migration 115. */
  voice_ai_decides: boolean;

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
  currency?: string | null;
  image_url: string | null;
  /**
   * Dónde más se vende lo mismo. Presente sólo cuando el producto está
   * unificado (migración 183): el selector muestra UNA fila con sus canales,
   * igual que la pantalla de Productos, y asignar mueve el grupo entero.
   */
  listings?: Array<{
    id: string;
    platform: string;
    title: string | null;
    price_min: number | string | null;
    currency: string | null;
    url: string | null;
    is_master: boolean;
  }>;
}

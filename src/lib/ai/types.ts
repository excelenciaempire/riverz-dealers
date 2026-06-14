import type { Channel } from '@/types';

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

  provider: AiProvider;
  model: string;
  /** Encrypted; never returned to the client. */
  api_key_encrypted?: string | null;

  scope: AiScope;
  product_scope: AiProductScope;
  priority: number;

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

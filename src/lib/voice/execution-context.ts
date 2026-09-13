/**
 * Metadata that ties a phone call back to the Riverz flow that created it.
 *
 * It lives inside `voice_calls.context` so old databases and workers remain
 * compatible. The key is private: it is never shown to the model as customer
 * data. Retries copy `context`, so the link survives the whole attempt chain.
 */
export const VOICE_EXECUTION_META_KEY = '__riverz' as const;

export type VoiceCallOrigin =
  | 'assistant'
  | 'automation'
  | 'manual'
  | 'campaign'
  | 'inbound'
  | 'operator'
  | 'test';

export interface VoiceExecutionMeta {
  origin: VoiceCallOrigin;
  /** Chat assistant whose knowledge/persona should continue on the phone. */
  assistantId?: string | null;
  /** Conversation that caused the call. Used to load the person's live context. */
  conversationId?: string | null;
}

export function withVoiceExecutionMeta(
  context: Record<string, unknown> | undefined,
  meta: VoiceExecutionMeta
): Record<string, unknown> {
  return {
    ...(context ?? {}),
    [VOICE_EXECUTION_META_KEY]: {
      origin: meta.origin,
      ...(meta.assistantId ? { assistant_id: meta.assistantId } : {}),
      ...(meta.conversationId ? { conversation_id: meta.conversationId } : {}),
    },
  };
}

export function voiceExecutionMeta(
  context: Record<string, unknown> | null | undefined
): VoiceExecutionMeta | null {
  const raw = context?.[VOICE_EXECUTION_META_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const origin = row.origin;
  if (
    origin !== 'assistant' &&
    origin !== 'automation' &&
    origin !== 'manual' &&
    origin !== 'campaign' &&
    origin !== 'inbound' &&
    origin !== 'operator' &&
    origin !== 'test'
  ) {
    return null;
  }
  return {
    origin,
    assistantId: typeof row.assistant_id === 'string' ? row.assistant_id : null,
    conversationId:
      typeof row.conversation_id === 'string' ? row.conversation_id : null,
  };
}

/** Only business/customer values may be narrated to the call model. */
export function publicVoiceContext(
  context: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const operational = new Set([
    'campaign_id',
    'test_call',
    'escalated_by_ai',
    'capacity_requeues',
    'skip_if_replied',
    'cod_writeback',
  ]);
  return Object.fromEntries(
    Object.entries(context ?? {}).filter(
      ([key]) =>
        key !== VOICE_EXECUTION_META_KEY &&
        !key.startsWith('__') &&
        !operational.has(key)
    )
  );
}

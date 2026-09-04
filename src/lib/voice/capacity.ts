import type { VoiceCall, VoiceCallType, VoiceConnectionConfig } from '@/types';
import type { AiAgent } from '@/lib/ai/types';

export const DEFAULT_VOICE_CAPACITY = {
  maxConcurrentCalls: 3,
  reservedInboundSlots: 0,
  maxCampaignConcurrent: 1,
  dedupeMinutes: 15,
} as const;

export type VoiceCapacityConfig = {
  maxConcurrentCalls: number;
  reservedInboundSlots: number;
  maxCampaignConcurrent: number;
  dedupeMinutes: number;
};

export function normalizeVoiceAgentCapacity(
  agent: Pick<
    AiAgent,
    | 'voice_max_concurrent_calls'
    | 'voice_reserved_inbound_slots'
    | 'voice_max_campaign_concurrent'
    | 'voice_dedupe_minutes'
  >,
  fallback?: VoiceConnectionConfig
): VoiceCapacityConfig {
  const shared = normalizeVoiceCapacity(fallback);
  const maxConcurrentCalls = integerInRange(
    agent.voice_max_concurrent_calls,
    shared.maxConcurrentCalls,
    1,
    20
  );
  return {
    maxConcurrentCalls,
    reservedInboundSlots: integerInRange(
      agent.voice_reserved_inbound_slots,
      shared.reservedInboundSlots,
      0,
      Math.max(0, maxConcurrentCalls - 1)
    ),
    maxCampaignConcurrent: integerInRange(
      agent.voice_max_campaign_concurrent,
      shared.maxCampaignConcurrent,
      1,
      maxConcurrentCalls
    ),
    dedupeMinutes: integerInRange(
      agent.voice_dedupe_minutes,
      shared.dedupeMinutes,
      0,
      1440
    ),
  };
}

function integerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function normalizeVoiceCapacity(
  config: Pick<
    VoiceConnectionConfig,
    | 'max_concurrent_calls'
    | 'reserved_inbound_slots'
    | 'max_campaign_concurrent'
    | 'dedupe_minutes'
    | 'dedupe_hours'
  > = {}
): VoiceCapacityConfig {
  const maxConcurrentCalls = integerInRange(
    config.max_concurrent_calls,
    DEFAULT_VOICE_CAPACITY.maxConcurrentCalls,
    1,
    50
  );
  const legacyDedupe =
    config.dedupe_hours == null ? undefined : Number(config.dedupe_hours) * 60;
  return {
    maxConcurrentCalls,
    reservedInboundSlots: integerInRange(
      config.reserved_inbound_slots,
      DEFAULT_VOICE_CAPACITY.reservedInboundSlots,
      0,
      Math.max(0, maxConcurrentCalls - 1)
    ),
    maxCampaignConcurrent: integerInRange(
      config.max_campaign_concurrent,
      DEFAULT_VOICE_CAPACITY.maxCampaignConcurrent,
      1,
      maxConcurrentCalls
    ),
    dedupeMinutes: integerInRange(
      config.dedupe_minutes ?? legacyDedupe,
      DEFAULT_VOICE_CAPACITY.dedupeMinutes,
      0,
      24 * 60
    ),
  };
}

export function voiceCallPriority(input: {
  callType: VoiceCallType;
  automationId?: string | null;
  context?: Record<string, unknown>;
}): number {
  if (input.callType === 'inbound') return 500;
  if (input.context?.test_call === true) return 450;
  if (input.callType === 'manual' && !input.automationId) return 400;
  if (input.context?.campaign_id) return 100;
  if (input.automationId || input.callType === 'order_confirmation') return 300;
  return 250;
}

export function voiceCallDedupeKey(input: {
  contactId: string;
  callType: VoiceCallType;
  automationId?: string | null;
  context?: Record<string, unknown>;
}): string | null {
  if (input.callType === 'manual' && !input.automationId) return null;
  if (input.context?.test_call === true) return null;
  const campaignId = String(input.context?.campaign_id ?? '').trim();
  if (campaignId) return `campaign:${campaignId}:contact:${input.contactId}`;
  if (input.automationId) {
    return `automation:${input.automationId}:contact:${input.contactId}:type:${input.callType}`;
  }
  return `automatic:${input.callType}:contact:${input.contactId}`;
}

/**
 * Round-robin between workspaces inside each priority band. A large campaign
 * can no longer occupy the entire scan just because its rows are older.
 */
export function fairVoiceQueue<
  T extends Pick<
    VoiceCall,
    'workspace_id' | 'dispatch_priority' | 'scheduled_at'
  >,
>(rows: T[]): T[] {
  const priorities = [
    ...new Set(rows.map((row) => row.dispatch_priority ?? 200)),
  ].sort((a, b) => b - a);
  const ordered: T[] = [];

  for (const priority of priorities) {
    const queues = new Map<string, T[]>();
    rows
      .filter((row) => (row.dispatch_priority ?? 200) === priority)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      .forEach((row) => {
        const queue = queues.get(row.workspace_id) ?? [];
        queue.push(row);
        queues.set(row.workspace_id, queue);
      });
    const workspaces = [...queues.keys()];
    let hasRows = true;
    while (hasRows) {
      hasRows = false;
      for (const workspaceId of workspaces) {
        const row = queues.get(workspaceId)?.shift();
        if (!row) continue;
        ordered.push(row);
        hasRows = true;
      }
    }
  }
  return ordered;
}

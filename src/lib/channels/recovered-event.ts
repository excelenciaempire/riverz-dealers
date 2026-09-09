import type { InboundEvent } from './types';

/** Polling may also be the live transport. Only historical recovery is passive. */
export function recoveredEvent(event: InboundEvent, now = Date.now()): InboundEvent {
  const received = Date.parse(event.receivedAt);
  const requested = Date.parse(String(event.connection.config?.sync_requested_at ?? event.connection.created_at));
  if (!Number.isFinite(received) || received < requested || now - received > 5 * 60_000) {
    return { ...event, historical: true, suppressAutoReply: true };
  }
  return event;
}

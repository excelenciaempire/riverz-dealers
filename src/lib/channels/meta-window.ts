import type { Channel } from '@/types';

export const META_STANDARD_REPLY_HOURS = 24;
export const META_HUMAN_REPLY_HOURS = 7 * 24;

export function replyWindowHours(channel: Channel): number {
  return channel === 'instagram' || channel === 'messenger'
    ? META_HUMAN_REPLY_HOURS
    : META_STANDARD_REPLY_HOURS;
}

export function metaHumanReplyExpired(
  channel: Channel,
  lastCustomerAt: string | null | undefined,
  now = Date.now()
): boolean {
  if (channel !== 'instagram' && channel !== 'messenger') return false;
  const last = lastCustomerAt ? Date.parse(lastCustomerAt) : Number.NaN;
  return (
    !Number.isFinite(last) ||
    now - last >= META_HUMAN_REPLY_HOURS * 60 * 60 * 1000
  );
}

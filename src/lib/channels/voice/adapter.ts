import type { ChannelAdapter } from '../types';

/**
 * Voice channel adapter — intentionally inert.
 *
 * Telephony is handled end-to-end by the LiveKit voice worker + the
 * /api/internal/voice/* endpoints, NOT through the inbox composer or the
 * generic channel webhook route. This adapter exists only to satisfy the
 * channel registry (Record<Channel, ChannelAdapter>) and to let the inbox
 * recognize `voice` as a real channel. It never sends or parses webhooks;
 * the inbox hides the composer for voice conversations (call log view).
 */
export const voiceAdapter: ChannelAdapter = {
  channel: 'voice',
  label: 'Voz',
  isConfigured() {
    return true;
  },
  async sendText() {
    throw new Error('voice channel does not support inbox sends');
  },
  async parseWebhook() {
    return [];
  },
};

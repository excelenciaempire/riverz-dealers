import type { Channel } from '@/types';

/** Every inbox channel has an explicit audio policy; no text/link fallback. */
export const VOICE_CHANNELS: Record<Channel, 'native' | 'audio' | 'attachment' | null> = {
  whatsapp: 'native', instagram: 'audio', messenger: 'audio',
  gmail: 'attachment', outlook: 'attachment', zoho: 'attachment', webchat: 'audio',
  fb_comment: null, ig_comment: null, tiktok_comment: null, mercadolibre: null, voice: null,
};
export function supportsVoiceNotes(channel: Channel) { return Boolean(VOICE_CHANNELS[channel]); }
export function voiceRequiresWindow(channel: Channel) {
  return channel === 'whatsapp' || channel === 'instagram' || channel === 'messenger';
}

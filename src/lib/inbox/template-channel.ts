import type { Channel } from '@/types';

const TEMPLATE_IMAGE_CHANNELS = new Set<Channel>([
  'whatsapp',
  'instagram',
  'messenger',
  'gmail',
  'outlook',
  'zoho',
  'webchat',
  'mercadolibre',
]);

export function canUseTemplateLibrary(channel: Channel): boolean {
  return channel !== 'voice';
}

export function isOfficialTemplateSend(channel: Channel): boolean {
  return channel === 'whatsapp';
}

export function canAttachTemplateImage(channel: Channel): boolean {
  return TEMPLATE_IMAGE_CHANNELS.has(channel);
}

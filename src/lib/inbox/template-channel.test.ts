import { describe, expect, it } from 'vitest';
import { CHANNELS } from '@/types';
import {
  canAttachTemplateImage,
  canUseTemplateLibrary,
  isOfficialTemplateSend,
} from './template-channel';

describe('template library by channel', () => {
  it('is available in every written channel', () => {
    for (const channel of CHANNELS) {
      expect(canUseTemplateLibrary(channel)).toBe(channel !== 'voice');
    }
  });

  it('uses approved template delivery only on WhatsApp', () => {
    for (const channel of CHANNELS) {
      expect(isOfficialTemplateSend(channel)).toBe(channel === 'whatsapp');
    }
  });

  it('offers images only where the adapter supports media', () => {
    expect(canAttachTemplateImage('instagram')).toBe(true);
    expect(canAttachTemplateImage('messenger')).toBe(true);
    expect(canAttachTemplateImage('ig_comment')).toBe(false);
    expect(canAttachTemplateImage('fb_comment')).toBe(false);
    expect(canAttachTemplateImage('tiktok_comment')).toBe(false);
  });
});

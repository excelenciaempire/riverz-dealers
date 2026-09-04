import { describe, expect, it } from 'vitest';
import { isDedicatedVoiceProfile } from './profile';

describe('isDedicatedVoiceProfile', () => {
  it('recognizes profiles created only for calls', () => {
    expect(
      isDedicatedVoiceProfile({
        voice_enabled: true,
        scope: 'channels',
        ai_agent_channels: [{ channel: 'voice' }],
      }),
    ).toBe(true);
  });

  it('does not hide a chat assistant that also has legacy voice enabled', () => {
    expect(
      isDedicatedVoiceProfile({
        voice_enabled: true,
        scope: 'channels',
        ai_agent_channels: [
          { channel: 'whatsapp' },
          { channel: 'voice' },
        ],
      }),
    ).toBe(false);
  });

  it('requires voice to be enabled', () => {
    expect(
      isDedicatedVoiceProfile({
        voice_enabled: false,
        scope: 'channels',
        ai_agent_channels: [{ channel: 'voice' }],
      }),
    ).toBe(false);
  });
});

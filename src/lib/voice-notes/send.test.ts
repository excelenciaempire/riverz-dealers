import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAudioMessage } from '@/lib/whatsapp/meta-api';

afterEach(() => vi.unstubAllGlobals());
describe('native WhatsApp voice notes', () => {
  it('sends voice=true inside audio, preserves the reply target and omits captions', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ messages: [{ id: 'wamid.voice' }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      sendAudioMessage({
        phoneNumberId: 'phone',
        accessToken: 'test',
        to: '123',
        url: 'https://example.com/note.ogg',
        voice: true,
        caption: 'must not send',
        contextMessageId: 'wamid.inbound',
      })
    ).resolves.toEqual({ messageId: 'wamid.voice' });
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.audio).toEqual({
      link: 'https://example.com/note.ogg',
      voice: true,
    });
    expect(payload.context).toEqual({ message_id: 'wamid.inbound' });
  });
  it('keeps ordinary audio attachments unchanged', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ messages: [{ id: 'wamid.audio' }] }));
    vi.stubGlobal('fetch', fetcher);
    await sendAudioMessage({
      phoneNumberId: 'phone',
      accessToken: 'test',
      to: '123',
      url: 'https://example.com/music.mp3',
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).audio).toEqual({
      link: 'https://example.com/music.mp3',
    });
  });
});

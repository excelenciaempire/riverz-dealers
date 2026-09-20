import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadPublicMedia } from '@/lib/security/download-public-media';
import { inlineCountableMedia } from './countable-media';
vi.mock('@/lib/security/download-public-media', () => ({ downloadPublicMedia: vi.fn() }));
const download = vi.mocked(downloadPublicMedia);
const image = () => ({ type: 'image', source: { type: 'url', url: 'https://cdn.example/photo' } });
beforeEach(() => download.mockReset());
describe('countable media', () => {
  it('inlines nested media once and preserves surrounding content', async () => {
    download.mockResolvedValue({ buffer: Buffer.from('photo'), mime: 'image/jpeg; charset=binary' });
    const messages = [{ role: 'user', content: [image(), { type: 'tool_result', tool_use_id: 'id', content: [image()] }] }];
    expect(await inlineCountableMedia(messages)).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'cGhvdG8=' } });
    expect(messages[0].content[1]).toMatchObject({ tool_use_id: 'id' });
  });
  it('leaves text and existing base64 sources untouched', async () => {
    expect(await inlineCountableMedia([{ content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }, { type: 'text', text: 'hello' }] }])).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });
  it('refuses unavailable media without dropping customer evidence', async () => {
    download.mockResolvedValue(null);
    await expect(inlineCountableMedia([image()])).rejects.toThrow('wallet_media_download_failed');
  });
  it('rejects HTML masquerading as an image', async () => {
    download.mockResolvedValue({ buffer: Buffer.from('html'), mime: 'text/html' });
    await expect(inlineCountableMedia([image()])).rejects.toThrow('wallet_unsupported_media_type');
  });
  it('supports PDFs and caps the expanded request including repeated references', async () => {
    download.mockResolvedValue({ buffer: Buffer.from('pdf'), mime: 'application/pdf' });
    const doc = { type: 'document', source: { type: 'url', url: 'https://cdn.example/doc' } };
    await inlineCountableMedia([doc]);
    expect(doc.source).toMatchObject({ type: 'base64', media_type: 'application/pdf' });
    download.mockResolvedValue({ buffer: Buffer.alloc(5 * 1024 * 1024), mime: 'image/jpeg' });
    await expect(inlineCountableMedia(Array.from({ length: 5 }, image))).rejects.toThrow('wallet_media_payload_too_large');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { uploadTemplateHeaderMedia } from './template-media';

describe('uploadTemplateHeaderMedia', () => {
  it('preserves Meta upload-session query signatures when posting the file', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'upload:session?sig=example-signature' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ h: 'header-handle' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['image'], 'header.png', { type: 'image/png' });

    await expect(uploadTemplateHeaderMedia({ appId: 'app-id', accessToken: 'token', file })).resolves.toBe('header-handle');

    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.facebook.com/v21.0/upload:session?sig=example-signature');
    expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('image/png');
  });
});

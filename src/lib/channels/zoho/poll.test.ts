import { afterEach, describe, expect, it, vi } from 'vitest';

const { ingestRawMedia } = vi.hoisted(() => ({ ingestRawMedia: vi.fn() }));

vi.mock('../media-ingest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media-ingest')>()),
  ingestRawMedia,
}));

vi.mock('./auth', () => ({
  getFreshZohoAccessToken: vi.fn(),
  mailApiUrl: () => 'https://mail.zoho.test',
}));

import { fetchZohoAttachments } from './poll';

describe('fetchZohoAttachments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    ingestRawMedia.mockReset();
  });

  it('persists each downloadable Zoho attachment and keeps its metadata', async () => {
    ingestRawMedia.mockResolvedValue({
      url: '/api/media/shop/customer/mail-1-a1.mp3',
      mediaMime: 'audio/mpeg',
      mediaSize: 3,
      fileName: 'nota.mp3',
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                attachmentId: 'a1',
                attachmentName: 'nota.mp3',
                contentType: 'audio/mpeg',
                attachmentSize: 3,
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg', 'content-length': '3' },
        })
      );

    const attachments = await fetchZohoAttachments({
      connection: {
        id: 'connection',
        workspace_id: 'shop',
        config: {},
      } as never,
      accessToken: 'token',
      accountId: 'account',
      folderId: 'folder',
      messageId: 'mail-1',
      workspaceId: 'shop',
      conversationId: 'customer@example.com',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ingestRawMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'nota.mp3',
        mime: 'audio/mpeg',
        workspaceId: 'shop',
      })
    );
    expect(attachments).toEqual([
      {
        url: '/api/media/shop/customer/mail-1-a1.mp3',
        mime_type: 'audio/mpeg',
        name: 'nota.mp3',
        size: 3,
      },
    ]);
  });

  it('skips inline and oversized files before downloading them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { attachmentId: 'inline', isInline: true },
            { attachmentId: 'large', attachmentSize: 30 * 1024 * 1024 },
          ],
        })
      )
    );

    const attachments = await fetchZohoAttachments({
      connection: {
        id: 'connection',
        workspace_id: 'shop',
        config: {},
      } as never,
      accessToken: 'token',
      accountId: 'account',
      folderId: 'folder',
      messageId: 'mail-1',
      workspaceId: 'shop',
      conversationId: 'customer@example.com',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ingestRawMedia).not.toHaveBeenCalled();
    expect(attachments).toEqual([]);
  });
});

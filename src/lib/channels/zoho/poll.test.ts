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

import { fetchZohoAttachments, recorridoZohoTerminado } from './poll';
import { FallaTransitoria } from '../email/falla-transitoria';

describe('recorridoZohoTerminado', () => {
  const borde = 1_000;

  it('una página llena y toda posterior al borde deja el recorrido abierto', () => {
    expect(recorridoZohoTerminado([3_000, 2_000], 2, borde)).toBe(false);
  });

  it('una página corta es la última', () => {
    expect(recorridoZohoTerminado([3_000], 2, borde)).toBe(true);
  });

  it('una página que ya toca el borde es la última', () => {
    expect(recorridoZohoTerminado([3_000, 900], 2, borde)).toBe(true);
  });

  it('un mensaje sin fecha no cierra el recorrido', () => {
    expect(recorridoZohoTerminado([3_000, 0], 2, borde)).toBe(false);
  });
});

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

  it('un límite de tasa corta la corrida en vez de guardar el correo sin su archivo', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ attachmentId: 'a1', attachmentSize: 3 }] }))
      )
      .mockResolvedValueOnce(new Response('', { status: 429 }));

    await expect(
      fetchZohoAttachments({
        connection: { id: 'connection', workspace_id: 'shop', config: {} } as never,
        accessToken: 'token',
        accountId: 'account',
        folderId: 'folder',
        messageId: 'mail-1',
        workspaceId: 'shop',
        conversationId: 'customer@example.com',
      })
    ).rejects.toBeInstanceOf(FallaTransitoria);
    expect(ingestRawMedia).not.toHaveBeenCalled();
  });
});

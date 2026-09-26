import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelConnection } from '@/types';

vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }));

const ingested: Array<Record<string, unknown>> = [];
vi.mock('./inbox-writer', () => ({
  ingestInboundEvent: vi.fn(async (_db: unknown, event: Record<string, unknown>) => {
    ingested.push(event);
    return { message: { id: 'm' } };
  }),
}));
vi.mock('./media-ingest', () => ({ ingestMetaAttachment: vi.fn(async () => null) }));

import { emptyGraphMessagePlaceholder, syncThreadMessages } from './meta-dm-history';
import { ingestMetaAttachment } from './media-ingest';
import { MetaRateLimitError } from './meta-rate-limit';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncThreadMessages', () => {
  it('persists the opaque cursor and reports unfinished history at the page cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [], paging: { next: 'https://graph.facebook.com/v22.0/thread/messages?after=next-page&access_token=secret' },
    }))));
    const checkpoint = vi.fn();
    await expect(syncThreadMessages({
      token: 'page-token', selfId: 'page', connection: {} as never,
      threadId: 'thread', externalId: 'customer', createIfMissing: false,
      maxPages: 1, onCheckpoint: checkpoint,
    })).rejects.toThrow('meta_thread_sync_pending');
    expect(checkpoint).toHaveBeenCalledWith('next-page');
    expect(checkpoint).not.toHaveBeenCalledWith(null);
  });
  it('fails loudly when Graph cannot read a thread, so its checkpoint is not advanced', async () => {
    const request = vi
      .fn()
      // Rich fields can be unsupported; the implementation tries the basic
      // field set once before declaring the thread unrecoverable.
      .mockResolvedValueOnce(new Response('bad rich fields', { status: 400 }))
      .mockResolvedValueOnce(
        new Response('thread unavailable', { status: 400 })
      );
    vi.stubGlobal('fetch', request);

    await expect(
      syncThreadMessages({
        token: 'page-token',
        selfId: 'page-id',
        connection: {
          id: 'connection-id',
          workspace_id: 'workspace-id',
          channel: 'instagram',
        } as never,
        threadId: 'thread-id',
        externalId: 'customer-id',
        createIfMissing: false,
      })
    ).rejects.toThrow('thread messages failed (400)');
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('syncThreadMessages con startedBetween', () => {
  const DAY = 86_400_000;
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
  const message = (id: string, daysAgo: number, from = 'cliente') => ({
    id,
    created_time: at(daysAgo),
    from: { id: from },
    message: `texto ${id}`,
  });
  const connection = {
    id: 'conn-ig',
    workspace_id: 'ws-1',
    channel: 'instagram',
    config: {},
  } as unknown as ChannelConnection;

  /** Graph devuelve el hilo del más nuevo al más viejo, en páginas. */
  function graph(pages: Array<Array<ReturnType<typeof message>>>) {
    const request = vi.fn(async (url: string) => {
      const index = Number(new URL(url).searchParams.get('after') ?? 0);
      const next = index + 1 < pages.length ? `https://graph.facebook.com/v22.0/t1/messages?after=${index + 1}` : undefined;
      return new Response(JSON.stringify({ data: pages[index] ?? [], paging: next ? { next } : {} }));
    });
    vi.stubGlobal('fetch', request);
    return request;
  }

  const sync = (sinceDays: number, untilDays: number) =>
    syncThreadMessages({
      token: 'tok',
      selfId: 'pagina',
      connection,
      threadId: 't1',
      externalId: 'cliente',
      createIfMissing: true,
      startedBetween: { sinceIso: at(sinceDays), untilIso: at(untilDays) },
      maxPages: Number.MAX_SAFE_INTEGER,
    });

  beforeEach(() => {
    ingested.length = 0;
  });

  it('un hilo que empezó en el rango entra completo, del primer mensaje al último', async () => {
    graph([
      [message('m5', 0.1), message('m4', 1, 'pagina')],
      [message('m3', 3), message('m2', 4), message('m1', 5)],
    ]);

    // Rango de hace 10 días a hace 2: m4 y m5 quedan después y entran igual.
    expect(await sync(10, 2)).toBe(5);
    expect(ingested.map((e) => e.externalMessageId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(ingested.every((e) => e.historical === true)).toBe(true);
    expect(ingested.find((e) => e.externalMessageId === 'm4')?.outbound).toBe(true);
  });

  it('un hilo que empezó antes del rango no entra, aunque tenga mensajes en él', async () => {
    const request = graph([
      [message('m5', 0.1), message('m4', 1)],
      [message('m3', 3), message('m1', 12)],
      [message('m0', 20)],
    ]);

    expect(await sync(10, 0)).toBe(0);
    expect(ingested).toHaveLength(0);
    // Deja de leer apenas encuentra el mensaje anterior al rango.
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('un hilo que empezó después del rango no entra', async () => {
    graph([[message('m2', 0.5), message('m1', 1)]]);

    expect(await sync(10, 2)).toBe(0);
    expect(ingested).toHaveLength(0);
  });
});

describe('emptyGraphMessagePlaceholder', () => {
  const base = { created_time: '2026-09-20T10:00:00+0000', from: { id: 'cliente' } };

  it('un archivo que ya no se puede bajar queda como no disponible', () => {
    expect(emptyGraphMessagePlaceholder({ ...base, attachments: { data: [{}] } })).toBe(
      '[Archivo no disponible]'
    );
    expect(emptyGraphMessagePlaceholder({ ...base, shares: { data: [{}] } })).toBe(
      '[Archivo no disponible]'
    );
  });

  it('un mensaje que Meta devuelve vacío dice que el contenido está en la app', () => {
    expect(emptyGraphMessagePlaceholder(base)).toBe('[unsupported media]');
  });

  it('sin fecha o sin autor no inventa una burbuja', () => {
    expect(emptyGraphMessagePlaceholder({ from: { id: 'cliente' } })).toBe('');
    expect(emptyGraphMessagePlaceholder({ created_time: base.created_time })).toBe('');
  });
});

describe('syncThreadMessages conserva el hilo completo', () => {
  const connection = {
    id: 'conn-ig',
    workspace_id: 'ws-1',
    channel: 'instagram',
    config: {},
  } as unknown as ChannelConnection;
  const sync = (onCheckpoint?: (after: string | null) => Promise<void>) =>
    syncThreadMessages({
      token: 'tok',
      selfId: 'pagina',
      connection,
      threadId: 't1',
      externalId: 'cliente',
      createIfMissing: true,
      onCheckpoint,
    });

  beforeEach(() => {
    ingested.length = 0;
    vi.mocked(ingestMetaAttachment).mockClear();
  });

  it('un mensaje sin texto ni archivo descargable entra con rótulo, de los dos lados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'm4', created_time: '2026-09-20T10:04:00+0000', from: { id: 'pagina' }, message: 'Te lo mando' },
        {
          id: 'm3',
          created_time: '2026-09-20T10:03:00+0000',
          from: { id: 'cliente' },
          attachments: { data: [{ id: 'a1', image_data: { url: 'https://scontent.xx.fbcdn.net/caducada.jpg' } }] },
        },
        { id: 'm2', created_time: '2026-09-20T10:02:00+0000', from: { id: 'pagina' } },
        { id: 'm1', created_time: '2026-09-20T10:01:00+0000', from: { id: 'cliente' }, message: 'Hola' },
        { id: 'sin-datos' },
      ],
    }))));

    expect(await sync()).toBe(4);
    expect(ingested.map((e) => [e.externalMessageId, e.text, e.outbound])).toEqual([
      ['m4', 'Te lo mando', true],
      ['m3', '[Archivo no disponible]', false],
      ['m2', '[unsupported media]', true],
      ['m1', 'Hola', false],
    ]);
    // La URL caducada se reintenta con el token y el mid del mensaje.
    expect(ingestMetaAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'tok', mid: 'm3', attachmentIndex: 0 })
    );
  });

  it('ante un límite de Graph corta sin degradar campos ni cerrar el hilo', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 4, message: '(#4) Application request limit reached' } }),
        { status: 400 }
      )
    );
    vi.stubGlobal('fetch', request);
    const checkpoint = vi.fn(async () => {});

    await expect(sync(checkpoint)).rejects.toBeInstanceOf(MetaRateLimitError);
    // Sin el reintento con el juego mínimo de campos: sólo alargaría el castigo.
    expect(request).toHaveBeenCalledTimes(1);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(ingested).toHaveLength(0);
  });
});

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

import { syncThreadMessages } from './meta-dm-history';

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

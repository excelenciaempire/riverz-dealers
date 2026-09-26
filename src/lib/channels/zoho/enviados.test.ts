import { afterEach, describe, expect, it, vi } from 'vitest';

const { ingestInboundEvent, findMessageByExternalId, savePollState, listConnections } =
  vi.hoisted(() => ({
    ingestInboundEvent: vi.fn(),
    findMessageByExternalId: vi.fn(),
    savePollState: vi.fn(),
    listConnections: vi.fn(),
  }));

vi.mock('../inbox-writer', () => ({ ingestInboundEvent }));
vi.mock('../message-lookup', () => ({ findMessageByExternalId }));
vi.mock('../poll-state', () => ({ savePollState }));
vi.mock('../connections', () => ({ listConnections }));
vi.mock('../admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}));
vi.mock('./auth', () => ({
  getFreshZohoAccessToken: vi.fn(async () => 'token'),
  mailApiUrl: () => 'https://mail.zoho.test',
}));

import { pollAllZohoConnections } from './poll';

/**
 * Zoho no importaba la carpeta de Enviados: en cada hilo faltaba lo que
 * contestó el comercio, justo lo que el agente necesita para aprender.
 */

const DIA = 86_400_000;
const ahora = Date.now();

const connection = {
  id: 'c',
  workspace_id: 'w',
  channel: 'zoho',
  status: 'connected',
  external_account_id: 'tienda@shop.com',
  config: {
    email: 'tienda@shop.com',
    zoho_account_id: 'acc',
    zoho_inbox_folder_id: 'IN',
    sync_requested_at: new Date(ahora).toISOString(),
  },
  created_at: new Date(ahora).toISOString(),
  updated_at: new Date(ahora).toISOString(),
};

const entrante = {
  messageId: 'in-1',
  threadId: 'th-1',
  folderId: 'IN',
  fromAddress: 'ana@x.com',
  sender: 'Ana',
  subject: 'Pedido',
  receivedTime: String(ahora - 10 * DIA),
  hasAttachment: '0',
};
const enviado = {
  messageId: 'out-1',
  threadId: 'th-1',
  folderId: 'SENT',
  fromAddress: 'tienda@shop.com',
  toAddress: '&quot;Ana&quot;&lt;ana@x.com&gt;',
  subject: 'Re: Pedido',
  receivedTime: String(ahora - 9 * DIA),
  hasAttachment: '0',
};

function zoho(input: string | URL | Request): Response {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/folders')) {
    return Response.json({
      data: [
        { folderId: 'IN', folderType: 'Inbox' },
        { folderId: 'SENT', folderType: 'Sent' },
      ],
    });
  }
  if (url.pathname.endsWith('/messages/view')) {
    return Response.json({
      data: url.searchParams.get('folderId') === 'SENT' ? [enviado] : [entrante],
    });
  }
  if (url.pathname.endsWith('/content')) return Response.json({ data: { content: 'Hola' } });
  return new Response('', { status: 404 });
}

describe('Zoho: historial con enviados', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    ingestInboundEvent.mockReset();
    findMessageByExternalId.mockReset();
    savePollState.mockReset();
  });

  it('importa lo que contestó el comercio como saliente, en el hilo del cliente', async () => {
    listConnections.mockResolvedValue([connection]);
    findMessageByExternalId.mockResolvedValue(null);
    ingestInboundEvent.mockResolvedValue({});
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => zoho(input as string));

    const [resultado] = await pollAllZohoConnections();

    expect(resultado).toMatchObject({ ingested: 2 });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('includeto=true'))).toBe(true);
    const eventos = ingestInboundEvent.mock.calls.map((c) => c[1]);
    expect(eventos).toContainEqual(
      expect.objectContaining({
        externalMessageId: 'in-1',
        externalContactId: 'ana@x.com',
        externalThreadId: 'th-1',
        historical: true,
      }),
    );
    expect(eventos).toContainEqual(
      expect.objectContaining({
        externalMessageId: 'out-1',
        externalContactId: 'ana@x.com',
        contactName: 'Ana',
        externalThreadId: 'th-1',
        outbound: true,
      }),
    );
    const [, , patch, , opciones] = savePollState.mock.calls[0];
    expect(patch).toMatchObject({
      zoho_sent_folder_id: 'SENT',
      email_backfill_done: true,
      poll_sync_complete: true,
    });
    expect(opciones).toEqual({ complete: true });
  });

  it('lo ya guardado no se vuelve a pedir: ni cuerpo ni adjuntos', async () => {
    listConnections.mockResolvedValue([connection]);
    findMessageByExternalId.mockResolvedValue({ id: 'm', conversation_id: 'x' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => zoho(input as string));

    await pollAllZohoConnections();

    expect(ingestInboundEvent).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/content'))).toBe(false);
  });

  it('un 429 corta la corrida sin guardar cursores', async () => {
    listConnections.mockResolvedValue([connection]);
    findMessageByExternalId.mockResolvedValue(null);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/content') ? new Response('', { status: 429 }) : zoho(input as string),
    );

    const [resultado] = await pollAllZohoConnections();

    expect(resultado.error).toMatch(/429/);
    expect(savePollState).not.toHaveBeenCalled();
  });
});

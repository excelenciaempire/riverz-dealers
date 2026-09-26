import { afterEach, describe, expect, it, vi } from 'vitest'

const { ingestInboundEvent, findMessageByExternalId, ingestRawMedia } = vi.hoisted(() => ({
  ingestInboundEvent: vi.fn(),
  findMessageByExternalId: vi.fn(),
  ingestRawMedia: vi.fn(),
}))

vi.mock('../inbox-writer', () => ({ ingestInboundEvent }))
vi.mock('../message-lookup', () => ({ findMessageByExternalId }))
vi.mock('../media-ingest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media-ingest')>()),
  ingestRawMedia,
}))

import {
  FILTRO_DE_CONVERSACIONES,
  consultaGmail,
  ingestGmailMessage,
  sentidoGmail,
} from './poll'
import { FallaTransitoria } from '../email/falla-transitoria'

const propias = new Set(['tienda@shop.com'])

describe('la consulta de Gmail', () => {
  it('mira todo menos spam, papelera, borradores y chats — no sólo la bandeja', () => {
    const q = consultaGmail(Date.parse('2026-09-01T00:00:00Z'))
    expect(q).toBe(`${FILTRO_DE_CONVERSACIONES} after:1788220800`)
    expect(q).not.toContain('in:inbox')
  })

  it('el historial es un tramo cerrado', () => {
    expect(
      consultaGmail(Date.parse('2026-06-01T00:00:00Z'), Date.parse('2026-09-01T00:00:00Z')),
    ).toBe(`${FILTRO_DE_CONVERSACIONES} after:1780272000 before:1788220800`)
  })
})

describe('sentidoGmail', () => {
  it('lo que tiene la etiqueta SENT lo escribió el comercio', () => {
    expect(sentidoGmail(['SENT'], 'Tienda <tienda@shop.com>', propias)).toBe('saliente')
  })

  it('un correo desde el propio buzón es saliente aunque no esté en Enviados', () => {
    expect(sentidoGmail(['INBOX'], 'Tienda <Tienda@Shop.com>', propias)).toBe('saliente')
  })

  it('un hilo archivado del cliente sigue siendo entrante', () => {
    expect(sentidoGmail(['IMPORTANT'], 'Ana <ana@x.com>', propias)).toBe('entrante')
  })

  it('spam, papelera y borradores no son conversación', () => {
    expect(sentidoGmail(['SPAM'], 'ana@x.com', propias)).toBeNull()
    expect(sentidoGmail(['TRASH', 'SENT'], 'tienda@shop.com', propias)).toBeNull()
    expect(sentidoGmail(['DRAFT'], 'tienda@shop.com', propias)).toBeNull()
  })
})

const connection = {
  id: 'c',
  workspace_id: 'w',
  channel: 'gmail',
  status: 'connected',
  external_account_id: 'tienda@shop.com',
  config: { email: 'tienda@shop.com', sync_requested_at: '2026-09-26T00:00:00Z' },
  created_at: '2026-09-26T00:00:00Z',
  updated_at: '2026-09-26T00:00:00Z',
} as never

const b64 = (s: string) => Buffer.from(s).toString('base64url')

function mensaje(labels: string[], from: string, to: string) {
  return {
    id: 'g1',
    threadId: 't1',
    historyId: '77',
    internalDate: String(Date.parse('2026-08-01T10:00:00Z')),
    labelIds: labels,
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: to },
        { name: 'Subject', value: 'Pedido' },
        { name: 'Message-ID', value: '<m1@x.com>' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: b64('hola') } },
        { mimeType: 'application/pdf', filename: 'boleta.pdf', body: { attachmentId: 'a1', size: 10 } },
      ],
    },
  }
}

describe('ingestGmailMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    ingestInboundEvent.mockReset()
    findMessageByExternalId.mockReset()
    ingestRawMedia.mockReset()
  })

  it('un correo ya guardado no vuelve a bajar sus adjuntos', async () => {
    findMessageByExternalId.mockResolvedValue({ id: 'm', conversation_id: 'c' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(mensaje(['INBOX'], 'Ana <ana@x.com>', 'tienda@shop.com')))

    const r = await ingestGmailMessage({} as never, connection, 'token', 'g1')

    expect(r).toEqual({ ingested: false, historyId: '77' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(findMessageByExternalId).toHaveBeenCalledWith({}, {
      workspaceId: 'w',
      channel: 'gmail',
      externalMessageId: '<m1@x.com>',
    })
    expect(ingestInboundEvent).not.toHaveBeenCalled()
  })

  it('un enviado entra como del comercio, en la conversación del cliente, con su adjunto', async () => {
    findMessageByExternalId.mockResolvedValue(null)
    ingestInboundEvent.mockResolvedValue({})
    ingestRawMedia.mockResolvedValue({ url: '/api/media/w/ana/g1-a1.pdf', mediaMime: 'application/pdf', mediaSize: 3 })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(mensaje(['SENT'], 'Tienda <tienda@shop.com>', 'tienda@shop.com, "Ana" <ana@x.com>')),
      )
      .mockResolvedValueOnce(Response.json({ data: b64('pdf') }))

    const r = await ingestGmailMessage({} as never, connection, 'token', 'g1')

    expect(r.ingested).toBe(true)
    expect(findMessageByExternalId).toHaveBeenCalledWith({}, expect.objectContaining({ externalMessageId: 'g1' }))
    const event = ingestInboundEvent.mock.calls[0][1]
    expect(event).toMatchObject({
      outbound: true,
      externalContactId: 'ana@x.com',
      externalMessageId: 'g1',
      externalThreadId: 't1',
      attachments: [{ url: '/api/media/w/ana/g1-a1.pdf', name: 'boleta.pdf' }],
    })
  })

  it('un 429 al leer el mensaje corta la corrida en vez de saltearlo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 429 }))
    await expect(
      ingestGmailMessage({} as never, connection, 'token', 'g1'),
    ).rejects.toBeInstanceOf(FallaTransitoria)
  })

  it('un 5xx al bajar el adjunto no guarda el correo sin su archivo', async () => {
    findMessageByExternalId.mockResolvedValue(null)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(mensaje(['INBOX'], 'Ana <ana@x.com>', 'tienda@shop.com')))
      .mockResolvedValueOnce(new Response('', { status: 503 }))

    await expect(
      ingestGmailMessage({} as never, connection, 'token', 'g1'),
    ).rejects.toBeInstanceOf(FallaTransitoria)
    expect(ingestInboundEvent).not.toHaveBeenCalled()
  })

  it('un correo borrado entre el listado y la lectura se saltea', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(ingestGmailMessage({} as never, connection, 'token', 'g1')).resolves.toEqual({
      ingested: false,
    })
  })
})

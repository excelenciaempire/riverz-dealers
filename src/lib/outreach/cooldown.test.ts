import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { recentlyContacted, OUTREACH_COOLDOWN_HOURS } from './cooldown'

/**
 * Doble de Supabase: cada `from(tabla)` devuelve una cadena encadenable que
 * ignora los filtros y responde lo que se le configuró para esa tabla.
 */
type QueryCall = { table: string; m: string; args: unknown[] }
type QueryResult = { data?: unknown; error?: unknown }
function fakeDb(responses: Record<string, QueryResult | ((calls: QueryCall[]) => QueryResult)>) {
  const calls: QueryCall[] = []
  const make = (table: string) => {
    const res = responses[table] ?? { data: [] }
    const localCalls: QueryCall[] = []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'order', 'limit']) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, m, args }); localCalls.push({ table, m, args })
        return chain
      }
    }
    // `limit` cierra la consulta: se resuelve como promesa.
    chain.then = (resolve: (v: unknown) => unknown) => resolve(typeof res === 'function' ? res(localCalls) : res)
    return chain
  }
  return {
    db: { from: (t: string) => make(t) } as never,
    calls,
  }
}

const ARGS = { workspaceId: 'ws', contactId: 'c1' }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('recentlyContacted', () => {
  it('bloquea cuando hay una plantilla saliente reciente', async () => {
    const { db } = fakeDb({
      conversations: { data: [{ id: 'v1' }] },
      messages: {
        data: [
          { id: 'm1', template_name: 'carrito_abandonado', created_at: '2026-08-13T10:00:00Z' },
        ],
      },
    })
    const r = await recentlyContacted(db, ARGS)
    expect(r.blocked).toBe(true)
    expect(r.template).toBe('carrito_abandonado')
    expect(r.at).toBe('2026-08-13T10:00:00Z')
  })

  it('deja pasar cuando no hubo plantillas', async () => {
    const { db } = fakeDb({
      conversations: { data: [{ id: 'v1' }] },
      messages: { data: [] },
    })
    expect((await recentlyContacted(db, ARGS)).blocked).toBe(false)
  })

  it('deja pasar cuando el contacto no tiene conversaciones', async () => {
    const { db } = fakeDb({ conversations: { data: [] } })
    expect((await recentlyContacted(db, ARGS)).blocked).toBe(false)
  })

  it('ignora el mensaje que el propio llamador acaba de mandar', async () => {
    const { db } = fakeDb({
      conversations: { data: [{ id: 'v1' }] },
      messages: {
        data: [{ id: 'mio', template_name: 'x', created_at: '2026-08-13T10:00:00Z' }],
      },
    })
    const r = await recentlyContacted(db, { ...ARGS, excludeMessageIds: ['mio'] })
    expect(r.blocked).toBe(false)
  })

  it('ante un error de lectura NO bloquea', async () => {
    // Bloquear de más apaga en silencio la recuperación de un comercio
    // entero; dejar pasar de más manda un repetido, que se ve enseguida.
    const { db } = fakeDb({
      conversations: { data: [{ id: 'v1' }] },
      messages: { error: { message: 'boom' } },
    })
    expect((await recentlyContacted(db, ARGS)).blocked).toBe(false)

    const { db: db2 } = fakeDb({ broadcast_delivery_receipts: { error: { message: 'boom' } } })
    expect((await recentlyContacted(db2, ARGS)).blocked).toBe(false)
  })

  it('filtra por ventana, salientes y plantilla no nula', async () => {
    const { db, calls } = fakeDb({
      conversations: { data: [{ id: 'v1' }] },
      messages: { data: [] },
    })
    await recentlyContacted(db, ARGS)
    const msgCalls = calls.filter((c) => c.table === 'messages')
    const flat = JSON.stringify(msgCalls)
    // No cuenta lo que escribió el cliente ni el texto libre del agente.
    expect(flat).toContain('sender_type')
    expect(flat).toContain('customer')
    expect(flat).toContain('template_name')
    expect(flat).toContain('created_at')
    expect(flat).toContain('conversation.workspace_id')
    expect(flat).toContain('conversation.contact_id')
    expect(flat).toContain('status')
    expect(flat).toContain('sent')
  })

  it('detects a confirmed campaign without any inbox conversation', async () => {
    const { db, calls } = fakeDb({
      broadcast_delivery_receipts: { data: [{ provider_message_id: 'wamid.campaign', created_at: '2026-10-01T03:00:00Z', broadcasts: { template_name: 'promotion' } }] },
    })
    expect(await recentlyContacted(db, ARGS)).toEqual({ blocked: true, at: '2026-10-01T03:00:00Z', template: 'promotion' })
    const filters = calls.filter(call => call.table === 'broadcast_delivery_receipts')
    expect(filters).toContainEqual({table:'broadcast_delivery_receipts',m:'eq',args:['workspace_id','ws']})
    expect(filters).toContainEqual({table:'broadcast_delivery_receipts',m:'eq',args:['broadcasts.workspace_id','ws']})
    expect(filters).toContainEqual({table:'broadcast_delivery_receipts',m:'eq',args:['broadcast_recipients.contact_id','c1']})
    expect(filters).toContainEqual({table:'broadcast_delivery_receipts',m:'eq',args:['state','accepted']})
    expect(filters).toContainEqual({table:'broadcast_delivery_receipts',m:'is',args:['broadcasts.voice_note',null]})
  })
  it('uses the original reservation date and not a later inbox repair timestamp', async () => {
    const { db } = fakeDb({ broadcast_delivery_receipts: { data: [{ provider_message_id:'wamid',created_at:'2026-10-01T01:00:00Z',updated_at:'2026-10-01T05:00:00Z',broadcasts:{template_name:'promotion'} }] } })
    expect((await recentlyContacted(db,ARGS)).at).toBe('2026-10-01T01:00:00Z')
  })
  it('does not restart an expired window when the inbox mirror is repaired later', async () => {
    const { db, calls } = fakeDb({
      messages:{data:[{id:'repair',message_id:'wamid.old',template_name:'promotion',created_at:'2026-10-01T11:00:00Z'}]},
      broadcast_delivery_receipts: query => ({ data: query.some(call => call.m === 'gte') ? [] : [{provider_message_id:'wamid.old',created_at:'2026-09-28T12:00:00Z',updated_at:'2026-10-01T11:00:00Z',broadcasts:{template_name:'promotion'}}] }),
    })
    expect((await recentlyContacted(db,ARGS)).blocked).toBe(false)
    expect(calls).toContainEqual({ table: 'broadcast_delivery_receipts', m: 'in', args: ['provider_message_id', ['wamid.old']] })
  })
  it('selects the newest valid evidence across messages and campaign receipts', async () => {
    const { db } = fakeDb({
      messages:{data:[{id:'message',template_name:'confirmation',created_at:'2026-10-01T01:00:00Z'}]},
      broadcast_delivery_receipts:{data:[{provider_message_id:'campaign',created_at:'2026-10-01T02:00:00Z',broadcasts:{template_name:'promotion'}}]},
    })
    expect((await recentlyContacted(db,ARGS)).template).toBe('promotion')
  })
  it('excludes a caller’s own confirmed message in both its inbox and campaign representations', async () => {
    const { db } = fakeDb({
      messages:{data:[{id:'own',message_id:'wamid.own',template_name:'confirmation',created_at:'2026-10-01T02:00:00Z'}]},
      broadcast_delivery_receipts:{data:[{provider_message_id:'wamid.own',created_at:'2026-10-01T02:00:00Z',broadcasts:{template_name:'confirmation'}}]},
    })
    expect((await recentlyContacted(db,{...ARGS,excludeMessageIds:['own']})).blocked).toBe(false)
  })
  it('uses confirmed evidence from one source even if the other cannot be read', async () => {
    const { db } = fakeDb({ messages:{error:{message:'offline'}},broadcast_delivery_receipts:{data:[{provider_message_id:'campaign',created_at:'2026-10-01T02:00:00Z',broadcasts:{template_name:'promotion'}}]} })
    expect((await recentlyContacted(db,ARGS)).blocked).toBe(true)
    const { db: other } = fakeDb({ messages:{data:[{id:'message',created_at:'2026-10-01T02:00:00Z',template_name:'confirmation'}]},broadcast_delivery_receipts:{error:{message:'offline'}} })
    expect((await recentlyContacted(other,ARGS)).blocked).toBe(true)
  })

  it('la ventana por defecto es de 24 horas', () => {
    expect(OUTREACH_COOLDOWN_HOURS).toBe(24)
  })
})

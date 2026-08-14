import { describe, it, expect } from 'vitest'
import { recentlyContacted, OUTREACH_COOLDOWN_HOURS } from './cooldown'

/**
 * Doble de Supabase: cada `from(tabla)` devuelve una cadena encadenable que
 * ignora los filtros y responde lo que se le configuró para esa tabla.
 */
function fakeDb(responses: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: Record<string, unknown>[] = []
  const make = (table: string) => {
    const res = responses[table] ?? { data: [] }
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'not', 'gte', 'order', 'limit']) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, m, args })
        return chain
      }
    }
    // `limit` cierra la consulta: se resuelve como promesa.
    chain.then = (resolve: (v: unknown) => unknown) => resolve(res)
    return chain
  }
  return {
    db: { from: (t: string) => make(t) } as never,
    calls,
  }
}

const ARGS = { workspaceId: 'ws', contactId: 'c1' }

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

    const { db: db2 } = fakeDb({ conversations: { error: { message: 'boom' } } })
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
  })

  it('la ventana por defecto es de 24 horas', () => {
    expect(OUTREACH_COOLDOWN_HOURS).toBe(24)
  })
})

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { INTEGRATION_CAPABILITIES } from './integrations'
import { canalesDelGrupo } from '@/lib/integrations/disconnect'
import type { CapabilityContext } from './types'

/**
 * Las dos cosas que no se pueden romper acá:
 *
 *  - el token no sale nunca. `integraciones.estado` LEE la columna `secrets`
 *    para sacar una fecha de vencimiento, y devolver la fila entera por comodidad
 *    le entregaría el refresh_token cifrado a un modelo.
 *  - desconectar corta lo de ESTA cuenta. La pantalla se apoyaba en RLS; acá el
 *    cliente tiene llave de servicio y el único cerco es el filtro explícito.
 */

interface Consulta {
  tabla: string
  filtros: Record<string, unknown>
  patch?: Record<string, unknown>
}

/** Cliente falso: devuelve filas fijas por tabla y anota cómo se las pidieron. */
function fakeDb(
  tablas: Record<string, unknown[]>,
  registro: Consulta[] = [],
): SupabaseClient {
  return {
    from(tabla: string) {
      const filas = tablas[tabla] ?? []
      const consulta: Consulta = { tabla, filtros: {} }
      registro.push(consulta)
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        update: (patch: Record<string, unknown>) => {
          consulta.patch = patch
          return q
        },
        eq: (col: string, val: unknown) => {
          consulta.filtros[col] = val
          return q
        },
        in: (col: string, val: unknown) => {
          consulta.filtros[col] = val
          return q
        },
        neq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: filas[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: filas, error: null }).then(res),
      })
      return q
    },
  } as unknown as SupabaseClient
}

function ctxCon(db: SupabaseClient): CapabilityContext {
  return { db, workspaceId: 'ws-1', actor: { type: 'operator', id: 'u-1' } }
}

const cap = (key: string) => {
  const c = INTEGRATION_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta ${key}`)
  return c
}

describe('contrato de las capacidades', () => {
  it('ninguna pide workspace_id: la cuenta va en el contexto', () => {
    for (const c of INTEGRATION_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
      expect(c.schema.required ?? [], c.key).not.toContain('workspace_id')
    }
  })

  it('la irreversible trae preview', () => {
    for (const c of INTEGRATION_CAPABILITIES.filter((x) => x.risk === 'irreversible')) {
      expect(typeof c.preview, c.key).toBe('function')
    }
  })
})

describe('integraciones.estado', () => {
  const filas = [
    {
      id: 'c1',
      channel: 'gmail',
      label: 'ventas@tienda.com',
      status: 'connected',
      external_account_id: 'ventas@tienda.com',
      config: { email: 'ventas@tienda.com' },
      secrets: {
        refresh_token: 'cifrado-no-mostrar',
        access_token_expires_at: '2020-01-01T00:00:00.000Z',
      },
      last_error: null,
      last_synced_at: '2026-08-19T10:00:00.000Z',
      created_at: '2026-01-05T10:00:00.000Z',
    },
    {
      id: 'c2',
      channel: 'mercadolibre',
      label: null,
      status: 'error',
      external_account_id: '123',
      config: { seller_id: '123', token_expires_at: '2099-01-01T00:00:00.000Z' },
      secrets: { access_token: 'cifrado-no-mostrar' },
      last_error: 'invalid_grant',
      last_synced_at: null,
      created_at: '2026-02-05T10:00:00.000Z',
    },
    {
      id: 'c3',
      channel: 'instagram',
      label: 'Pilar (Instagram)',
      status: 'disconnected',
      external_account_id: '999',
      config: {},
      secrets: {},
      last_error: null,
      last_synced_at: null,
      created_at: '2026-03-05T10:00:00.000Z',
    },
  ]

  it('no devuelve nada de la columna secrets', async () => {
    const r = (await cap('integraciones.estado').run(
      ctxCon(fakeDb({ channel_connections: filas })),
      {},
    )) as { canales: unknown[] }
    expect(JSON.stringify(r.canales)).not.toContain('cifrado-no-mostrar')
  })

  it('lee el vencimiento de los dos lugares donde se guarda', async () => {
    const r = (await cap('integraciones.estado').run(
      ctxCon(fakeDb({ channel_connections: filas })),
      {},
    )) as { canales: Array<{ canal: string; vence: string | null; vencido: boolean }> }
    // Gmail lo guarda en `secrets`; Mercado Libre en `config`.
    const gmail = r.canales.find((c) => c.canal === 'gmail')
    const ml = r.canales.find((c) => c.canal === 'mercadolibre')
    expect(gmail?.vence).toBe('2020-01-01T00:00:00.000Z')
    expect(gmail?.vencido).toBe(true)
    expect(ml?.vence).toBe('2099-01-01T00:00:00.000Z')
    expect(ml?.vencido).toBe(false)
  })

  it('incluye las desconectadas: es la respuesta a "cuál se cayó"', async () => {
    const r = (await cap('integraciones.estado').run(
      ctxCon(fakeDb({ channel_connections: filas })),
      {},
    )) as { canales: Array<{ canal: string; estado: string; cuenta: string | null }> }
    const ig = r.canales.find((c) => c.canal === 'instagram')
    expect(ig?.estado).toBe('disconnected')
    expect(ig?.cuenta).toBe('Pilar (Instagram)')
  })

  it('todo lo que consulta va acotado a la cuenta del contexto', async () => {
    const registro: Consulta[] = []
    await cap('integraciones.estado').run(
      ctxCon(fakeDb({ channel_connections: filas }, registro)),
      {},
    )
    expect(registro.length).toBeGreaterThan(0)
    for (const c of registro) expect(c.filtros.workspace_id).toBe('ws-1')
  })
})

describe('integraciones.desconectar', () => {
  const activas = [
    {
      id: 'c1',
      channel: 'instagram',
      label: 'Pilar (Instagram)',
      external_account_id: '999',
    },
    { id: 'c2', channel: 'ig_comment', label: 'Pilar (Instagram)', external_account_id: '999' },
  ]

  it('el DM y los comentarios de Meta caen juntos', () => {
    expect(canalesDelGrupo('instagram')).toEqual(['instagram', 'ig_comment'])
    expect(canalesDelGrupo('messenger')).toEqual(['messenger', 'fb_comment'])
    // WhatsApp no tiene hermano de comentarios.
    expect(canalesDelGrupo('whatsapp')).toEqual(['whatsapp'])
  })

  it('el preview nombra la cuenta concreta y lo que deja de funcionar', async () => {
    const texto = await cap('integraciones.desconectar').preview!(
      ctxCon(fakeDb({ channel_connections: activas })),
      { canal: 'instagram' },
    )
    expect(texto).toContain('Pilar (Instagram)')
    expect(texto).toContain('Comentarios IG')
    expect(texto).toMatch(/automatizaciones y campañas/)
    expect(texto).toMatch(/Ajustes → Canales/)
  })

  it('el preview avisa cuando no hay nada que cortar', async () => {
    const texto = await cap('integraciones.desconectar').preview!(
      ctxCon(fakeDb({ channel_connections: [] })),
      { canal: 'whatsapp' },
    )
    expect(texto).toMatch(/no habría nada que desconectar/)
  })

  it('el UPDATE va filtrado por cuenta y por el grupo de canales', async () => {
    const registro: Consulta[] = []
    await cap('integraciones.desconectar').run(
      ctxCon(fakeDb({ channel_connections: activas }, registro)),
      { canal: 'instagram' },
    )
    const update = registro.find((c) => c.patch)
    expect(update?.patch).toEqual({ status: 'disconnected' })
    expect(update?.filtros.workspace_id).toBe('ws-1')
    expect(update?.filtros.channel).toEqual(['instagram', 'ig_comment'])
  })

  it('un canal que no existe corta antes de tocar nada', async () => {
    const registro: Consulta[] = []
    await expect(
      cap('integraciones.desconectar').run(ctxCon(fakeDb({}, registro)), {
        canal: 'telegram',
      }),
    ).rejects.toThrow(/no se puede desconectar/)
    expect(registro).toHaveLength(0)
  })
})

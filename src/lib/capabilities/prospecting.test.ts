import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { PROSPECTING_CAPABILITIES } from './prospecting'
import type { AnyCapability, CapabilityContext } from './types'

/**
 * Prospección es el dominio donde un error se paga afuera: el mensaje le llega
 * a alguien que no escribió primero. Lo que se prueba acá es eso — que antes de
 * lanzar se diga a cuánta gente y con qué texto, que la cuenta no se pueda
 * cambiar por argumento, y que nada quede marcado para construirse solo.
 */

const WS = 'ws-1'

interface Filtros {
  eq: Record<string, unknown>
  in: Record<string, unknown[]>
}

interface Respuesta {
  data?: unknown
  count?: number
  error?: { message: string } | null
}

type Handler = (f: Filtros) => Respuesta

interface Insercion {
  table: string
  payload: Record<string, unknown>
}

interface Q {
  select: (...a: unknown[]) => Q
  insert: (payload: Record<string, unknown>) => Q
  eq: (col: string, val: unknown) => Q
  is: (col: string, val: unknown) => Q
  neq: (col: string, val: unknown) => Q
  gt: (col: string, val: unknown) => Q
  gte: (col: string, val: unknown) => Q
  not: (...a: unknown[]) => Q
  or: (...a: unknown[]) => Q
  in: (col: string, vals: unknown[]) => Q
  order: (...a: unknown[]) => Q
  limit: (...a: unknown[]) => Q
  maybeSingle: () => Promise<Respuesta>
  single: () => Promise<Respuesta>
  then: (
    resolve: (v: Respuesta) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise<unknown>
}

/** Supabase mínimo: un handler por tabla que ve los filtros que le pusieron. */
function fakeDb(
  tablas: Record<string, Handler>,
  registro: Insercion[] = [],
): SupabaseClient {
  return {
    from(table: string) {
      const f: Filtros = { eq: {}, in: {} }
      const resolver = (): Respuesta => tablas[table]?.(f) ?? { data: [] }
      const uno = (): Respuesta => {
        const r = resolver()
        const d = r.data
        return { ...r, data: Array.isArray(d) ? (d[0] ?? null) : (d ?? null) }
      }
      const q: Q = {
        select: () => q,
        insert: (payload) => {
          registro.push({ table, payload })
          return q
        },
        eq: (col, val) => {
          f.eq[col] = val
          return q
        },
        is: () => q,
        neq: () => q,
        gt: () => q,
        gte: () => q,
        not: () => q,
        or: () => q,
        in: (col, vals) => {
          f.in[col] = vals
          return q
        },
        order: () => q,
        limit: () => q,
        maybeSingle: () => Promise.resolve(uno()),
        single: () => Promise.resolve(uno()),
        then: (resolve, reject) => Promise.resolve(resolver()).then(resolve, reject),
      }
      return q
    },
  } as unknown as SupabaseClient
}

const ctxDe = (db: SupabaseClient): CapabilityContext => ({
  db,
  workspaceId: WS,
  actor: { type: 'operator', id: 'u-1' },
  locale: 'es',
})

const cap = (key: string): AnyCapability =>
  PROSPECTING_CAPABILITIES.find((c) => c.key === key) as unknown as AnyCapability

const hace = (ms: number) => new Date(Date.now() - ms).toISOString()
const HORA = 60 * 60 * 1000

const PLAN = {
  campaign_name: 'Reactivar comentaristas',
  audience: { description: 'Comentaristas del último post', source: '', estimated_reach: 200 },
  message: { text: 'Hola, vi tu comentario y te guardé un 15% con el código HOLA15.' },
  offer: { code: 'HOLA15', discount: '15%', conditions: '' },
  follow_up: '',
  comment_reply: '',
  recommended_products: [],
  funnel: { contacted: 0, replies: 0, conversions: 0, est_revenue: '' },
  next_steps: [],
}

/**
 * Una cuenta con `comentaristas` personas alcanzables y una campaña en
 * borrador. `ajustes` permite apagar la prospección o poner el freno.
 */
function escenario(
  opts: {
    comentaristas?: number
    campana?: Record<string, unknown> | null
    recipients?: Array<Record<string, unknown>>
    ajustes?: Record<string, unknown> | null
    dmsHoy?: number
  },
  registro: Insercion[] = [],
) {
  const n = opts.comentaristas ?? 0
  const ids = Array.from({ length: n }, (_, i) => `c${i}`)
  const recipients = opts.recipients ?? []

  return fakeDb(
    {
      instagram_campaigns: () => ({
        data: opts.campana === undefined ? [] : opts.campana ? [opts.campana] : [],
      }),
      instagram_campaign_recipients: (f) => {
        // El id de campaña no se filtra: el escenario tiene una sola. Lo que sí
        // importa es el estado y el holdout, que es lo que separa "en cola" de
        // "ya contactado" y de "no recibe nada".
        const filas = recipients.filter((r) => {
          for (const [col, val] of Object.entries(f.eq)) {
            if (col === 'campaign_id') continue
            if (r[col] !== val) return false
          }
          return true
        })
        return { data: filas, count: filas.length }
      },
      conversations: (f) =>
        f.eq.channel === 'ig_comment'
          ? { data: ids.map((id) => ({ contact_id: id, last_message_at: hace(HORA) })) }
          : { data: [] },
      contacts: (f) => ({
        data: ((f.in.id as string[] | undefined) ?? []).map((id) => ({
          id,
          external_id: `ig-${id}`,
        })),
      }),
      meta_marketing_optins: () => ({ data: [] }),
      ig_proactive_settings: () =>
        opts.ajustes === undefined
          ? { data: { paused: false, daily_cap: 500, outreach_enabled: true } }
          : { data: opts.ajustes },
      ig_proactive_log: () => ({ count: opts.dmsHoy ?? 0 }),
    },
    registro,
  )
}

const CAMPANA = {
  id: 'camp-1',
  name: 'Reactivar comentaristas',
  goal: 'Recuperar a los que comentaron',
  status: 'draft',
  plan: PLAN,
  holdout_pct: 10,
  offer_code: 'HOLA15',
  metrics: {},
  launched_at: null,
  created_at: hace(HORA),
  updated_at: hace(HORA),
}

// ---------------------------------------------------------------------------

describe('invariantes del dominio', () => {
  it('ninguna pide la cuenta como argumento', () => {
    for (const c of PROSPECTING_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
      expect(c.schema.required ?? [], c.key).not.toContain('workspace_id')
    }
  })

  it('lanzar es irreversible y trae preview', () => {
    const c = cap('prospeccion.lanzar')
    expect(c.risk).toBe('irreversible')
    expect(typeof c.preview).toBe('function')
  })

  it('lanzar nunca es inerte; guardar el borrador sí', () => {
    // Escribirle a alguien que no pidió nada nunca se construye solo. El
    // borrador ni siquiera resuelve la audiencia, así que no alcanza a nadie.
    expect(cap('prospeccion.lanzar').inerte).toBeUndefined()
    expect(cap('prospeccion.crear_campana').inerte).toBe(true)
  })
})

describe('prospeccion.audiencia', () => {
  it('cuenta a quien se puede alcanzar hoy y por qué título', async () => {
    const out = (await cap('prospeccion.audiencia').run(
      ctxDe(escenario({ comentaristas: 12 })),
      {},
    )) as Record<string, unknown>
    expect(out.alcanzables_ahora).toBe(12)
    expect(out.comentaristas_7d).toBe(12)
    expect(out.envio_habilitado).toBe(true)
    expect(out.freno).toBeNull()
  })

  it('avisa cuando el envío está frenado aunque haya gente', async () => {
    const out = (await cap('prospeccion.audiencia').run(
      ctxDe(escenario({ comentaristas: 5, ajustes: { paused: true, outreach_enabled: true } })),
      {},
    )) as Record<string, unknown>
    expect(out.alcanzables_ahora).toBe(5)
    expect(out.envio_habilitado).toBe(false)
    expect(String(out.freno)).toMatch(/freno de emergencia/)
  })
})

describe('prospeccion.campanas', () => {
  it('devuelve el embudo real, no el estimado del plan', async () => {
    const db = escenario({
      campana: CAMPANA,
      recipients: [
        { campaign_id: 'camp-1', status: 'sent', is_holdout: false },
        { campaign_id: 'camp-1', status: 'sent', is_holdout: false },
        { campaign_id: 'camp-1', status: 'replied', is_holdout: false },
        { campaign_id: 'camp-1', status: 'queued', is_holdout: true },
      ],
    })
    const out = (await cap('prospeccion.campanas').run(ctxDe(db), {})) as {
      total: number
      campanas: Array<Record<string, unknown>>
    }
    expect(out.total).toBe(1)
    const c = out.campanas[0]
    expect(c.estado).toBe('draft')
    expect(c.destinatarios).toMatchObject({
      total: 4,
      contactados: 2,
      respondieron: 1,
      en_control: 1,
    })
    expect(c.mensaje).toContain('HOLA15')
  })
})

describe('prospeccion.crear_campana', () => {
  it('el preview dice el tope y el mensaje, y aclara que no manda nada', async () => {
    const texto = await cap('prospeccion.crear_campana').preview!(ctxDe(escenario({})), {
      nombre: 'Reactivar',
      objetivo: 'Recuperar comentaristas',
      mensaje: 'Hola, te guardé un 15%',
      audiencia: 'Comentaristas del último post',
      alcance: 300,
    })
    expect(texto).toContain('Reactivar')
    expect(texto).toContain('300')
    expect(texto).toContain('Hola, te guardé un 15%')
    expect(texto).toMatch(/no le escribe a nadie/i)
  })

  it('nace en borrador y con la cuenta del contexto', async () => {
    const registro: Insercion[] = []
    const db = escenario({ campana: CAMPANA }, registro)
    const out = (await cap('prospeccion.crear_campana').run(ctxDe(db), {
      nombre: 'Reactivar',
      objetivo: 'Recuperar comentaristas',
      mensaje: 'Hola, te guardé un 15%',
      audiencia: 'Comentaristas del último post',
    })) as { nota: string }
    expect(out.nota).toMatch(/borrador/i)

    const fila = registro.find((r) => r.table === 'instagram_campaigns')?.payload
    expect(fila?.status).toBe('draft')
    expect(fila?.workspace_id).toBe(WS)
    expect(fila?.holdout_pct).toBe(10)
  })

  it('sin mensaje no se guarda nada: lo dice en castellano', async () => {
    await expect(
      cap('prospeccion.crear_campana').run(ctxDe(escenario({})), {
        nombre: 'Reactivar',
        objetivo: 'Recuperar comentaristas',
        audiencia: 'Comentaristas',
      }),
    ).rejects.toThrow(/faltan datos/i)
  })
})

describe('prospeccion.lanzar', () => {
  it('el preview dice a cuánta gente, cuántas quedan de control y el mensaje', async () => {
    const db = escenario({ campana: CAMPANA, comentaristas: 20 })
    const texto = await cap('prospeccion.lanzar').preview!(ctxDe(db), {
      campaign_id: 'camp-1',
    })
    // 20 alcanzables, 10% de control ⇒ 18 reciben, 2 miran.
    expect(texto).toContain('18')
    expect(texto).toMatch(/no pidieron nada/)
    expect(texto).toMatch(/2 quedan como grupo de control/)
    expect(texto).toContain('HOLA15')
    expect(texto).toMatch(/no se puede deshacer/)
  })

  it('el preview avisa si la prospección está apagada', async () => {
    const db = escenario({
      campana: CAMPANA,
      comentaristas: 20,
      ajustes: { paused: false, daily_cap: 500, outreach_enabled: false },
    })
    const texto = await cap('prospeccion.lanzar').preview!(ctxDe(db), {
      campaign_id: 'camp-1',
    })
    expect(texto).toMatch(/apagada/)
  })

  it('sin nadie alcanzable el preview no promete un envío', async () => {
    const db = escenario({ campana: CAMPANA, comentaristas: 0 })
    // Lanzar algo que no le llega a nadie es un click que no hace nada, así
    // que no se propone: se dice y se corrige el público.
    await expect(
      cap('prospeccion.lanzar').preview!(ctxDe(db), { campaign_id: 'camp-1' }),
    ).rejects.toThrow(/no alcanza hoy a nadie/)
  })

  it('una campaña de otra cuenta no existe', async () => {
    const db = escenario({ campana: null })
    await expect(
      cap('prospeccion.lanzar').preview!(ctxDe(db), { campaign_id: 'camp-ajena' }),
    ).rejects.toThrow(/no existe en esta cuenta/)
    await expect(
      cap('prospeccion.lanzar').run(ctxDe(db), { campaign_id: 'camp-ajena' }),
    ).rejects.toThrow(/no existe en esta cuenta/)
  })

  it('lanzar sin audiencia falla con el motivo, no con un código', async () => {
    const db = escenario({ campana: CAMPANA, comentaristas: 0 })
    await expect(
      cap('prospeccion.lanzar').run(ctxDe(db), { campaign_id: 'camp-1' }),
    ).rejects.toThrow(/no alcanza a nadie/)
  })
})

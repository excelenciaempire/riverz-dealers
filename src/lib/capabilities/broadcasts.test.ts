import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { BROADCAST_CAPABILITIES } from './broadcasts'
import type { Capability, CapabilityContext } from './types'

/**
 * Lo que se prueba acá es el CONTRATO con el cron.
 *
 * El envío real lo hace `app/api/broadcasts/cron/route.ts`, que sólo mira las
 * campañas 'scheduled' vencidas y sus destinatarios 'pending'. Si estas
 * capacidades escribieran otro estado u otra forma de los parámetros, la
 * campaña se crearía sin error y no saldría nunca — o peor, saldría con los
 * textos corridos de posición. Nada de eso se ve mirando el código: se ve acá.
 */

// ---------------------------------------------------------------------------
// Supabase de mentira: registra cada consulta y responde lo que diga el test.

interface Consulta {
  tabla: string
  op: 'select' | 'insert' | 'update' | 'delete'
  filtros: Record<string, unknown>
  cuenta: boolean
  filas?: unknown
  patch?: unknown
}

type Respuesta = { data?: unknown; error?: unknown; count?: number } | undefined

function fakeDb(responder: (q: Consulta) => Respuesta) {
  const registro: Consulta[] = []

  const from = (tabla: string) => {
    const q: Consulta = { tabla, op: 'select', filtros: {}, cuenta: false }
    const resolver = () => {
      registro.push(q)
      const r = responder(q) ?? {}
      return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }
    }
    const api: Record<string, unknown> = {
      select: (_cols?: unknown, opts?: { count?: string }) => {
        if (opts?.count) q.cuenta = true
        return api
      },
      insert: (filas: unknown) => {
        q.op = 'insert'
        q.filas = filas
        return api
      },
      update: (patch: unknown) => {
        q.op = 'update'
        q.patch = patch
        return api
      },
      delete: () => {
        q.op = 'delete'
        return api
      },
      eq: (k: string, v: unknown) => {
        q.filtros[k] = v
        return api
      },
      in: () => api,
      is: () => api,
      or: () => api,
      order: () => api,
      limit: () => api,
      range: () => api,
      maybeSingle: () => Promise.resolve(resolver()),
      single: () => Promise.resolve(resolver()),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(ok, fail),
    }
    return api
  }

  return { db: { from } as unknown as SupabaseClient, registro }
}

function ctxDe(db: SupabaseClient): CapabilityContext {
  return { db, workspaceId: 'w1', actor: { type: 'operator', id: 'u9' }, locale: 'es' }
}

function cap(key: string): Capability {
  const c = BROADCAST_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta ${key}`)
  return c
}

// ---------------------------------------------------------------------------

const PLANTILLA = {
  name: 'promo_agosto',
  language: 'es',
  status: 'Approved',
  body_text: 'Hola {{1}}, esta semana tenemos {{2}} en toda la tienda.',
  header_type: null,
  header_content: null,
  buttons: null,
}

const CONTACTOS = [
  { id: 'c1', name: 'Ana Gómez', phone: '+5491133334444', opted_out: false },
  { id: 'c2', name: 'Beto Baja', phone: '+5491133335555', opted_out: true },
  { id: 'c3', name: 'Caro Sin Tel', phone: null, opted_out: false },
]

/** Respuestas por defecto; cada test pisa lo que necesita. */
function mundo(extra: Partial<Record<string, Respuesta>> = {}) {
  return (q: Consulta): Respuesta => {
    if (extra[q.tabla] !== undefined && q.op === 'select') return extra[q.tabla]
    switch (q.tabla) {
      case 'message_templates':
        return { data: PLANTILLA }
      case 'contact_segments':
        return { data: { name: 'Compradores', rules: [], match_mode: 'all' } }
      case 'contacts':
        return { data: CONTACTOS, count: CONTACTOS.length }
      case 'workspaces':
        return { data: { owner_id: 'owner-1' } }
      case 'whatsapp_config':
        return { data: { id: 'wac1' } }
      case 'broadcasts':
        return { data: { id: 'b1', short_id: 'b1abcdef', name: 'Promo' } }
      default:
        return {}
    }
  }
}

const ARGS_CREAR = {
  nombre: 'Promo de agosto',
  plantilla: 'promo_agosto',
  segmento_id: 'seg-1',
  variables: { '1': 'first_name' },
  textos_fijos: { '2': '20% OFF' },
}

// ---------------------------------------------------------------------------

describe('campanas.crear', () => {
  it('escribe lo que el cron sabe leer', async () => {
    const { db, registro } = fakeDb(mundo())
    const r = (await cap('campanas.crear').run(ctxDe(db), ARGS_CREAR)) as Record<
      string,
      unknown
    >

    const campana = registro.find((q) => q.tabla === 'broadcasts' && q.op === 'insert')
    const fila = campana?.filas as Record<string, unknown>
    // Borrador: el cron sólo reclama las 'scheduled'. Con cualquier otro estado
    // la campaña saldría sin que nadie la haya lanzado.
    expect(fila.status).toBe('draft')
    expect(fila.workspace_id).toBe('w1')
    // El cron busca las credenciales de WhatsApp por user_id: va el dueño, no
    // quien pidió la campaña.
    expect(fila.user_id).toBe('owner-1')
    expect(fila.template_name).toBe('promo_agosto')
    expect(fila.total_recipients).toBe(1)
    expect(r.estado).toBe('borrador')
  })

  it('los destinatarios nacen pendientes y con sus textos ya resueltos', async () => {
    const { db, registro } = fakeDb(mundo())
    await cap('campanas.crear').run(ctxDe(db), ARGS_CREAR)

    const insert = registro.find(
      (q) => q.tabla === 'broadcast_recipients' && q.op === 'insert',
    )
    const filas = insert?.filas as Array<Record<string, unknown>>
    expect(filas).toHaveLength(1)
    expect(filas[0].contact_id).toBe('c1')
    expect(filas[0].status).toBe('pending')
    // Meta llena por POSICIÓN: params[0] es {{1}} y params[1] es {{2}}.
    expect(filas[0].params).toEqual(['Ana', '20% OFF'])
  })

  it('con un texto fijo no guarda variable_mapping', async () => {
    // Si hubiera mapping, el cron lo usaría e ignoraría los params — y el texto
    // fijo, que no es un campo del contacto, saldría vacío.
    const { db, registro } = fakeDb(mundo())
    await cap('campanas.crear').run(ctxDe(db), ARGS_CREAR)
    const fila = registro.find((q) => q.tabla === 'broadcasts' && q.op === 'insert')
      ?.filas as Record<string, unknown>
    expect(fila.variable_mapping).toBeNull()
  })

  it('si todas son campos guarda el mapping, para que el dato sea el del día del envío', async () => {
    const { db, registro } = fakeDb(
      mundo({ message_templates: { data: { ...PLANTILLA, body_text: 'Hola {{1}}, ¿todo bien?' } } }),
    )
    await cap('campanas.crear').run(ctxDe(db), {
      ...ARGS_CREAR,
      textos_fijos: undefined,
    })
    const fila = registro.find((q) => q.tabla === 'broadcasts' && q.op === 'insert')
      ?.filas as Record<string, unknown>
    expect(fila.variable_mapping).toEqual({ '1': 'first_name' })
  })

  it('deja afuera al dado de baja y al que no tiene WhatsApp', async () => {
    const { db } = fakeDb(mundo())
    const r = (await cap('campanas.crear').run(ctxDe(db), ARGS_CREAR)) as Record<
      string,
      unknown
    >
    expect(r.destinatarios).toBe(1)
    expect(r.sin_whatsapp).toBe(1)
    // `resolveSegment` no aplica su propio filtro de baja cuando el segmento no
    // tiene criterios: el de "todos" es el que más gente alcanza y el que peor
    // aguantaría escribirle a quien pidió no recibir nada.
    expect(r.dados_de_baja).toBe(1)
  })

  it('no crea nada si una variable de la plantilla no la llena nadie', async () => {
    const { db, registro } = fakeDb(mundo())
    await expect(
      cap('campanas.crear').run(ctxDe(db), { ...ARGS_CREAR, textos_fijos: undefined }),
    ).rejects.toThrow(/\{\{2\}\}/)
    expect(registro.some((q) => q.op === 'insert')).toBe(false)
  })

  it('no acepta un campo que no existe', async () => {
    const { db } = fakeDb(mundo())
    await expect(
      cap('campanas.crear').run(ctxDe(db), {
        ...ARGS_CREAR,
        variables: { '1': 'cumpleaños' },
      }),
    ).rejects.toThrow(/no es un campo del contacto/)
  })

  it('no acepta una plantilla que no está en la cuenta', async () => {
    const { db } = fakeDb(mundo({ message_templates: { data: null } }))
    await expect(cap('campanas.crear').run(ctxDe(db), ARGS_CREAR)).rejects.toThrow(
      /No existe la plantilla/,
    )
  })

  it('no crea una campaña vacía', async () => {
    const { db, registro } = fakeDb(mundo({ contacts: { data: [], count: 0 } }))
    await expect(cap('campanas.crear').run(ctxDe(db), ARGS_CREAR)).rejects.toThrow(
      /no alcanza a nadie/,
    )
    expect(registro.some((q) => q.op === 'insert')).toBe(false)
  })

  it('el preview dice la plantilla, el segmento y a cuánta gente', async () => {
    const { db } = fakeDb(mundo())
    const texto = await cap('campanas.crear').preview!(ctxDe(db), ARGS_CREAR)
    expect(texto).toContain('promo_agosto')
    expect(texto).toContain('Compradores')
    expect(texto).toContain('1 persona')
    expect(texto).toContain('1 dados de baja')
    expect(texto).toContain('borrador')
  })
})

describe('campanas.lanzar', () => {
  const BORRADOR = {
    id: 'b1',
    short_id: 'b1abcdef',
    name: 'Promo de agosto',
    template_name: 'promo_agosto',
    template_language: 'es',
    status: 'draft',
    scheduled_at: null,
    user_id: 'owner-1',
    total_recipients: 3,
  }

  /** El select de la campaña y el conteo de pendientes conviven en el mismo test. */
  function mundoLanzar(campana: Record<string, unknown>, pendientes: number) {
    return (q: Consulta): Respuesta => {
      if (q.tabla === 'broadcasts' && q.op === 'update') {
        return { data: { ...campana, ...(q.patch as Record<string, unknown>) } }
      }
      if (q.tabla === 'broadcasts') return { data: campana }
      if (q.tabla === 'broadcast_recipients') return { count: pendientes }
      if (q.tabla === 'message_templates') return { data: PLANTILLA }
      if (q.tabla === 'whatsapp_config') return { data: { id: 'wac1' } }
      return {}
    }
  }

  it('pasa el borrador a la cola del cron', async () => {
    const { db, registro } = fakeDb(mundoLanzar(BORRADOR, 3))
    const r = (await cap('campanas.lanzar').run(ctxDe(db), {
      campana_id: 'b1',
    })) as Record<string, unknown>

    const update = registro.find((q) => q.tabla === 'broadcasts' && q.op === 'update')
    const patch = update?.patch as Record<string, unknown>
    expect(patch.status).toBe('scheduled')
    expect(typeof patch.scheduled_at).toBe('string')
    // El error de un intento anterior no puede quedar colgado de una campaña
    // que se está por mandar de nuevo.
    expect(patch.error_message).toBeNull()
    // La cuenta va en el filtro: sin esto se podría lanzar una campaña ajena.
    expect(update?.filtros.workspace_id).toBe('w1')
    expect(r.destinatarios).toBe(3)
  })

  it('respeta la fecha con la que se armó la campaña', async () => {
    const futuro = new Date(Date.now() + 86_400_000).toISOString()
    const { db, registro } = fakeDb(
      mundoLanzar({ ...BORRADOR, scheduled_at: futuro }, 3),
    )
    await cap('campanas.lanzar').run(ctxDe(db), { campana_id: 'b1' })
    const patch = registro.find((q) => q.tabla === 'broadcasts' && q.op === 'update')
      ?.patch as Record<string, unknown>
    expect(patch.scheduled_at).toBe(futuro)
  })

  it('no relanza una campaña que ya salió', async () => {
    const { db, registro } = fakeDb(mundoLanzar({ ...BORRADOR, status: 'sent' }, 0))
    await expect(
      cap('campanas.lanzar').run(ctxDe(db), { campana_id: 'b1' }),
    ).rejects.toThrow(/ya salió/)
    expect(registro.some((q) => q.op === 'update')).toBe(false)
  })

  it('no lanza sin destinatarios pendientes', async () => {
    const { db } = fakeDb(mundoLanzar(BORRADOR, 0))
    await expect(
      cap('campanas.lanzar').run(ctxDe(db), { campana_id: 'b1' }),
    ).rejects.toThrow(/no tiene destinatarios pendientes/)
  })

  it('no lanza con una plantilla que Meta no aprobó', async () => {
    const responder = mundoLanzar(BORRADOR, 3)
    const { db, registro } = fakeDb((q) =>
      q.tabla === 'message_templates'
        ? { data: { ...PLANTILLA, status: 'Pending' } }
        : responder(q),
    )
    await expect(
      cap('campanas.lanzar').run(ctxDe(db), { campana_id: 'b1' }),
    ).rejects.toThrow(/Pending/)
    expect(registro.some((q) => q.op === 'update')).toBe(false)
  })

  it('no lanza si la cuenta no tiene WhatsApp conectado', async () => {
    const responder = mundoLanzar(BORRADOR, 3)
    const { db } = fakeDb((q) =>
      q.tabla === 'whatsapp_config' ? { data: null } : responder(q),
    )
    await expect(
      cap('campanas.lanzar').run(ctxDe(db), { campana_id: 'b1' }),
    ).rejects.toThrow(/WhatsApp conectado/)
  })

  it('el preview dice el nombre, la plantilla y a cuántos les llega', async () => {
    const { db } = fakeDb(mundoLanzar(BORRADOR, 342))
    const texto = await cap('campanas.lanzar').preview!(ctxDe(db), { campana_id: 'b1' })
    expect(texto).toContain('Promo de agosto')
    expect(texto).toContain('promo_agosto')
    expect(texto).toContain('342 personas')
    expect(texto).toContain('no se puede deshacer')
  })

  it('el preview avisa cuando la plantilla no está aprobada', async () => {
    const responder = mundoLanzar(BORRADOR, 10)
    const { db } = fakeDb((q) =>
      q.tabla === 'message_templates'
        ? { data: { ...PLANTILLA, status: 'Rejected' } }
        : responder(q),
    )
    const texto = await cap('campanas.lanzar').preview!(ctxDe(db), { campana_id: 'b1' })
    expect(texto).toContain('Rejected')
  })
})

describe('campanas.detalle', () => {
  it('trae los contadores y agrupa los motivos de falla', async () => {
    const { db } = fakeDb((q) => {
      if (q.tabla === 'broadcasts') {
        return {
          data: {
            id: 'b1',
            short_id: 'b1abcdef',
            name: 'Promo de agosto',
            template_name: 'promo_agosto',
            status: 'sent',
            total_recipients: 10,
            sent_count: 8,
            delivered_count: 7,
            read_count: 5,
            replied_count: 2,
            failed_count: 2,
          },
        }
      }
      if (q.tabla === 'broadcast_recipients' && q.cuenta) {
        return { count: q.filtros.status === 'pending' ? 1 : 3 }
      }
      return {
        data: [
          { error_message: 'Invalid phone number' },
          { error_message: 'Invalid phone number' },
          { error_message: 'Contacto dado de baja' },
        ],
      }
    })

    const r = (await cap('campanas.detalle').run(ctxDe(db), {
      campana_id: 'b1abcdef',
    })) as Record<string, unknown>

    expect(r.nombre).toBe('Promo de agosto')
    expect(r.sin_enviar).toBe(1)
    expect(r.dados_de_baja).toBe(3)
    expect(r.motivos_de_falla).toEqual([
      { motivo: 'Invalid phone number', cuantos: 2 },
      { motivo: 'Contacto dado de baja', cuantos: 1 },
    ])
  })

  it('no encuentra una campaña de otra cuenta', async () => {
    const { db, registro } = fakeDb(() => ({ data: null }))
    await expect(
      cap('campanas.detalle').run(ctxDe(db), { campana_id: 'b1' }),
    ).rejects.toThrow(/no existe en esta cuenta/)
    expect(registro[0].filtros.workspace_id).toBe('w1')
  })
})

describe('invariantes del dominio', () => {
  it('ninguna pide workspace_id: la cuenta va en el contexto', () => {
    for (const c of BROADCAST_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
    }
  })

  it('lanzar es irreversible y trae preview', () => {
    const l = cap('campanas.lanzar')
    expect(l.risk).toBe('irreversible')
    expect(typeof l.preview).toBe('function')
  })

  it('ninguna se declara inerte', () => {
    // Un envío masivo no se construye solo. Y crear, aunque no le llegue a
    // nadie, deja una campaña lista para lanzar: esa decisión la toma una
    // persona revisando el catálogo entero, no este archivo.
    for (const c of BROADCAST_CAPABILITIES) {
      expect(c.inerte, c.key).toBeUndefined()
    }
  })
})

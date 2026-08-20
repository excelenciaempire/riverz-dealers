import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lo que estas pruebas cuidan.
 *
 * 1. Que un segmento se pueda LEER. `segmentos.listar` devolvía `criterios: 3`
 *    —el conteo— y los ids de etiqueta son uuids: nadie podía editar un
 *    segmento porque nadie podía saber qué decía.
 * 2. Que editar reemplace lo que se manda y NO toque lo que no se habló. El
 *    caso feo es el modo: caer a 'all' por omisión le cambia el OR por un AND a
 *    un segmento que se armó con OR, y el público se achica sin que se vea por qué.
 * 3. Que la validación estricta de las reglas siga siendo la puerta: un
 *    criterio desconocido corta ANTES de escribir, porque saltearlo guardaría un
 *    segmento más grande del que se pidió.
 * 4. Que la cuenta salga del contexto. Un id de otro comercio tiene que dar "no
 *    existe" en las tres: leer, editar y borrar.
 * 5. Que el preview de borrar una etiqueta diga el daño real —a cuánta gente se
 *    la saca y qué automatizaciones quedan apuntando a nada—, porque es lo único
 *    que va a leer quien confirma algo que no se deshace.
 */

vi.mock('@/lib/segments/resolve', () => ({
  resolveSegment: vi.fn(async () => ({
    contacts: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
    total: 3,
  })),
}))

import { conDiff } from '@/lib/operator/artifacts-diff'
import { CONTACT_CAPABILITIES } from './contacts'
import type { Capability, CapabilityContext } from './types'

const WS = '11111111-1111-1111-1111-111111111111'
const OTRA = '99999999-9999-9999-9999-999999999999'
const SEG = '22222222-2222-2222-2222-222222222222'
const TAG = '33333333-3333-3333-3333-333333333333'
const ANA = '44444444-4444-4444-4444-444444444444'

function cap(key: string): Capability {
  const c = CONTACT_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta la capacidad ${key}`)
  return c
}

// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>

interface Escrituras {
  actualizados: Array<{ tabla: string; valores: Fila; filtros: Record<string, unknown> }>
  borrados: Array<{ tabla: string; filtros: Record<string, unknown> }>
  insertados: Array<{ tabla: string; valores: Fila }>
}

/**
 * Compara una fila contra los filtros que se fueron encadenando.
 *
 * Entiende las dos formas raras que usa el código real: `step_config->>tag_id`
 * (un campo adentro del jsonb) y `automations.workspace_id` (una columna de la
 * tabla embebida). Sin eso no se podría probar que el recorte por cuenta viaja
 * también en las consultas con join, que es justo donde se olvida.
 */
function coincide(fila: Fila, filtros: Record<string, unknown>): boolean {
  return Object.entries(filtros).every(([columna, valor]) => {
    let actual: unknown
    if (columna.includes('->>')) {
      const [base, campo] = columna.split('->>')
      actual = (fila[base] as Fila | undefined)?.[campo]
      return String(actual ?? '') === String(valor)
    } else if (columna.includes('.')) {
      const [rel, campo] = columna.split('.')
      const emb = fila[rel]
      actual = (Array.isArray(emb) ? emb[0] : (emb as Fila | undefined))?.[campo]
    } else {
      actual = fila[columna]
    }
    if (valor === null) return actual == null
    if (Array.isArray(valor)) return valor.includes(actual)
    return actual === valor
  })
}

function fakeDb(tablas: Record<string, Fila[]>, escrituras: Escrituras): SupabaseClient {
  let secuencia = 0
  const api = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {}
      let head = false
      let modo: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let valores: Fila = {}
      let insertada: Fila | null = null

      const filas = () => (tablas[tabla] ?? []).filter((f) => coincide(f, filtros))
      const resultado = () => {
        if (modo === 'update') {
          escrituras.actualizados.push({ tabla, valores, filtros: { ...filtros } })
          for (const f of filas()) Object.assign(f, valores)
          return { data: null, error: null, count: null }
        }
        if (modo === 'delete') {
          escrituras.borrados.push({ tabla, filtros: { ...filtros } })
          tablas[tabla] = (tablas[tabla] ?? []).filter((f) => !coincide(f, filtros))
          return { data: null, error: null, count: null }
        }
        if (modo === 'insert') return { data: [insertada], error: null, count: 1 }
        const data = filas()
        return { data: head ? null : data, error: null, count: data.length }
      }

      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select(_cols?: unknown, opts?: { head?: boolean }) {
          if (opts?.head) head = true
          return chain
        },
        eq(columna: string, valor: unknown) {
          filtros[columna] = valor
          return chain
        },
        is(columna: string, valor: unknown) {
          filtros[columna] = valor
          return chain
        },
        in(columna: string, valores2: unknown[]) {
          filtros[columna] = valores2
          return chain
        },
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        range: () => chain,
        insert(v: Fila) {
          modo = 'insert'
          insertada = { id: `nueva-${++secuencia}`, ...v }
          tablas[tabla] = [...(tablas[tabla] ?? []), insertada]
          escrituras.insertados.push({ tabla, valores: insertada })
          return chain
        },
        update(v: Fila) {
          modo = 'update'
          valores = v
          return chain
        },
        delete() {
          modo = 'delete'
          return chain
        },
        maybeSingle: async () => {
          const r = resultado()
          const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
          return { data, error: null }
        },
        single: async () => {
          const r = resultado()
          const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
          return { data, error: null }
        },
        // La cadena de supabase-js se resuelve con await sin método terminal.
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(resultado()).then(ok, err),
      })
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------

let tablas: Record<string, Fila[]>
let escrituras: Escrituras

beforeEach(() => {
  escrituras = { actualizados: [], borrados: [], insertados: [] }
  tablas = {
    tags: [{ id: TAG, workspace_id: WS, name: 'comprador', color: '#10b981' }],
    contact_segments: [
      {
        id: SEG,
        workspace_id: WS,
        name: 'Compradores fieles',
        description: null,
        match_mode: 'any',
        rules: [
          { type: 'tag', op: 'has', tagId: TAG },
          { type: 'orders', op: 'gte', value: 2 },
        ],
      },
    ],
    contacts: [
      {
        id: ANA,
        workspace_id: WS,
        name: 'Ana Pérez',
        phone: '+5491133334444',
        email: 'ana@example.com',
        company: null,
        channel: 'whatsapp',
        created_at: '2026-01-02T00:00:00Z',
        opted_out: true,
        opted_out_reason: 'pidió la baja',
        last_inbound_at: '2026-08-01T00:00:00Z',
        last_product: 'Serum',
        last_offer_chosen: '2 unidades',
        is_shopify_customer: true,
        shopify_customer_data: {
          orders_count: 3,
          total_spent: 120000,
          currency: 'ARS',
          default_address: { city: 'Rosario', country: 'Argentina' },
        },
      },
    ],
    contact_tags: [{ contact_id: ANA, tag_id: TAG, tags: { name: 'comprador' } }],
    automation_steps: [
      {
        step_config: { tag_id: TAG },
        automations: {
          id: 'a1',
          name: 'Carrito abandonado',
          workspace_id: WS,
          deleted_at: null,
        },
      },
    ],
    automations: [
      {
        id: 'a2',
        name: 'Bienvenida',
        workspace_id: WS,
        deleted_at: null,
        trigger_config: { tag_id: TAG },
      },
    ],
  }
})

function ctx(workspaceId = WS): CapabilityContext {
  return {
    db: fakeDb(tablas, escrituras),
    workspaceId,
    actor: { type: 'operator', id: 'u1' },
  }
}

// ---------------------------------------------------------------------------

describe('segmentos.reglas', () => {
  it('devuelve los criterios, no cuántos son, y la etiqueta por su nombre', async () => {
    const r = (await cap('segmentos.reglas').run(ctx(), { segmento_id: SEG })) as {
      nombre: string
      modo: string
      reglas: Array<Record<string, unknown>>
    }
    expect(r.nombre).toBe('Compradores fieles')
    expect(r.modo).toBe('any')
    expect(r.reglas).toEqual([
      { type: 'tag', op: 'has', tag: 'comprador' },
      { type: 'orders', op: 'gte', value: 2 },
    ])
    // El uuid no vuelve: sale en la misma forma que acepta `segmentos.editar`.
    expect(r.reglas[0]).not.toHaveProperty('tagId')
  })

  it('si la etiqueta ya no existe, no le inventa un nombre', async () => {
    ;(tablas.contact_segments[0].rules as Fila[])[0] = {
      type: 'tag',
      op: 'has',
      tagId: 'fantasma',
    }
    const r = (await cap('segmentos.reglas').run(ctx(), { segmento_id: SEG })) as {
      reglas: Array<Record<string, unknown>>
    }
    expect(r.reglas[0]).toEqual({ type: 'tag', op: 'has', tagId: 'fantasma', tag: null })
  })

  it('un segmento de otra cuenta no existe', async () => {
    await expect(
      cap('segmentos.reglas').run(ctx(OTRA), { segmento_id: SEG }),
    ).rejects.toThrow(/no existe en esta cuenta/)
  })
})

describe('segmentos.editar', () => {
  const nuevas = [{ type: 'tag', op: 'has', tag: 'Comprador' }]

  it('guarda ids de etiqueta y no el nombre que escribió el modelo', async () => {
    await cap('segmentos.editar').run(ctx(), { segmento_id: SEG, reglas: nuevas })
    const guardadas = escrituras.actualizados[0].valores.rules as Fila[]
    expect(guardadas).toEqual([{ type: 'tag', op: 'has', tagId: TAG }])
  })

  it('sin modo deja el que tenía', async () => {
    await cap('segmentos.editar').run(ctx(), { segmento_id: SEG, reglas: nuevas })
    expect(escrituras.actualizados[0].valores.match_mode).toBe('any')
  })

  it('con modo explícito lo cambia', async () => {
    await cap('segmentos.editar').run(ctx(), {
      segmento_id: SEG,
      reglas: nuevas,
      modo: 'all',
    })
    expect(escrituras.actualizados[0].valores.match_mode).toBe('all')
  })

  it('un criterio desconocido corta antes de escribir', async () => {
    await expect(
      cap('segmentos.editar').run(ctx(), {
        segmento_id: SEG,
        reglas: [{ type: 'astrologia', signo: 'piscis' }],
      }),
    ).rejects.toThrow(/No entiendo estos criterios/)
    expect(escrituras.actualizados).toHaveLength(0)
  })

  it('una etiqueta que no existe se dice, no se crea', async () => {
    await expect(
      cap('segmentos.editar').run(ctx(), {
        segmento_id: SEG,
        reglas: [{ type: 'tag', op: 'has', tag: 'comrador' }],
      }),
    ).rejects.toThrow(/No existe la etiqueta "comrador"/)
    expect(escrituras.actualizados).toHaveLength(0)
  })

  it('el update lleva la cuenta puesta', async () => {
    await cap('segmentos.editar').run(ctx(), { segmento_id: SEG, reglas: nuevas })
    expect(escrituras.actualizados[0].filtros).toMatchObject({
      id: SEG,
      workspace_id: WS,
    })
  })

  it('el segmento de otra cuenta no se puede editar', async () => {
    await expect(
      cap('segmentos.editar').run(ctx(OTRA), { segmento_id: SEG, reglas: nuevas }),
    ).rejects.toThrow(/no existe en esta cuenta/)
    expect(escrituras.actualizados).toHaveLength(0)
  })

  it('el preview dice cuántos criterios quedan y a cuánta gente alcanza', async () => {
    const texto = await cap('segmentos.editar').preview!(ctx(), {
      segmento_id: SEG,
      reglas: nuevas,
    })
    expect(texto).toContain('Compradores fieles')
    expect(texto).toContain('1 criterio')
    expect(texto).toContain('tenía 2')
    expect(texto).toContain('3 contactos')
  })
})

describe('el dibujo del cambio', () => {
  const args = {
    segmento_id: SEG,
    reglas: [
      // La misma etiqueta con otra mayúscula: es la misma regla, no un cambio.
      { type: 'tag', op: 'has', tag: 'Comprador' },
      { type: 'location', field: 'country', op: 'is', value: 'Argentina' },
    ],
  }

  it('marca lo que se agregó y lo que se fue', async () => {
    const c = ctx()
    const previo = await cap('segmentos.editar').artifactBefore!(c, args)
    const nuevo = cap('segmentos.editar').artifact!(c, args, {
      nombre: 'Compradores fieles',
      alcance: 3,
    })
    const dibujo = conDiff(previo, nuevo!)
    if (dibujo.kind !== 'segmento') throw new Error('tipo inesperado')
    expect(dibujo.reglas.map((r) => [r.campo, r.cambio])).toEqual([
      ['etiqueta', 'igual'],
      ['país', 'nuevo'],
      ['pedidos', 'quitado'],
    ])
    expect(dibujo.alcance).toBe(3)
    expect(dibujo.base).toEqual({ id: SEG, nombre: 'Compradores fieles' })
  })

  it('la tarjeta de una propuesta ya sabe de qué segmento habla', async () => {
    const c = ctx()
    // Es el orden real: el preview lee la fila antes de que se dibuje nada.
    await cap('segmentos.editar').preview!(c, args)
    const dibujo = cap('segmentos.editar').artifact!(c, args)
    expect(dibujo?.kind === 'segmento' && dibujo.nombre).toBe('Compradores fieles')
  })
})

describe('contactos.detalle', () => {
  it('trae la ficha con sus etiquetas', async () => {
    const r = (await cap('contactos.detalle').run(ctx(), { contacto_id: ANA })) as Fila
    expect(r).toMatchObject({
      nombre: 'Ana Pérez',
      etiquetas: ['comprador'],
      dado_de_baja: true,
      pedidos: 3,
      ciudad: 'Rosario',
      pais: 'Argentina',
    })
  })

  it('un contacto de otra cuenta no existe', async () => {
    await expect(
      cap('contactos.detalle').run(ctx(OTRA), { contacto_id: ANA }),
    ).rejects.toThrow(/no existe en esta cuenta/)
  })
})

describe('etiquetas.crear', () => {
  it('no duplica la que ya existe', async () => {
    const r = (await cap('etiquetas.crear').run(ctx(), { nombre: 'comprador' })) as {
      id: string
      ya_existia: boolean
    }
    expect(r.ya_existia).toBe(true)
    expect(r.id).toBe(TAG)
    expect(tablas.tags).toHaveLength(1)
  })

  it('crea la que falta', async () => {
    const r = (await cap('etiquetas.crear').run(ctx(), {
      nombre: 'vip',
      color: '#10b981',
    })) as { ya_existia: boolean }
    expect(r.ya_existia).toBe(false)
    expect(tablas.tags).toHaveLength(2)
    expect(escrituras.insertados[0].valores).toMatchObject({
      workspace_id: WS,
      name: 'vip',
      color: '#10b981',
    })
  })

  it('un color que no es hexadecimal se rechaza', async () => {
    await expect(
      cap('etiquetas.crear').run(ctx(), { nombre: 'vip', color: 'verde' }),
    ).rejects.toThrow(/hexadecimal/)
  })
})

describe('etiquetas.borrar', () => {
  it('el preview dice a cuánta gente se la saca y quién la usa', async () => {
    const texto = await cap('etiquetas.borrar').preview!(ctx(), { etiqueta: 'comprador' })
    expect(texto).toContain('1 contacto')
    expect(texto).toContain('Carrito abandonado')
    expect(texto).toContain('Bienvenida')
    expect(texto).toContain('Compradores fieles')
    expect(texto).toContain('No se puede deshacer')
  })

  it('el preview no borra nada', async () => {
    await cap('etiquetas.borrar').preview!(ctx(), { etiqueta: 'comprador' })
    expect(escrituras.borrados).toHaveLength(0)
    expect(tablas.tags).toHaveLength(1)
  })

  it('borra dentro de la cuenta y cuenta el daño', async () => {
    const r = (await cap('etiquetas.borrar').run(ctx(), { etiqueta: 'Comprador' })) as {
      contactos_afectados: number
      automatizaciones_afectadas: string[]
      segmentos_afectados: string[]
    }
    expect(escrituras.borrados[0]).toMatchObject({
      tabla: 'tags',
      filtros: { id: TAG, workspace_id: WS },
    })
    expect(r.contactos_afectados).toBe(1)
    expect(r.automatizaciones_afectadas).toEqual(['Carrito abandonado', 'Bienvenida'])
    expect(r.segmentos_afectados).toEqual(['Compradores fieles'])
    expect(tablas.tags).toHaveLength(0)
  })

  it('la etiqueta de otra cuenta no aparece', async () => {
    await expect(
      cap('etiquetas.borrar').run(ctx(OTRA), { etiqueta: 'comprador' }),
    ).rejects.toThrow(/No existe la etiqueta/)
    expect(escrituras.borrados).toHaveLength(0)
  })
})

describe('el contrato del dominio', () => {
  it('ninguna capacidad pide la cuenta como argumento', () => {
    for (const c of CONTACT_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
    }
  })

  it('toda irreversible trae preview', () => {
    for (const c of CONTACT_CAPABILITIES.filter((x) => x.risk === 'irreversible')) {
      expect(typeof c.preview, c.key).toBe('function')
    }
  })
})

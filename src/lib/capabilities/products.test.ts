import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { armarParche, validarFaqs } from '@/lib/products/write'
import { PRODUCT_CAPABILITIES } from './products'
import type { AnyCapability, CapabilityContext } from './types'

/**
 * Lo que se prueba acá es una sola cosa: que editar un producto desde el chat
 * deje la cuenta EXACTAMENTE como la deja el editor.
 *
 * El riesgo no es un UPDATE mal escrito sino lo que lo rodea. `training_material`
 * es el texto que el agente recibe literal en su prompt: si se guarda la
 * descripción nueva y el material queda con la vieja, no falla nada, no se rompe
 * ninguna pantalla, y el agente le sigue citando a los clientes lo anterior
 * hasta que alguien lea una conversación. Por eso el caso central es que el
 * material recompilado contenga lo recién escrito.
 */

const WS = '11111111-1111-1111-1111-111111111111'
const OTRO_WS = '22222222-2222-2222-2222-222222222222'
const SERUM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CREMA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const AJENO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

type Fila = Record<string, unknown>

/** Lo que quedó escrito, que es lo que se revisa. */
interface Registro {
  updates: Array<{ filtros: Fila; payload: Fila }>
}

/**
 * Supabase de mentira, con la semántica mínima que usan estas capacidades:
 * filtros por igualdad, ilike sobre el título, límite y update.
 */
function fakeDb(filas: Fila[], registro: Registro): SupabaseClient {
  const from = (table: string) => {
    if (table !== 'shopify_products') throw new Error(`tabla inesperada: ${table}`)

    const filtros: Record<string, unknown> = {}
    let patron: [string, string] | null = null
    let limite: number | undefined
    let verbo: 'select' | 'update' = 'select'
    let payload: Fila = {}

    const filtrar = (): Fila[] => {
      let out = filas.filter((f) =>
        Object.entries(filtros).every(([col, val]) => f[col] === val),
      )
      const p = patron
      if (p) {
        const texto = p[1].replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase()
        out = out.filter((f) =>
          String(f[p[0]] ?? '')
            .toLowerCase()
            .includes(texto),
        )
      }
      return limite == null ? out : out.slice(0, limite)
    }

    const resolver = () => {
      const tocadas = filtrar()
      if (verbo === 'update') {
        registro.updates.push({ filtros: { ...filtros }, payload })
        for (const f of tocadas) Object.assign(f, payload)
      }
      return { data: tocadas, error: null }
    }

    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: () => chain,
      update: (p: Fila) => {
        verbo = 'update'
        payload = p
        return chain
      },
      eq: (col: string, val: unknown) => {
        filtros[col] = val
        return chain
      },
      ilike: (col: string, pat: string) => {
        patron = [col, pat]
        return chain
      },
      order: () => chain,
      limit: (n: number) => {
        limite = n
        return chain
      },
      maybeSingle: async () => ({ data: resolver().data[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(ok, bad),
    })
    return chain
  }
  return { from } as unknown as SupabaseClient
}

function catalogo(): Fila[] {
  return [
    {
      id: SERUM,
      workspace_id: WS,
      shop_domain: 'manual',
      external_id: -1234567,
      handle: 'serum-pilar-abc123',
      title: 'Sérum facial',
      description: 'La descripción vieja',
      custom_notes: null,
      custom_faqs: [{ q: '¿Cuánto tarda?', a: '3 días' }],
      ai_generated_faqs: [{ q: '¿Tiene alcohol?', a: 'No' }],
      price_min: 39900,
      price_max: 89900,
      currency: 'ARS',
      training_material: '# Sérum facial\n\n## Descripción\nLa descripción vieja',
    },
    {
      id: CREMA,
      workspace_id: WS,
      shop_domain: 'pilar.myshopify.com',
      external_id: 987654,
      handle: 'crema-facial',
      title: 'Crema facial',
      description: null,
      custom_notes: null,
      custom_faqs: null,
      ai_generated_faqs: null,
      training_material: null,
    },
    {
      id: AJENO,
      workspace_id: OTRO_WS,
      shop_domain: 'manual',
      external_id: -555,
      handle: 'secreto',
      title: 'Producto de otra cuenta',
      training_material: 'material ajeno',
    },
  ]
}

function cap(key: string): AnyCapability {
  const c = PRODUCT_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta la capacidad ${key}`)
  return c as AnyCapability
}

let filas: Fila[]
let registro: Registro
let ctx: CapabilityContext

beforeEach(() => {
  filas = catalogo()
  registro = { updates: [] }
  ctx = {
    db: fakeDb(filas, registro),
    workspaceId: WS,
    actor: { type: 'operator', id: 'u1' },
    locale: 'es',
  }
})

// ---------------------------------------------------------------------------

describe('productos.listar', () => {
  it('dice si el producto tiene material sin devolver el material', async () => {
    // Son miles de caracteres por producto: mandarlos para elegir uno llenaría
    // la ventana del modelo con el prompt entero del catálogo.
    const r = (await cap('productos.listar').run(ctx, {})) as {
      productos: Array<Record<string, unknown>>
    }
    const serum = r.productos.find((p) => p.id === SERUM)!
    expect(serum.tiene_material).toBe(true)
    expect(serum).not.toHaveProperty('material')
    expect(r.productos.find((p) => p.id === CREMA)!.tiene_material).toBe(false)
  })

  it('cuenta las preguntas frecuentes propias y las de la investigación', async () => {
    const r = (await cap('productos.listar').run(ctx, {})) as {
      productos: Array<Record<string, unknown>>
    }
    expect(r.productos.find((p) => p.id === SERUM)!.preguntas_frecuentes).toBe(2)
  })

  it('nunca sale de la cuenta', async () => {
    const r = (await cap('productos.listar').run(ctx, {})) as {
      productos: Array<{ id: string }>
    }
    expect(r.productos.map((p) => p.id).sort()).toEqual([SERUM, CREMA].sort())
  })
})

describe('productos.detalle', () => {
  it('encuentra el producto por parte del nombre', async () => {
    const r = (await cap('productos.detalle').run(ctx, { producto: 'sérum' })) as {
      id: string
      material: string
    }
    expect(r.id).toBe(SERUM)
    expect(r.material).toContain('La descripción vieja')
  })

  it('separa las preguntas propias de las de la investigación', async () => {
    // Mezcladas, el modelo reescribiría como propias unas que la próxima
    // investigación va a pisar.
    const r = (await cap('productos.detalle').run(ctx, { producto: SERUM })) as {
      preguntas_frecuentes: unknown[]
      preguntas_frecuentes_de_la_investigacion: unknown[]
    }
    expect(r.preguntas_frecuentes).toHaveLength(1)
    expect(r.preguntas_frecuentes_de_la_investigacion).toHaveLength(1)
  })

  it('si el nombre coincide con varios, corta y los muestra', async () => {
    await expect(cap('productos.detalle').run(ctx, { producto: 'facial' })).rejects.toThrow(
      /coincide con varios/,
    )
  })

  it('un id de otra cuenta no existe', async () => {
    await expect(cap('productos.detalle').run(ctx, { producto: AJENO })).rejects.toThrow(
      /no existe en esta cuenta/,
    )
  })
})

describe('productos.editar', () => {
  it('recompila el material con lo recién escrito', async () => {
    await cap('productos.editar').run(ctx, {
      producto: SERUM,
      descripcion: 'Sérum con niacinamida al 10%',
    })
    const material = registro.updates[0].payload.training_material as string
    expect(material).toContain('Sérum con niacinamida al 10%')
    expect(material).not.toContain('La descripción vieja')
  })

  it('las preguntas llegan en castellano y se guardan como {q, a}', async () => {
    await cap('productos.editar').run(ctx, {
      producto: 'sérum',
      preguntas_frecuentes: [{ pregunta: '¿Es vegano?', respuesta: 'Sí' }],
    })
    expect(registro.updates[0].payload.custom_faqs).toEqual([{ q: '¿Es vegano?', a: 'Sí' }])
    // Y el material recompilado ya la trae: es lo que el agente va a citar.
    expect(registro.updates[0].payload.training_material).toContain('¿Es vegano?')
  })

  it('no toca lo que no se mandó', async () => {
    await cap('productos.editar').run(ctx, { producto: SERUM, notas: 'Envío en 24h' })
    const payload = registro.updates[0].payload
    expect(payload).not.toHaveProperty('description')
    expect(payload).not.toHaveProperty('custom_faqs')
    expect(payload.custom_notes).toBe('Envío en 24h')
  })

  it('recorta por cuenta al leer, aunque el cliente sea de servicio', async () => {
    // La capacidad corre con llave de servicio: sin el filtro explícito, un id
    // de otra cuenta se editaría igual.
    await expect(
      cap('productos.editar').run(ctx, { producto: AJENO, notas: 'hola' }),
    ).rejects.toThrow(/no existe en esta cuenta/)
    expect(registro.updates).toHaveLength(0)
  })

  it('una pregunta sin respuesta no llega a la base', async () => {
    await expect(
      cap('productos.editar').run(ctx, {
        producto: SERUM,
        preguntas_frecuentes: [{ pregunta: '¿Es vegano?' }],
      }),
    ).rejects.toThrow(/pregunta o la respuesta/)
    expect(registro.updates).toHaveLength(0)
  })

  it('sin ningún campo no escribe nada', async () => {
    await expect(cap('productos.editar').run(ctx, { producto: SERUM })).rejects.toThrow(
      /nada para cambiar/,
    )
    expect(registro.updates).toHaveLength(0)
  })

  it('el preview dice qué pisa y qué agrega', async () => {
    const p = await cap('productos.editar').preview!(ctx, {
      producto: SERUM,
      descripcion: 'otra',
      notas: 'nuevas',
      preguntas_frecuentes: [{ pregunta: 'a', respuesta: 'b' }],
    })
    expect(p).toContain('Sérum facial')
    expect(p).toContain('reemplazaría la descripción')
    expect(p).toContain('agregaría notas')
    expect(p).toContain('1 preguntas frecuentes (hoy hay 1)')
  })

  it('el schema queda acotado a lo que alimenta al agente', () => {
    // Precios, ofertas, fotos y fuentes se editan a mano: exponerlas acá deja
    // que una sola llamada mueva lo que cotiza el agente (allowed_offers deriva
    // price_min/price_max).
    expect(Object.keys(cap('productos.editar').schema.properties).sort()).toEqual([
      'descripcion',
      'notas',
      'preguntas_frecuentes',
      'producto',
    ])
  })
})

// ---------------------------------------------------------------------------

describe('el parche compartido con el editor', () => {
  it('lo ausente no viaja y lo nulo vacía', () => {
    expect(armarParche({ custom_notes: null })).toEqual({ custom_notes: null })
    expect(armarParche({})).toEqual({})
  })

  it('las ofertas derivan el precio y marcan la fila como del comercio', () => {
    const patch = armarParche({
      allowed_offers: [
        { label: '1 unidad', total: '39.900', units: 1 },
        { label: '3 unidades', total: 89900, units: 3 },
      ],
    })
    expect(patch.price_min).toBe(39.9)
    expect(patch.price_max).toBe(89900)
    expect(patch.offers_auto_detected).toBe(false)
  })

  it('la primera imagen y la primera fuente se espejan', () => {
    const patch = armarParche({ images: [' a.jpg ', ''], websites: ['https://x.com'] })
    expect(patch.images).toEqual(['a.jpg'])
    expect(patch.image_url).toBe('a.jpg')
    expect(patch.url).toBe('https://x.com')
  })
})

describe('validarFaqs', () => {
  it('distingue "no es lista" de "mal formada"', () => {
    expect(validarFaqs('nada')).toBe('faqs_no_es_lista')
    expect(validarFaqs([{ q: 'a' }])).toBe('faq_mal_formada')
    expect(validarFaqs([{ q: 'a', a: 'b' }])).toBeNull()
  })
})

describe('invariantes del dominio', () => {
  it('ninguna pide la cuenta como argumento', () => {
    for (const c of PRODUCT_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
    }
  })

  it('toda irreversible trae preview', () => {
    for (const c of PRODUCT_CAPABILITIES.filter((x) => x.risk === 'irreversible')) {
      expect(typeof c.preview, c.key).toBe('function')
    }
  })

  it('ninguna se declara inerte: editar sale por WhatsApp en la próxima respuesta', () => {
    // Lo que se escribe acá lo repite el agente ante un cliente. No hay nada
    // que quede apagado esperando que alguien lo prenda.
    for (const c of PRODUCT_CAPABILITIES.filter((x) => x.risk !== 'lectura')) {
      expect(c.inerte, c.key).toBeUndefined()
    }
  })
})

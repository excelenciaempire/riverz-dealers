import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { searchProducts } from './search'

/**
 * Buscar en el catálogo, con las mismas dos reglas que el resto.
 *
 * `buscar_producto` es la herramienta que el agente usa más —su descripción le
 * dice "úsala SIEMPRE"— y era la que menos respetaba lo que el comercio
 * configuró: buscaba en el catálogo entero aunque el agente tuviera "Productos
 * asignados", y devolvía las cuatro filas del serum de Pilar con cuatro precios
 * distintos, así que el agente contestaba que "cuesta entre 39.990 y 105.000".
 * Eso no es un precio.
 */

const SHOP = {
  id: 'shop',
  title: 'Serum Pilar',
  handle: 'serum-pilar',
  url: null,
  image_url: null,
  price_min: 39990,
  price_max: 39990,
  currency: 'COP',
  tags: [],
  description: 'Serum reafirmante',
  raw: null,
  master_id: null,
  platform: 'shopify',
}
const ML = (n: number, precio: number) => ({
  ...SHOP,
  id: `ml${n}`,
  title: `Pilar Serum Reafirmante Antiedad Regeneracion 30 Ml X${n}`,
  price_min: precio,
  price_max: precio,
  master_id: 'shop',
  platform: 'mercadolibre',
})
const BICI = { ...SHOP, id: 'bici', title: 'Bicicleta Mountain Bike', master_id: null, platform: 'mercadolibre' }

const CATALOGO = [SHOP, ML(1, 45000), ML(2, 75000), ML(3, 105000), BICI]

/** Una base que filtra en memoria lo que la consulta habría filtrado. */
function baseCon(filas: typeof CATALOGO) {
  const vistos: { acotado: string[] | null } = { acotado: null }
  const db = {
    from: () => {
      let texto = ''
      let palabras: string[] = []
      let soloEstos: string[] | null = null
      let porTags = false
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        or: (f: string) => {
          const ramas = [...f.matchAll(/title\.ilike\.%([^%]*)%/g)].map((m) => m[1].toLowerCase())
          // La consulta por palabra suelta manda VARIAS ramas de título; la de
          // la frase manda una sola (más la de descripción).
          if (ramas.length > 1) palabras = ramas
          else texto = ramas[0] ?? ''
          return q
        },
        overlaps: () => {
          porTags = true
          return q
        },
        in: (_c: string, ids: string[]) => {
          soloEstos = ids
          vistos.acotado = ids
          return q
        },
        then: (resolve: (v: unknown) => unknown) => {
          let out = filas
          if (soloEstos) out = out.filter((f) => soloEstos!.includes(f.id))
          // `palabras` sólo está cuando la consulta pidió por palabra suelta;
          // si no, manda la frase entera, que es lo que exige el mismo orden.
          if (!porTags && palabras.length)
            out = out.filter((f) => palabras.some((w) => f.title.toLowerCase().includes(w)))
          else if (!porTags && texto)
            out = out.filter((f) => f.title.toLowerCase().includes(texto))
          if (porTags) out = []
          return resolve({ data: out, error: null })
        },
      }
      return q
    },
  }
  return { db: db as never, vistos }
}

describe('buscar_producto', () => {
  it('devuelve el serum UNA vez, con el precio de cada canal', async () => {
    const hits = await searchProducts(baseCon(CATALOGO).db, {
      workspaceId: 'w1',
      query: 'serum',
      agrupar: true,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('shop')
    expect(hits[0].listings?.map((l) => l.price)).toEqual([39990, 45000, 75000, 105000])
  })

  it('las unidades de cada publicación viajan con el precio', async () => {
    // Sin esto el agente ve 45.000, 75.000 y 105.000 del mismo producto y no
    // tiene forma de saber que el segundo son dos frascos.
    const [uno] = await searchProducts(baseCon(CATALOGO).db, {
      workspaceId: 'w1',
      query: 'serum',
      agrupar: true,
    })
    expect(uno.listings?.map((l) => l.units)).toEqual([1, 1, 2, 3])
  })

  it('lo encuentra por el nombre del marketplace, que es como lo escribe la gente', async () => {
    // Al plegar queda el título de la tienda ("Serum Pilar"), pero la clienta
    // escribe el del marketplace. Puntuar sólo por el primero dejaba el
    // producto afuera de su propia búsqueda.
    const hits = await searchProducts(baseCon(CATALOGO).db, {
      workspaceId: 'w1',
      query: 'reafirmante antiedad',
      agrupar: true,
    })
    expect(hits[0]?.id).toBe('shop')
  })

  it('lo encuentra con las palabras en otro orden', async () => {
    // La clienta escribe "serum antiedad x2" y el marketplace lo tituló
    // "Serum 30 Ml X2 Antiedad": la frase entera exige el mismo orden, así que
    // a una pregunta legítima le contestaba "no lo tenemos".
    const hits = await searchProducts(baseCon(CATALOGO).db, {
      workspaceId: 'w1',
      query: 'serum antiedad x2',
      agrupar: true,
    })
    expect(hits[0]?.id).toBe('shop')
  })

  it('no ofrece cualquier cosa por una palabra suelta', async () => {
    // Ampliar la red por palabra traía cualquier título con "para" adentro.
    // Ofrecerle a alguien un producto que no tiene nada que ver es peor que
    // decirle que no hay.
    const hits = await searchProducts(baseCon(CATALOGO).db, {
      workspaceId: 'w1',
      query: 'algo para gatos',
      agrupar: true,
    })
    expect(hits).toHaveLength(0)
  })

  it('un agente con productos asignados no busca fuera de ellos', async () => {
    const { db, vistos } = baseCon(CATALOGO)
    const hits = await searchProducts(db, {
      workspaceId: 'w1',
      query: 'bicicleta',
      permitidos: new Set(['shop', 'ml1', 'ml2', 'ml3']),
      agrupar: true,
    })
    expect(hits).toHaveLength(0)
    // Y el recorte lo hace la consulta, no sólo la memoria: pedir el catálogo
    // entero para tirarlo después desperdicia el límite.
    expect(vistos.acotado).toContain('shop')
  })

  it('alcance específico y nada asignado: no hay catálogo', async () => {
    // Un `Set` vacío se leía como "sin restricción" y el agente buscaba en
    // todo, que es exactamente lo contrario de lo que dice la configuración.
    const { db, vistos } = baseCon(CATALOGO)
    expect(
      await searchProducts(db, { workspaceId: 'w1', query: 'serum', permitidos: new Set() }),
    ).toEqual([])
    expect(vistos.acotado).toBeNull()
  })

  it('sin agrupar sigue devolviendo la fila exacta', async () => {
    // Lo usa la verificación de precios de un cobro: ahí importa la fila que se
    // está cotizando, no la principal del grupo.
    const hits = await searchProducts(baseCon(CATALOGO).db, {
      workspaceId: 'w1',
      query: 'serum',
    })
    expect(hits.length).toBeGreaterThan(1)
  })
})

describe('el catálogo del agente sale de un solo lugar', () => {
  it('ver_producto usa la misma búsqueda que buscar_producto', () => {
    const bandeja = readFileSync('src/lib/ai/bandeja.ts', 'utf8')
    // Las dos reglas, explícitas: si alguna se cae, `ver_producto` vuelve a
    // poder nombrar un producto que este agente no tiene asignado.
    expect(bandeja).toContain('permitidos: ctx.permitidos')
    expect(bandeja).toContain('agrupar: true')
  })
})

describe('las otras superficies que leen el catálogo', () => {
  const leer = (p: string) => readFileSync(p, 'utf8')

  it('el panel de Probar arma el catálogo con el mismo cargador que producción', () => {
    // Su propio comentario prometía "las mismas reglas de alcance que
    // producción" y no las tenía: mostraba cuatro publicaciones del mismo
    // producto. Un panel de prueba que no se parece a producción no prueba.
    //
    // Lo que se fija es que use el CARGADOR compartido, no que repita su
    // contenido: antes esto exigía ver `unificarFilas` y `master_id` en la ruta,
    // y cuando esa lógica se mudó a `loadProductCatalog` —donde corresponde— el
    // test se puso rojo aunque el panel había quedado más parecido a producción,
    // no menos.
    //
    // La ruta delega en `lib/ai/simulacion`, que comparte con "Probar como
    // cliente": es ahí donde tiene que estar el cargador.
    const ruta = leer('src/app/api/ai/agents/[id]/test/route.ts')
    expect(ruta).toContain('simularRespuesta')
    const simulacion = leer('src/lib/ai/simulacion.ts')
    expect(simulacion).toContain('loadProductCatalog')
    expect(simulacion).toContain('productosPermitidos')
    // Y que el cargador compartido siga plegando por producto principal.
    const runner = leer('src/lib/ai/runner.ts')
    expect(runner).toMatch(/loadProductCatalog[\s\S]*?unificarFilas/)
    expect(runner).toContain('master_id')
  })

  it('el Operador lista productos agrupados', () => {
    const cap = leer('src/lib/capabilities/products.ts')
    expect(cap).toContain('agruparPorPrincipal')
  })

  it('los enlaces que ofrece el DM de Instagram: uno por producto', () => {
    // Son cuatro lugares. Sin plegar, el serum se los llevaba los cuatro con
    // sus publicaciones de Mercado Libre y el resto del catálogo se quedaba sin
    // ninguno — y el enlace podía ser el del marketplace en vez del de la
    // tienda del comercio.
    const links = leer('src/lib/instagram-agent/store-links.ts')
    expect(links).toContain('agruparPorPrincipal')
    expect(links).toContain('master_id')
  })

  it('el cerebro de producto de Instagram también', () => {
    // Sin plegar, "el serum" caía en la publicación del marketplace —la que
    // tiene el título parecido y el material vacío— y el mensaje proactivo
    // salía sin nada del conocimiento que ese archivo existe para llevar.
    const brain = leer('src/lib/instagram-agent/product-brain.ts')
    expect(brain).toContain('agruparPorPrincipal')
    expect(brain).toContain('master_id')
  })
})

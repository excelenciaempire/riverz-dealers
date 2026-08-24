import { describe, it, expect } from 'vitest'
import { agruparPorPrincipal, idsDelGrupo, expandirGrupos } from './agrupar'

/**
 * Un producto vendido en varios lados se lista UNA vez, en las DOS pantallas.
 *
 * El caso real: el serum de Pilar tiene cuatro filas —la de la tienda y tres
 * publicaciones de Mercado Libre—. La lista de Productos ya las plegaba, pero
 * el selector de productos del agente tenía su propia consulta, que ni siquiera
 * pedía `master_id`: ahí seguían saliendo las cuatro. El comercio tenía que
 * asignar cuatro cosas para autorizar una, sin saber que eran la misma.
 */

const SHOP = {
  id: 'shop',
  title: 'Serum Pilar',
  platform: 'shopify',
  price_min: 39990,
  master_id: null,
}
const ML1 = { id: 'ml1', title: 'Serum 30 Ml', platform: 'mercadolibre', price_min: 45000, master_id: 'shop' }
const ML2 = { id: 'ml2', title: 'Serum 30 Ml X2', platform: 'mercadolibre', price_min: 75000, master_id: 'shop' }
const ML3 = { id: 'ml3', title: 'Serum 30 Ml X3', platform: 'mercadolibre', price_min: 105000, master_id: 'shop' }
const BICI = { id: 'bici', title: 'Bicicleta', platform: 'mercadolibre', master_id: null }

describe('agrupar el catálogo', () => {
  it('muestra el serum UNA vez, no cuatro', () => {
    const out = agruparPorPrincipal([SHOP, ML1, ML2, ML3])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('shop')
  })

  it('lleva sus cuatro canales con el precio de cada uno', () => {
    const [uno] = agruparPorPrincipal([SHOP, ML1, ML2, ML3])
    expect(uno.listings).toHaveLength(4)
    expect(uno.listings?.filter((l) => l.is_master)).toHaveLength(1)
    expect(uno.listings?.map((l) => Number(l.price_min)).sort((a, b) => a - b)).toEqual([
      39990, 45000, 75000, 105000,
    ])
  })

  it('lo que no está unificado sigue como estaba', () => {
    const out = agruparPorPrincipal([SHOP, ML1, BICI])
    expect(out.map((p) => p.id).sort()).toEqual(['bici', 'shop'])
  })

  it('un producto solo no lleva la línea de canales', () => {
    const [uno] = agruparPorPrincipal([BICI])
    expect(uno.listings).toBeUndefined()
  })

  it('con un filtro que deja afuera a la principal, la publicación NO desaparece', () => {
    // Buscar "x2" trae la publicación y no su principal. Plegarla contra una
    // tarjeta que no está en la respuesta la haría invisible: el comercio
    // buscaría algo que existe y la pantalla le diría que no hay nada.
    const out = agruparPorPrincipal([ML2])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('ml2')
  })
})

describe('asignar un producto es asignarlo entero', () => {
  it('devuelve la principal y todas sus publicaciones', () => {
    const [uno] = agruparPorPrincipal([SHOP, ML1, ML2, ML3])
    expect(idsDelGrupo(uno).sort()).toEqual(['ml1', 'ml2', 'ml3', 'shop'])
  })

  it('un producto sin unificar es sólo él', () => {
    expect(idsDelGrupo({ id: 'bici' })).toEqual(['bici'])
  })
})

/** Una base que contesta con las filas que se le den, y cuenta las consultas. */
function baseCon(filas: Array<{ id: string; master_id: string | null }>) {
  const consultas: Array<{ columna: string; cuantos: number }> = []
  const db = {
    from: () => {
      let columna = 'id'
      let valores: string[] = []
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: (c: string, ids: string[]) => {
          columna = c
          valores = ids
          consultas.push({ columna: c, cuantos: ids.length })
          return q
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data: filas.filter((f) =>
              columna === 'id' ? valores.includes(f.id) : valores.includes(f.master_id ?? ''),
            ),
            error: null,
          }),
      }
      return q
    },
  }
  return { db: db as never, consultas }
}

describe('las asignaciones viejas también siguen al grupo', () => {
  const FILAS = [
    { id: 'shop', master_id: null },
    { id: 'ml1', master_id: 'shop' },
    { id: 'ml2', master_id: 'shop' },
    { id: 'bici', master_id: null },
  ]

  it('asignada la principal, autoriza sus publicaciones', async () => {
    const r = await expandirGrupos(baseCon(FILAS).db, 'w1', ['shop'])
    expect([...r].sort()).toEqual(['ml1', 'ml2', 'shop'])
  })

  it('asignada una publicación suelta, autoriza el producto entero', async () => {
    // Es el caso de quien asignó el producto ANTES de unificarlo: la fila que
    // eligió sigue apuntada, y unir después no cambiaba nada para el agente.
    const r = await expandirGrupos(baseCon(FILAS).db, 'w1', ['ml2'])
    expect([...r].sort()).toEqual(['ml1', 'ml2', 'shop'])
  })

  it('un producto sin unificar queda como estaba', async () => {
    const r = await expandirGrupos(baseCon(FILAS).db, 'w1', ['bici'])
    expect([...r]).toEqual(['bici'])
  })

  it('sin asignaciones no consulta nada', async () => {
    const { db, consultas } = baseCon(FILAS)
    expect([...(await expandirGrupos(db, 'w1', []))]).toEqual([])
    expect(consultas).toHaveLength(0)
  })

  it('con muchos productos pregunta de a cien, no todo junto', async () => {
    // Doscientos UUIDs en una sola URL pasan de lo que aguanta un GET, y la
    // consulta vuelve 414: el agente se quedaría sin catálogo justo cuando
    // tiene el más grande.
    const muchos = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, master_id: null }))
    const { db, consultas } = baseCon(muchos)
    const r = await expandirGrupos(db, 'w1', muchos.map((p) => p.id))
    expect(r.size).toBe(250)
    expect(Math.max(...consultas.map((c) => c.cuantos))).toBeLessThanOrEqual(100)
  })
})

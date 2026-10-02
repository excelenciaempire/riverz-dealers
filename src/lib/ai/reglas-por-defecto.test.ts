import { describe, expect, it, vi } from 'vitest'
import { REGLAS_POR_DEFECTO, sembrarReglasPorDefecto } from './reglas-por-defecto'

it('seeds vehicle, appointment and financing rules on an independent dealer deployment',async()=>{
  vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL','dealers');
  try {
    const f=db([]);await sembrarReglasPorDefecto(f.cliente,'dealer');
    expect(f.escrituras[0]).toHaveLength(4);
    expect(f.escrituras[0].map(r=>(r as {clave:string}).clave)).toEqual(['dealer_inventario','dealer_descubrimiento','dealer_cita','dealer_finanzas']);
  } finally {vi.unstubAllEnvs();}
});

/**
 * Un asistente nacia con CERO reglas.
 *
 * Y las reglas son justo lo que impide que invente: en una semana de
 * produccion, sin ellas, prometio pago contra entrega donde no existe, opino
 * sobre si un cosmetico servia para una condicion de la piel, y repitio como
 * cierta una condicion de venta solo porque la dijo la clienta.
 */

function db(existentes: unknown[]) {
  const escrituras: unknown[][] = []
  return {
    escrituras,
    cliente: {
      from: () => {
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = () => q
        q.limit = async () => ({ data: existentes, error: null })
        q.upsert = async (filas: unknown[]) => {
          escrituras.push(filas)
          return { error: null }
        }
        return q
      },
    } as never,
  }
}

describe('el piso de reglas de un asistente nuevo', () => {
  it('siembra las cuatro cuando la cuenta no tiene ninguna', async () => {
    const { cliente, escrituras } = db([])
    await sembrarReglasPorDefecto(cliente, 'w1')
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0]).toHaveLength(REGLAS_POR_DEFECTO.length)
  })

  it('NO las devuelve a quien ya tiene reglas propias', async () => {
    // Puede haberlas borrado a proposito. Reponerlas cada vez que crea un
    // asistente seria discutirle una decision suya.
    const { cliente, escrituras } = db([{ id: 'r1' }])
    await sembrarReglasPorDefecto(cliente, 'w1')
    expect(escrituras).toHaveLength(0)
  })

  it('cada una tiene clave, para que un segundo asistente no las duplique', () => {
    const claves = REGLAS_POR_DEFECTO.map((r) => r.clave)
    expect(new Set(claves).size).toBe(claves.length)
    for (const c of claves) expect(c.startsWith('base_')).toBe(true)
  })

  it('valen para cualquier comercio: no nombran rubro, producto ni pais', () => {
    // Un piso que hable de cosmetica no es un piso: es la configuracion de
    // otro negocio metida en el tuyo.
    const prohibidas =
      /serum|cosm[eé]tic|piel|anmat|invima|argentin|colombia|dermat[oó]log/i
    for (const r of REGLAS_POR_DEFECTO) {
      const texto = `${r.titulo} ${r.cuando} ${r.hacer}`
      expect(prohibidas.test(texto), r.clave).toBe(false)
    }
  })

  it('un fallo de la base no tumba la creacion del asistente', async () => {
    const roto = {
      from: () => {
        throw new Error('sin conexion')
      },
    } as never
    await expect(sembrarReglasPorDefecto(roto, 'w1')).resolves.toBeUndefined()
  })
})

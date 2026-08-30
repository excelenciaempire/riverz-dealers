import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { USD_POR_BUSQUEDA_WEB } from '@/lib/ai/busqueda-web'
import { costForModel } from '@/lib/admin/cost'

/**
 * Lo que cobra el proveedor es lo que se le carga al comercio.
 *
 * El saldo no es un producto con margen: es el traspaso de lo que cuesta
 * atender. El negocio es la mensualidad, y los costos de plataforma y
 * servidores no se le pasan a nadie. Decisión del dueño, 2026-08-30, y desde la
 * migración 225 `cobrar_a_costo` viene prendido por defecto.
 *
 * De ahí sale la regla que este test cuida: **todo `cobrar` pasa `costoUsd`.**
 * Sin ese número el cobro cae a la tarifa de lista, que es un promedio — y un
 * promedio cobra de más las respuestas cortas y de menos las largas, que es
 * exactamente lo contrario de pasar el costo tal cual. La tarifa queda sólo
 * como piso para lo que de verdad no se puede medir.
 */

const RAIZ = join(process.cwd(), 'src')

function archivosTs(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) {
      if (nombre === 'node_modules' || nombre === '.next') continue
      archivosTs(ruta, out)
    } else if (ruta.endsWith('.ts') && !ruta.endsWith('.test.ts')) {
      out.push(ruta)
    }
  }
  return out
}

describe('todo cobro dice cuánto costó', () => {
  it('ningún `cobrar` se apoya en la tarifa de lista', () => {
    const culpables: string[] = []
    for (const ruta of archivosTs(RAIZ)) {
      const rel = relative(RAIZ, ruta)
      if (rel === join('lib', 'wallet', 'saldo.ts')) continue // es quien lo define
      const src = readFileSync(ruta, 'utf8')
      // Cada llamada, desde `cobrar(` hasta su `})` de cierre.
      const partes = src.split(/\bcobrar\(/)
      for (let i = 1; i < partes.length; i++) {
        const bloque = partes[i].slice(0, 900)
        if (!/concepto:/.test(bloque)) continue // no es la de la billetera
        const hasta = bloque.indexOf('})')
        const llamada = hasta > 0 ? bloque.slice(0, hasta) : bloque
        if (!/costoUsd:/.test(llamada)) culpables.push(`${rel} → ${(/concepto: '?"?([a-z_]+)/.exec(llamada) ?? [])[1] ?? '?'}`)
      }
    }
    expect(
      culpables,
      `estos cobran sin decir cuánto costó, así que caen a la tarifa de lista:\n` +
        `${culpables.join('\n')}`,
    ).toEqual([])
  })
})

describe('el precio de cada proveedor', () => {
  it('la búsqueda web se cobra a lo que cobra Anthropic', () => {
    // 10 USD cada mil búsquedas. Va aparte de los tokens, así que `costForModel`
    // no la ve: sin este número la búsqueda salía gratis y la pagaba Riverz.
    expect(USD_POR_BUSQUEDA_WEB).toBe(10 / 1000)
  })

  it('la caché se cobra a su precio, no al del prompt', () => {
    // Leer sale una décima; escribir, un 25% más. Meterlas dentro del prompt
    // cobraría de más al que lee de caché y de menos al que la escribe — y la
    // escritura es el 82% de lo que cuesta una respuesta hoy.
    const soloPrompt = costForModel('claude-opus-5', 1_000_000, 0)
    const soloLectura = costForModel('claude-opus-5', 0, 0, { read: 1_000_000 })
    const soloEscritura = costForModel('claude-opus-5', 0, 0, { write: 1_000_000 })
    expect(soloLectura).toBeCloseTo(soloPrompt * 0.1, 6)
    expect(soloEscritura).toBeCloseTo(soloPrompt * 1.25, 6)
  })

  it('un modelo caro cuesta más que uno barato, y el cobro lo refleja', () => {
    // La tarifa de lista es plana por respuesta y no mira el modelo: por eso
    // una cuenta a tarifa perdía plata en cuanto el comercio elegía Opus.
    const haiku = costForModel('claude-haiku-4-5', 10_000, 500)
    const opus = costForModel('claude-opus-5', 10_000, 500)
    expect(opus).toBeGreaterThan(haiku * 4)
  })
})

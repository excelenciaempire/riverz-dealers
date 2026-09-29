/**
 * Parte una corrida unida en tandas para juzgarlas en paralelo, y junta los
 * veredictos de las tandas en uno.
 *
 * Uso:
 *   npx tsx scripts/eval-modelo/partir.ts tandas <unido.json> <hechos.json|-> <n> <prefijo>
 *   npx tsx scripts/eval-modelo/partir.ts juntar <salida.json> <veredicto.json> [<veredicto.json> ...]
 */
import { readFileSync, writeFileSync } from 'node:fs'

type Resumen = Record<string, Record<string, number>>
type Juicio = { infracciones: Array<{ gravedad: string }>; calidad_venta: number } | null
type Veredicto = { resumen: Resumen; casos: Array<{ id: string; veredicto: Record<string, Juicio> }> }

const [, , modo, ...args] = process.argv

if (modo === 'tandas') {
  const [entrada, hechos, n, prefijo] = args
  const unido = JSON.parse(readFileSync(entrada, 'utf8')) as { resultados: Array<{ id: string }> }
  const yaJuzgados = new Set(
    hechos === '-' ? [] : (JSON.parse(readFileSync(hechos, 'utf8')) as Veredicto).casos.map((c) => c.id)
  )
  const pendientes = unido.resultados.filter((r) => !yaJuzgados.has(r.id))
  const tandas = Number(n)
  const largo = Math.ceil(pendientes.length / tandas)
  for (let i = 0; i < tandas; i++) {
    const parte = pendientes.slice(i * largo, (i + 1) * largo)
    writeFileSync(`${prefijo}-${i + 1}.json`, JSON.stringify({ ...unido, resultados: parte }, null, 1))
    console.log(`${prefijo}-${i + 1}.json: ${parte.length} casos`)
  }
} else if (modo === 'juntar') {
  // El resumen se vuelve a contar desde los casos, y cada caso cuenta una vez:
  // si dos archivos juzgaron el mismo, manda el primero que se pasa.
  const [salida, ...rutas] = args
  const vistos = new Set<string>()
  const casos = rutas
    .flatMap((r) => (JSON.parse(readFileSync(r, 'utf8')) as Veredicto).casos)
    .filter((c) => !vistos.has(c.id) && vistos.add(c.id))
  const resumen: Resumen = {}
  for (const c of casos) {
    for (const [modelo, v] of Object.entries(c.veredicto)) {
      const s = (resumen[modelo] ??= { casos: 0, leves: 0, graves: 0, casos_con_grave: 0, calidad: 0, errores: 0 })
      if (!v) continue
      const graves = v.infracciones.filter((x) => x.gravedad === 'grave').length
      s.casos += 1
      s.graves += graves
      s.leves += v.infracciones.length - graves
      if (graves > 0) s.casos_con_grave += 1
      s.calidad += v.calidad_venta
    }
  }
  writeFileSync(salida, JSON.stringify({ resumen, casos }, null, 1))
  for (const [m, s] of Object.entries(resumen)) {
    console.log(`${m}: casos=${s.casos} graves=${s.graves} (en ${s.casos_con_grave} casos) leves=${s.leves} calidad_media=${(s.calidad / Math.max(1, s.casos)).toFixed(2)} errores=${s.errores}`)
  }
} else {
  throw new Error('modo: tandas | juntar')
}

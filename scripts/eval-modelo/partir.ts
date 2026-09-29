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
type Veredicto = { resumen: Resumen; casos: Array<{ id: string }> }

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
  const [salida, ...rutas] = args
  const partes = rutas.map((r) => JSON.parse(readFileSync(r, 'utf8')) as Veredicto)
  const resumen: Resumen = {}
  for (const p of partes) {
    for (const [modelo, cuenta] of Object.entries(p.resumen)) {
      resumen[modelo] ??= {}
      for (const [k, v] of Object.entries(cuenta)) resumen[modelo][k] = (resumen[modelo][k] ?? 0) + v
    }
  }
  const casos = partes.flatMap((p) => p.casos)
  writeFileSync(salida, JSON.stringify({ resumen, casos }, null, 1))
  for (const [m, s] of Object.entries(resumen)) {
    console.log(`${m}: casos=${s.casos} graves=${s.graves} (en ${s.casos_con_grave} casos) leves=${s.leves} calidad_media=${(s.calidad / Math.max(1, s.casos)).toFixed(2)} errores=${s.errores}`)
  }
} else {
  throw new Error('modo: tandas | juntar')
}

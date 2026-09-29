/**
 * Junta corridas de `run.ts` con `--etiqueta` en un solo archivo para
 * `juez.ts`, caso por caso. Con tres corridas el juez ve tres respuestas por
 * caso, en orden aleatorio.
 *
 * Uso:
 *   npx tsx scripts/eval-modelo/unir.ts <salida.json> <antes.json> <despues.json> [<otra.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs'

type Corrida = {
  agente: string
  modelos: string[]
  gasto: Record<string, unknown>
  resultados: Array<Record<string, unknown>>
}

const [, , salida, ...rutas] = process.argv
if (!salida || rutas.length < 2 || rutas.length > 3) throw new Error('uso: unir.ts <salida.json> <a.json> <b.json> [<c.json>]')
const corridas = rutas.map((r) => JSON.parse(readFileSync(r, 'utf8')) as Corrida)
const claves = corridas.map((c) => c.modelos[0])
if (claves.some((k) => !k) || new Set(claves).size !== claves.length) throw new Error('cada corrida necesita su propia etiqueta')

const porId = corridas.map((c) => new Map(c.resultados.map((r) => [r.id as string, r])))
const resultados = corridas[0].resultados
  .filter((r) => porId.every((m) => m.has(r.id as string)))
  .map((r) => {
    const fila: Record<string, unknown> = { ...r, system_chars: {} }
    claves.forEach((k, i) => {
      const otra = porId[i].get(r.id as string)!
      fila[k] = otra[k]
      ;(fila.system_chars as Record<string, unknown>)[k] = otra.system_chars
    })
    return fila
  })

writeFileSync(salida, JSON.stringify({
  agente: corridas[0].agente,
  modelos: claves,
  gasto: Object.assign({}, ...corridas.map((c) => c.gasto)),
  resultados,
}, null, 1))
console.log(`${resultados.length} casos, ${claves.join(' / ')}, en ${salida}`)

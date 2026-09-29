/**
 * Junta dos corridas de `run.ts` con `--etiqueta` en un solo archivo para
 * `juez.ts`, caso por caso.
 *
 * Uso:
 *   npx tsx scripts/eval-modelo/unir.ts <antes.json> <despues.json> <salida.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'

type Corrida = {
  agente: string
  modelos: string[]
  gasto: Record<string, unknown>
  resultados: Array<Record<string, unknown>>
}

const [, , rutaA, rutaB, salida] = process.argv
if (!rutaA || !rutaB || !salida) throw new Error('uso: unir.ts <a.json> <b.json> <salida.json>')
const a = JSON.parse(readFileSync(rutaA, 'utf8')) as Corrida
const b = JSON.parse(readFileSync(rutaB, 'utf8')) as Corrida
const [ka] = a.modelos
const [kb] = b.modelos
if (!ka || !kb || ka === kb) throw new Error('cada corrida necesita su propia etiqueta')

const deB = new Map(b.resultados.map((r) => [r.id as string, r]))
const resultados = a.resultados
  .filter((r) => deB.has(r.id as string))
  .map((r) => ({ ...r, [kb]: deB.get(r.id as string)![kb], system_chars: { [ka]: r.system_chars, [kb]: deB.get(r.id as string)!.system_chars } }))

writeFileSync(salida, JSON.stringify({ agente: a.agente, modelos: [ka, kb], gasto: { ...a.gasto, ...b.gasto }, resultados }, null, 1))
console.log(`${resultados.length} casos en ${salida}`)

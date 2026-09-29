/**
 * Saca de una corrida de `run.ts` los casos que fallaron por la red o el
 * proveedor, para que la próxima corrida (que es reanudable) los repita.
 *
 * Uso:
 *   npx tsx scripts/eval-modelo/sin-errores.ts <corrida.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ruta = process.argv[2]
if (!ruta) throw new Error('uso: sin-errores.ts <corrida.json>')
const corrida = JSON.parse(readFileSync(ruta, 'utf8')) as {
  modelos: string[]
  resultados: Array<Record<string, { error?: string } | unknown>>
}
const antes = corrida.resultados.length
corrida.resultados = corrida.resultados.filter((r) =>
  corrida.modelos.every((k) => !(r[k] as { error?: string } | undefined)?.error)
)
writeFileSync(ruta, JSON.stringify(corrida, null, 1))
console.log(`${antes - corrida.resultados.length} casos con error sacados de ${ruta}`)

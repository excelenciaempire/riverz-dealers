/**
 * Lo que las pruebas de este directorio necesitan antes de importar la app.
 *
 * - Las variables de entorno, de `--env <archivo>` (por defecto `.env.local`).
 * - 'server-only' resuelto a un módulo vacío: fuera de Next ese paquete
 *   explota al cargarse, y el runner lo importa en varias hojas.
 *
 * Por eso cada script llama `iniciar()` primero y recién después importa lo
 * de `src/` con `await import(...)`.
 */
import { readFileSync } from 'node:fs'
import Module from 'node:module'
import path from 'node:path'

export const arg = (name: string, def: string): string =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def

export function iniciar(): void {
  for (const line of readFileSync(arg('--env', '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  const stub = path.resolve('scripts/server-only-stub.cjs')
  const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string }
  const original = M._resolveFilename
  M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
    if (req === 'server-only') return stub
    return original.call(this, req, ...rest)
  }
}

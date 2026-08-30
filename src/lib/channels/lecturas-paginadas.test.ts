import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { selectAll, TOPE_POSTGREST } from '@/lib/db/paginate'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PostgREST corta en 1000 filas y NO lo dice.
 *
 * La respuesta es un array de 1000 elementos, indistinguible de "hay
 * exactamente 1000". Doce lecturas de `channel_connections` estaban así: pasada
 * esa marca, una conexión dejaba de existir para el enrutador del webhook o
 * para el cron que le renueva la suscripción, y el síntoma —"no coincide
 * ninguna cuenta"— se lee como un `page_id` mal configurado.
 *
 * El peor caso no era ese: `deleted_meta_participants` es la lista de
 * supresión de GDPR, y sin paginar el participante 1001 se RECREABA en cada
 * corrida del descubrimiento de hilos.
 */

const RAIZ = join(process.cwd(), 'src')

const PERMITIDOS = new Map([
  [join('lib', 'channels', 'connections.ts'), 'es el módulo que pagina'],
  [
    join('hooks', 'use-active-connections.ts'),
    'corre en el navegador con la sesión del comercio: RLS ya acota la tabla ' +
      'a su workspace, y nadie tiene mil conexiones',
  ],
])

function archivosTs(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) {
      if (nombre === 'node_modules' || nombre === '.next') continue
      archivosTs(ruta, out)
      // El navegador lee con la sesión del comercio y RLS le acota la tabla a
      // su workspace: nadie tiene mil conexiones, así que ahí el tope no muerde.
    } else if (ruta.endsWith('.ts') && !ruta.endsWith('.test.ts')) {
      out.push(ruta)
    }
  }
  return out
}

describe('nadie lista channel_connections sin paginar', () => {
  it('toda lectura de varias filas pasa por listConnections', () => {
    const culpables: string[] = []
    for (const ruta of archivosTs(RAIZ)) {
      const rel = relative(RAIZ, ruta)
      if (PERMITIDOS.has(rel)) continue
      const src = readFileSync(ruta, 'utf8')
      const partes = src.split(/\.from\(\s*['"]channel_connections['"]\s*\)/)
      for (let i = 1; i < partes.length; i++) {
        const bloque = partes[i].split(/\.from\(/)[0]
        if (!/\.select\(/.test(bloque)) continue // update/delete: no listan
        // Una sola fila conocida no puede truncarse.
        const acotada =
          /\.eq\(\s*['"]id['"]/.test(bloque) ||
          /\.maybeSingle\(\)/.test(bloque) ||
          /\.single\(\)/.test(bloque) ||
          /\.limit\(/.test(bloque) ||
          /\.range\(/.test(bloque) ||
          // Lo de UN comercio: nadie tiene mil conexiones. El corte de
          // PostgREST sólo muerde en las lecturas globales, que son las de los
          // crons y el enrutador del webhook.
          /\.eq\(\s*['"]workspace_id['"]/.test(bloque) ||
          /\.in\(\s*['"]workspace_id['"]/.test(bloque) ||
          /\.eq\(\s*['"]user_id['"]/.test(bloque) ||
          /\.in\(\s*['"]id['"]/.test(bloque) ||
          // Sólo cuenta filas, no las trae.
          /head:\s*true/.test(bloque)
        if (!acotada) culpables.push(rel)
      }
    }
    expect(
      culpables,
      `estos listan conexiones sin paginar y se truncan en ${TOPE_POSTGREST} filas ` +
        `sin avisar:\n${culpables.join('\n')}\n\n` +
        `Usá listConnections de lib/channels/connections.ts.`,
    ).toEqual([])
  })
})

describe('selectAll', () => {
  /** Cliente de mentira: devuelve `total` filas repartidas en páginas. */
  function fakeDb(total: number) {
    let llamadas = 0
    const db = {
      from() {
        const estado: { desde: number; hasta: number } = { desde: 0, hasta: 0 }
        const chain: Record<string | symbol, unknown> = new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === 'then') {
                return (resolve: (v: unknown) => unknown) => {
                  llamadas++
                  const filas = []
                  for (let i = estado.desde; i <= estado.hasta && i < total; i++) {
                    filas.push({ id: `r-${i}` })
                  }
                  return Promise.resolve({ data: filas, error: null }).then(resolve)
                }
              }
              if (prop === 'range') {
                return (a: number, b: number) => {
                  estado.desde = a
                  estado.hasta = b
                  return chain
                }
              }
              return () => chain
            },
          },
        )
        return chain
      },
    } as unknown as SupabaseClient
    return { db, llamadas: () => llamadas }
  }

  it('trae TODAS las filas, no las primeras 1000', async () => {
    const { db, llamadas } = fakeDb(2501)
    const filas = await selectAll<{ id: string }>(db, 'tabla', (q) => q)
    expect(filas).toHaveLength(2501)
    expect(llamadas()).toBe(3)
  })

  it('con menos de una página hace una sola consulta', async () => {
    const { db, llamadas } = fakeDb(7)
    const filas = await selectAll<{ id: string }>(db, 'tabla', (q) => q)
    expect(filas).toHaveLength(7)
    expect(llamadas()).toBe(1)
  })

  it('una tabla vacía no da vueltas de más', async () => {
    const { db, llamadas } = fakeDb(0)
    expect(await selectAll(db, 'tabla', (q) => q)).toEqual([])
    expect(llamadas()).toBe(1)
  })
})

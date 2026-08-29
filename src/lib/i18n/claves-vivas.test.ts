import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MESSAGES } from './messages/registry'

/**
 * Una clave que la pantalla pide y el catálogo no tiene.
 *
 * `translate` cae a la clave cuando no la encuentra, así que borrar una entrada
 * que alguien todavía usa **no rompe el build ni ninguna prueba**: se imprime
 * `operation.toolsTitle` en el título de una pestaña y nadie se entera hasta
 * que lo ve un cliente. Pasó esta semana, en las dos direcciones — una sesión
 * borró la clave, otra empezó a usarla.
 *
 * Se limita a las carpetas de abajo a propósito. Una barrida de todo `src` trae
 * falsos positivos que no se pueden distinguir estáticamente: nombres de
 * columnas que parecen claves (`contacts.phone`), y la portada, que remapea el
 * namespace en tiempo de ejecución según qué redacción esté mostrando.
 *
 * El panel de plataforma entró acá por la misma razón que el Operador: son 516
 * claves que sólo mira el equipo, así que una que se caiga puede quedar meses
 * imprimiendo `admin.sectionCodesDesc` sin que nadie lo note.
 */
const VIGILADOS: { prefijo: string; carpetas: string[] }[] = [
  { prefijo: 'operation', carpetas: ['src/components/operacion', 'src/lib/operator'] },
  { prefijo: 'admin', carpetas: ['src/app/admin'] },
]

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return archivos(p)
    return /\.tsx?$/.test(n) && !n.endsWith('.test.ts') ? [p] : []
  })
}

describe.each(VIGILADOS)('las claves de $prefijo', ({ prefijo, carpetas }) => {
  it('existen todas en el catálogo', () => {
    const pide = new RegExp(`['"\`](${prefijo}\\.[a-zA-Z0-9_]+)['"\`]`, 'g')
    const faltan: string[] = []
    for (const carpeta of carpetas) {
      for (const f of archivos(carpeta)) {
        const src = readFileSync(f, 'utf8')
        for (const [, clave] of src.matchAll(pide)) {
          if (!MESSAGES[clave]) faltan.push(`${clave} (${f})`)
        }
      }
    }
    expect(faltan).toEqual([])
  })

  it('las que existen están en los dos idiomas', () => {
    const mancas = Object.entries(MESSAGES)
      .filter(([k]) => k.startsWith(`${prefijo}.`))
      .filter(([, v]) => !v.es?.trim() || !v.en?.trim())
      .map(([k]) => k)
    expect(mancas).toEqual([])
  })
})

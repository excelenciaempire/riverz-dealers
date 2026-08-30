import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NEEDS_HUMAN_REASONS } from '@/types'
import { POLITICA } from './desenlace'

/**
 * La lista de motivos del código y la de la base tienen que ser LA MISMA.
 *
 * Estuvieron separadas y no se notó: el tipo llegó a doce valores mientras la
 * CHECK de `conversations.needs_human_reason` seguía en siete. El cliente de
 * Supabase devuelve el error de la restricción EN EL RESULTADO en vez de
 * tirarlo, y en ningún punto de escritura se miraba — así que cinco caminos de
 * escalada estaban cortados sin una sola línea de log.
 *
 * Verificado en producción el 2026-08-30: de los doce motivos, sólo los siete
 * que la CHECK permitía tenían alguna fila. Los otros cinco, cero desde
 * siempre. El peor era `comprobante_sin_pedido`: la IA le dice al cliente "lo
 * estamos verificando y te aviso" y no había nadie del otro lado.
 *
 * Este test es lo único que impide que vuelvan a separarse.
 */

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations')

/** La última migración que toca la restricción: la que manda hoy. */
function checkVigente(): string {
  const archivos = readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const f of [...archivos].reverse()) {
    const sql = readFileSync(join(MIGRACIONES, f), 'utf8')
    if (
      sql.includes('conversations_needs_human_reason_check') &&
      /ADD CONSTRAINT/i.test(sql)
    ) {
      return sql
    }
  }
  throw new Error('ninguna migración define conversations_needs_human_reason_check')
}

describe('los motivos de escalada y la base', () => {
  const sql = checkVigente()

  for (const motivo of NEEDS_HUMAN_REASONS) {
    it(`la base acepta "${motivo}"`, () => {
      expect(sql).toContain(`'${motivo}'`)
    })
  }

  it('y no acepta ninguno que el código no conozca', () => {
    // El otro lado de la deriva: un valor que quedó en la base y que ya nadie
    // escribe es una escalada que la bandeja no sabe explicar.
    const enLaBase = [...sql.matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      // Los nombres de columna y tabla que aparecen en el mismo archivo no son
      // motivos: la lista de la CHECK es la única que importa.
      .filter((v) => v.includes('_') && v !== 'needs_human_reason')
    const desconocidos = enLaBase.filter(
      (v) => !(NEEDS_HUMAN_REASONS as readonly string[]).includes(v),
    )
    expect(desconocidos, desconocidos.join(', ')).toEqual([])
  })

  it('todo desenlace que escala usa un motivo que la base acepta', () => {
    // `desenlace.ts` es LA tabla de decisiones: si escala con un motivo que la
    // base rechaza, la fila no se escribe y el hilo queda sin dueño.
    for (const [clave, politica] of Object.entries(POLITICA)) {
      if (!politica.escala) continue
      expect(
        (NEEDS_HUMAN_REASONS as readonly string[]).includes(politica.escala),
        `${clave} escala con "${politica.escala}"`,
      ).toBe(true)
      expect(sql, `${clave}`).toContain(`'${politica.escala}'`)
    }
  })
})

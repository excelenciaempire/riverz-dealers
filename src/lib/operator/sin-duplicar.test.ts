import { describe, expect, it } from 'vitest'

import type { CapabilityContext } from '@/lib/capabilities/types'
import { proponer } from './escribir'
import { toAnthropic, type ThreadMessage } from './threads'

/**
 * Seis mensajes donde tenían que ser tres.
 *
 * Pasó en una cuenta real: se pidió corregir dos de tres plantillas, el
 * especialista volvió a escribir las tres con nombres nuevos, y la tarjeta pasó
 * a pedir SEIS aprobaciones. Dos causas, dos defensas, y las dos se prueban acá:
 *
 *  - el modelo no veía lo que él mismo había propuesto (`toAnthropic` mandaba
 *    sólo el texto), así que reinventaba los nombres;
 *  - y nada impedía dos propuestas iguales esperando el mismo click.
 */

interface Fila {
  id: string
  capability_key: string
  status: string
  args: Record<string, unknown>
}

/** Una base de mentira que sólo sabe de `operator_actions`. */
function fakeDb(filas: Fila[]) {
  let n = filas.length
  const actualizado: Array<{ id: string; args: Record<string, unknown> }> = []
  const db = {
    from() {
      const q: Record<string, unknown> = {}
      const self = {
        select: () => self,
        eq: () => self,
        single: async () => {
          const id = `a${++n}`
          filas.push({
            id,
            capability_key: String(q.capability_key ?? ''),
            status: 'propuesto',
            args: (q.args ?? {}) as Record<string, unknown>,
          })
          return { data: { id }, error: null }
        },
        insert(v: Record<string, unknown>) {
          Object.assign(q, v)
          return self
        },
        update(v: Record<string, unknown>) {
          Object.assign(q, v)
          actualizado.push({ id: 'x', args: (v.args ?? {}) as Record<string, unknown> })
          return { eq: async () => ({ data: null, error: null }) }
        },
        then(res: (v: { data: Fila[] }) => void) {
          res({ data: filas.filter((f) => f.status === 'propuesto') })
        },
      }
      return self
    },
  }
  return { db: db as unknown as CapabilityContext['db'], filas, actualizado }
}

const ctx = (db: CapabilityContext['db']): CapabilityContext => ({
  db,
  workspaceId: 'ws',
  actor: { type: 'operator', id: 'u' },
  locale: 'es',
})

describe('la misma propuesta no se guarda dos veces', () => {
  it('con el mismo nombre esperando, se actualiza la que ya está', async () => {
    const f = fakeDb([
      { id: 'a1', capability_key: 'plantillas.crear', status: 'propuesto', args: { nombre: 'recompra_1' } },
    ])
    const r = await proponer(ctx(f.db), 'th', 'plantillas.crear', {
      nombre: 'recompra_1',
      cuerpo: 'Hola {{1}}, con el emoji nuevo 🎉',
      ejemplos: ['Ana'],
    })

    expect(r.id).toBe('a1')
    expect(f.filas).toHaveLength(1)
    // Y con el texto corregido, que es lo que hay que mirar.
    expect(f.actualizado[0].args.cuerpo).toContain('🎉')
  })

  it('con otro nombre, se agrega', async () => {
    const f = fakeDb([
      { id: 'a1', capability_key: 'plantillas.crear', status: 'propuesto', args: { nombre: 'recompra_1' } },
    ])
    await proponer(ctx(f.db), 'th', 'plantillas.crear', {
      nombre: 'recompra_2',
      cuerpo: 'Hola {{1}}, va el pack.',
      ejemplos: ['Ana'],
    })
    expect(f.filas).toHaveLength(2)
  })

})

describe('lo que el modelo recuerda de sus propios turnos', () => {
  const turno = (bloques: ThreadMessage['bloques']): ThreadMessage => ({
    id: 'm1',
    role: 'assistant',
    text: 'Escribí los mensajes.',
    bloques,
    created_at: '2026-08-26T00:00:00Z',
  })

  it('los nombres de lo que quedó propuesto viajan al turno siguiente', () => {
    const [m] = toAnthropic([
      turno([
        { k: 'paso', id: '1', key: 'plantillas.crear', label: 'Las plantillas', estado: 'propuesto', detalle: 'Crear «recompra_1»' },
        { k: 'paso', id: '2', key: 'plantillas.crear', label: 'Las plantillas', estado: 'propuesto', detalle: 'Crear «recompra_2»' },
      ]),
    ])
    expect(m.content).toContain('recompra_1')
    expect(m.content).toContain('recompra_2')
    expect(m.content).toContain('REUSA el mismo nombre')
  })

  it('y lo que quedó hecho se distingue de lo que espera', () => {
    const [m] = toAnthropic([
      turno([
        { k: 'paso', id: '1', key: 'automatizaciones.crear', label: 'Las automatizaciones', estado: 'hecho', detalle: '«Recompra por unidades»: 9 pasos' },
      ]),
    ])
    expect(m.content).toContain('quedó hecho')
    expect(m.content).toContain('Recompra por unidades')
  })

  it('un turno sin bloques viaja como siempre', () => {
    const [m] = toAnthropic([
      { id: 'm', role: 'user', text: 'arma la recompra', created_at: '2026-08-26T00:00:00Z' },
    ])
    expect(m.content).toBe('arma la recompra')
  })
})

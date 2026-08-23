import { describe, expect, it, vi } from 'vitest'

import type { CapabilityContext } from '@/lib/capabilities/types'
import { fakeDb } from './fleet/fake-db'
import { proponer } from './escribir'

/**
 * No se propone lo que no se puede hacer.
 *
 * Pasó en una cuenta real y quedó en la base: dos filas `propuesto` cuya vista
 * previa empezaba con «No se puede: no se puede editar así — …», cada una con
 * su botón de aprobar intacto. `proponer` se tragaba el error de `preview()` y
 * guardaba el motivo COMO si fuera la descripción de lo que iba a pasar.
 *
 * Quien mira esa tarjeta no tiene forma de saber que ese botón no hace nada.
 * Y en una pila de ocho aprobaciones seguidas —que es de dónde venimos— ni
 * siquiera se lee.
 */

vi.mock('@/lib/capabilities/registry', () => ({
  findCapability: (key: string) => CAPS[key],
}))

const CAPS: Record<string, Record<string, unknown>> = {
  'prueba.rompe': {
    key: 'prueba.rompe',
    risk: 'reversible',
    preview: () => {
      throw new Error('no se puede editar así — el paso 3 no existe')
    },
  },
  'prueba.anda': {
    key: 'prueba.anda',
    risk: 'reversible',
    preview: () => 'Cambiaría «Recompra» y quedaría con 7 pasos.',
  },
}

function ctxCon(db: ReturnType<typeof fakeDb>): CapabilityContext {
  return {
    db: db.db,
    workspaceId: 'ws-1',
    actor: { type: 'operator', id: 'u-1' },
    locale: 'es',
  } as CapabilityContext
}

describe('proponer', () => {
  it('no deja fila cuando la capacidad no puede describir lo que haría', async () => {
    const db = fakeDb()
    await expect(proponer(ctxCon(db), 'th-1', 'prueba.rompe', {})).rejects.toThrow(
      /el paso 3 no existe/,
    )
    expect(db.en('operator_actions')).toHaveLength(0)
  })

  it('el motivo vuelve entero, para que el modelo pueda corregir', async () => {
    const db = fakeDb()
    const e = await proponer(ctxCon(db), 'th-1', 'prueba.rompe', {}).catch((x: Error) => x)
    expect(e).toBeInstanceOf(Error)
    // Sin el «No se puede:» que se le anteponía: decía dos veces lo mismo.
    expect((e as Error).message).not.toMatch(/^No se puede/)
  })

  it('cuando sí se puede, deja la fila esperando un click', async () => {
    const db = fakeDb()
    const p = await proponer(ctxCon(db), 'th-1', 'prueba.anda', { x: 1 })
    const filas = db.en('operator_actions')
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ status: 'propuesto', capability_key: 'prueba.anda' })
    expect(p.preview).toContain('Recompra')
    // Lo que se le contesta al modelo NO dice que esté hecho.
    expect(JSON.parse(p.texto)).toMatchObject({ propuesto: true })
  })
})

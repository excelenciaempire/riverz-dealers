import { describe, expect, it, vi } from 'vitest'

import { latido } from './corridas'

/**
 * El latido: la foto de cómo va, sin ahogar la base.
 *
 * Un turno con reparto emite cientos de eventos —cada delta de texto es uno— y
 * guardar en todos sería una escritura por letra. Pero si no guarda nada, quien
 * vuelve a la pantalla no ve nada: la corrida sigue en el servidor y la persona
 * mira su propio pedido sin respuesta, que es de donde venimos.
 */

function baseFalsa() {
  const escrituras: Record<string, unknown>[] = []
  const db = {
    from: () => ({
      update: (fila: Record<string, unknown>) => ({
        eq: async () => {
          escrituras.push(fila)
          return { error: null }
        },
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { db, escrituras }
}

describe('el latido de una corrida', () => {
  it('no escribe una vez por evento', async () => {
    const { db, escrituras } = baseFalsa()
    const l = latido(db, 'run-1')
    for (let i = 0; i < 50; i++) await l.ver(`texto ${i}`, [])
    // La primera pasa; las otras cuarenta y nueve caen dentro del mismo
    // segundo y no se escriben.
    expect(escrituras.length).toBeLessThanOrEqual(2)
  })

  it('al forzar guarda sí o sí, y espera', async () => {
    // Es el cierre del turno: si esa última foto no llega, quien vuelve ve la
    // penúltima y le falta el final.
    const { db, escrituras } = baseFalsa()
    const l = latido(db, 'run-1')
    await l.ver('final', [{ k: 'texto', id: 't0', texto: 'listo' }], true)
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0]).toMatchObject({ texto: 'final' })
  })

  it('un latido que falla no tumba el turno', async () => {
    // Es la foto, no el trabajo. Lo peor que pasa es que quien vuelve la vea un
    // segundo vieja.
    const db = {
      from: () => ({
        update: () => ({
          eq: async () => {
            throw new Error('sin red')
          },
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const l = latido(db, 'run-1')
    await expect(l.ver('x', [], true)).resolves.toBeUndefined()
  })

  it('deja pasar el tiempo entre latidos', async () => {
    vi.useFakeTimers()
    try {
      const { db, escrituras } = baseFalsa()
      const l = latido(db, 'run-1')
      await l.ver('uno', [])
      // `advanceTimersByTimeAsync` además vacía las microtareas: sin eso la
      // escritura anterior sigue en vuelo y la siguiente se saltea a propósito,
      // que es justo lo que evita que se apilen.
      await vi.advanceTimersByTimeAsync(1500)
      await l.ver('dos', [])
      expect(escrituras.length).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

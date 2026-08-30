import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTIC_LOOP_MAX_ITERS, MAX_PAUSAS } from './tools'

/**
 * Una pausa del servidor no es el modelo pidiendo trabajo.
 *
 * `pause_turn` es Anthropic diciendo «me detuve a mitad de la búsqueda,
 * seguí». Se contaba contra las seis vueltas del bucle, así que con la
 * búsqueda en internet prendida —hasta tres por respuesta— tres pausas se
 * comían la mitad del presupuesto y el turno terminaba en la llamada forzada
 * sin herramientas: al cliente le salía «no pude completar la consulta»
 * habiendo tenido la respuesta a mano.
 */

const src = readFileSync(join(process.cwd(), 'src', 'lib', 'ai', 'tools.ts'), 'utf8')

describe('las pausas del servidor', () => {
  it('devuelven la vuelta que consumieron', () => {
    // El bucle incrementa al entrar; la rama de pausa lo compensa.
    const rama = src.slice(src.indexOf("stop_reason === 'pause_turn'"))
    expect(rama.slice(0, 400)).toContain('iter -= 1')
  })

  it('tienen su propio tope, para que no sea una llamada infinita', () => {
    expect(src).toContain('pausas <= MAX_PAUSAS')
    expect(MAX_PAUSAS).toBeGreaterThan(0)
  })

  it('el tope cubre las búsquedas que la herramienta permite, con aire', () => {
    // `busqueda-web` admite hasta 3 por respuesta y cada una puede pausar.
    expect(MAX_PAUSAS).toBeGreaterThanOrEqual(3)
  })

  it('el presupuesto de vueltas sigue siendo el de siempre', () => {
    // Esto no aumenta lo que el modelo puede pedir: sólo deja de cobrarle las
    // pausas, que no eran suyas.
    expect(AGENTIC_LOOP_MAX_ITERS).toBe(6)
  })
})

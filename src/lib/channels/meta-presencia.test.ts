import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { soportaPresencia } from './meta-presencia'

/**
 * «Visto» y «escribiendo…» sólo cuando de verdad vamos a contestar.
 *
 * Marcar visto sobre un mensaje que la IA va a saltear —fuera de horario, el
 * hilo asignado a alguien que todavía no lo abrió— es decirle al cliente que
 * alguien lo leyó cuando no lo leyó nadie. Es peor que el silencio: el silencio
 * no promete nada.
 */

describe('qué canales admiten la marca', () => {
  it('sólo Messenger e Instagram', () => {
    expect(soportaPresencia('messenger')).toBe(true)
    expect(soportaPresencia('instagram')).toBe(true)
    // WhatsApp tiene su propio acuse y marcarlo desde el webhook convertiría
    // «entregado» en «visto» por un mensaje que nadie miró.
    expect(soportaPresencia('whatsapp')).toBe(false)
    expect(soportaPresencia('ig_comment')).toBe(false)
    expect(soportaPresencia('gmail')).toBe(false)
  })
})

describe('cuándo se manda', () => {
  const runner = readFileSync(
    join(process.cwd(), 'src', 'lib', 'ai', 'runner.ts'),
    'utf8',
  )

  it('después de todas las guardas, no al recibir', () => {
    const iMarca = runner.indexOf('void marcarPresencia')
    const iGuardas = runner.indexOf('shouldSkip')
    expect(iMarca).toBeGreaterThan(0)
    expect(iGuardas).toBeGreaterThan(0)
    expect(
      iMarca,
      'la marca quedó antes de las guardas: prometería una lectura que no pasó',
    ).toBeGreaterThan(iGuardas)
  })

  it('justo antes de pensar la respuesta', () => {
    const iMarca = runner.indexOf('void marcarPresencia')
    const iGenera = runner.indexOf('reply = await generateReply(')
    expect(iMarca).toBeLessThan(iGenera)
  })

  it('no se espera: la respuesta importa más que el puntito', () => {
    const bloque = runner.slice(runner.indexOf('soportaPresencia(args.channel)'), runner.indexOf('reply = await generateReply('))
    expect(bloque).toContain('void marcarPresencia')
    expect(bloque).not.toContain('await marcarPresencia')
  })
})

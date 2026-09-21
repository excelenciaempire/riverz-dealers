import { describe, expect, it } from 'vitest'

/**
 * Una caída no le hace promesas falsas al cliente. El turno se registra y
 * queda visible para revisión, pero los canales externos no reciben el texto
 * genérico «en un momento te responde una persona».
 */
describe('la cortesia de una caida', () => {
  it('los canales externos registran el fallo y salen antes de enviar', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/lib/ai/runner.ts', 'utf8')
    const marker = src.indexOf('External channels stay silent on provider failures')
    const i = src.indexOf("if (args.channel !== 'webchat'", marker)
    const j = src.indexOf('const courtesy: Record<string, string> =', i)
    const bloque = src.slice(i, j)
    expect(bloque).toContain('logReply')
    expect(bloque).toContain('return;')
    expect(bloque).not.toContain('sendText')
    expect(src).not.toContain('En un momento te responde una persona de nuestro equipo')
  })
})

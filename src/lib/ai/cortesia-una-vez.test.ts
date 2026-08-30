import { describe, expect, it } from 'vitest'
import { CORTESIA_UNA_VEZ_MS } from './types'

/**
 * La disculpa de una caida se manda UNA vez.
 *
 * Cuando el modelo falla, al cliente se le manda "en un momento te responde
 * una persona" para no dejarlo en silencio. Pero eso sale por CADA mensaje
 * entrante, y en una caida entran varios: el 2026-08-30, con el saldo de
 * Anthropic agotado, una clienta recibio la misma disculpa DOS VECES en 26
 * segundos.
 *
 * Es el mismo mecanismo que el 4 y el 21 de agosto mando 995 correos de
 * cortesia cuando se cayo el proveedor de correo. La diferencia entre una
 * caida y un incidente de spam es exactamente esta ventana.
 */
describe('la cortesia de una caida', () => {
  it('la ventana cubre el caso real: dos mensajes en 26 segundos', () => {
    expect(CORTESIA_UNA_VEZ_MS).toBeGreaterThan(26_000)
  })

  it('pero no tanto como para callar una caida de otro dia', () => {
    // Si la caida dura mas de media hora, el problema no se arregla avisando
    // de nuevo — pero una caida NUEVA, horas despues, si merece su aviso.
    expect(CORTESIA_UNA_VEZ_MS).toBeLessThanOrEqual(60 * 60 * 1000)
  })

  it('el runner la consulta antes de mandar, y sale sin repetir', async () => {
    // La forma del corte, leida del propio archivo: la consulta por texto
    // igual dentro de la ventana, y el `return` que evita el segundo envio.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/lib/ai/runner.ts', 'utf8')
    const i = src.indexOf('const text = courtesy[lang] ?? courtesy.es;')
    const j = src.indexOf('const adapter = getAdapter(args.channel);', i)
    const bloque = src.slice(i, j)
    expect(bloque).toContain('CORTESIA_UNA_VEZ_MS')
    expect(bloque).toContain('return;')
    // Y registra el intento igual: un turno que no manda nada tiene que dejar
    // rastro, porque `logReply` es lo que escala la conversacion a una persona.
    expect(bloque).toContain('logReply')
  })
})

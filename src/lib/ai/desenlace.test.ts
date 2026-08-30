import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { POLITICA, politicaDe, type Desenlace } from './desenlace'
import { health } from '@/lib/i18n/messages/health'
import { inbox } from '@/lib/i18n/messages/inbox'

/**
 * La red que impide que esto se vuelva a desarmar.
 *
 * El sistema de "cuándo contesto, cuándo me callo y cuándo llamo a una persona"
 * se había vuelto doce decisiones sueltas repartidas por dos archivos, y tres
 * de ellas se habían olvidado de escalar. Estos tests no prueban la lógica de
 * las guardas —eso lo hace cada una— sino que la POLÍTICA esté completa:
 *
 *   1. Todo motivo que el código escribe está declarado en la tabla.
 *   2. Todo motivo declarado tiene un texto para el comercio.
 *   3. Todo escalado tiene su motivo en el tipo y su texto en la bandeja.
 *
 * Si alguien agrega un desenlace nuevo y se olvida de decidir qué hace con él,
 * uno de estos tres falla.
 */

const RAIZ = join(process.cwd(), 'src', 'lib')

/** Los `skip_reason` literales que el código escribe de verdad. */
function motivosEnElCodigo(): Set<string> {
  const archivos = ['ai/runner.ts', 'instagram-agent/realtime.ts']
  const encontrados = new Set<string>()
  for (const rel of archivos) {
    const texto = readFileSync(join(RAIZ, rel), 'utf8')
    // `skip_reason: 'x'` y `return 'comment_x'`
    for (const m of texto.matchAll(/skip_reason:\s*'([a-z_]+)'/g)) encontrados.add(m[1])
    for (const m of texto.matchAll(/return\s+'(comment_[a-z_]+)'/g)) encontrados.add(m[1])
  }
  return encontrados
}

describe('toda decisión está declarada', () => {
  it('cada motivo que el código escribe existe en la tabla', () => {
    const sinDeclarar = [...motivosEnElCodigo()].filter((m) => !politicaDe(m))
    expect(sinDeclarar, `sin declarar en POLITICA: ${sinDeclarar.join(', ')}`).toEqual([])
  })

  it('la tabla cubre los desenlaces que ya existían', () => {
    // Los que estaban antes de la tabla: si alguno desaparece, algo se borró
    // sin querer.
    for (const m of [
      'sent',
      'ai_disabled_for_conversation',
      'conversation_assigned',
      'conversation_closed',
      'outside_hours',
      'escalation_keyword',
      'escalate_after_messages',
      'reply_burst_guard',
      'debounced_by_newer_inbound',
      'stale_by_newer_inbound',
      'awaiting_approval',
      'empty_reply',
      'answer_gap',
      'ai_no_credit',
      'ai_rate_limited',
      'ai_upstream',
      'ai_error',
      'tool_loop_truncated_fallback',
    ]) {
      expect(politicaDe(m), m).not.toBeNull()
    }
  })
})

describe('lo que el comercio ve', () => {
  const claves = health as unknown as Record<string, unknown>

  it('cada motivo tiene su texto en el panel', () => {
    const sinTexto = (Object.keys(POLITICA) as Desenlace[])
      .filter((m) => m !== 'sent')
      .filter((m) => !claves[`skip_${m}`])
    expect(sinTexto, `sin texto skip_*: ${sinTexto.join(', ')}`).toEqual([])
  })

  it('cada escalado tiene su aviso en la bandeja', () => {
    const hilo = readFileSync(
      join(process.cwd(), 'src', 'components', 'inbox', 'message-thread.tsx'),
      'utf8',
    )
    const cajaInbox = inbox as unknown as Record<string, unknown>
    const motivos = new Set(
      Object.values(POLITICA)
        .map((p) => p.escala)
        .filter((r): r is NonNullable<typeof r> => Boolean(r)),
    )
    for (const motivo of motivos) {
      // Está mapeado a una clave i18n…
      const par = new RegExp(`${motivo}:\\s*"inbox\\.([A-Za-z]+)"`).exec(hilo)
      expect(par, `sin mapear en message-thread: ${motivo}`).not.toBeNull()
      // …y esa clave existe.
      expect(cajaInbox[par![1]], `falta inbox.${par![1]} (${motivo})`).toBeTruthy()
    }
  })
})

describe('la política dice cosas coherentes', () => {
  it('sólo "sent" cuenta como contestado', () => {
    const contestados = (Object.keys(POLITICA) as Desenlace[]).filter(
      (m) => POLITICA[m].contestado,
    )
    expect(contestados).toEqual(['sent'])
  })

  it('lo que no escala, no apaga la IA', () => {
    for (const [motivo, p] of Object.entries(POLITICA)) {
      if (!p.escala) expect(p.apaga, motivo).toBe(false)
    }
  })

  it('un fallo del proveedor escala pero NO apaga la IA', () => {
    // Una caída de diez minutos no puede dejar mudos los hilos por días.
    for (const m of ['ai_no_credit', 'ai_rate_limited', 'ai_upstream', 'ai_error'] as const) {
      expect(POLITICA[m].escala, m).toBe('ia_caida')
      expect(POLITICA[m].apaga, m).toBe(false)
    }
  })

  it('si el cliente escribió y no recibió nada, alguien se entera', () => {
    // Los tres agujeros del 2026-08-30.
    for (const m of ['empty_reply', 'tool_loop_truncated_fallback', 'ai_error'] as const) {
      expect(POLITICA[m].escala, m).not.toBeNull()
    }
  })

  it('lo que ya atiende alguien no vuelve a escalar', () => {
    for (const m of [
      'ai_disabled_for_conversation',
      'conversation_assigned',
      'conversation_closed',
      'awaiting_approval',
    ] as const) {
      expect(POLITICA[m].escala, m).toBeNull()
    }
  })

  it('un mensaje que cubre otro turno no escala', () => {
    for (const m of ['debounced_by_newer_inbound', 'stale_by_newer_inbound'] as const) {
      expect(POLITICA[m].escala, m).toBeNull()
    }
  })

  it('la crítica se oculta y no escala: es decisión del comercio', () => {
    expect(POLITICA.comment_critica.escala).toBeNull()
    expect(POLITICA.comment_spam.escala).toBeNull()
  })

  it('pero si NO se pudo ocultar, sí escala', () => {
    expect(POLITICA.comment_no_se_pudo_ocultar.escala).toBe('comment_sin_moderar')
    expect(POLITICA.comment_no_se_pudo_publicar.escala).toBe('comment_sin_moderar')
  })

  it('cada entrada explica por qué', () => {
    for (const [motivo, p] of Object.entries(POLITICA)) {
      expect(p.porque.length, motivo).toBeGreaterThan(8)
    }
  })
})

describe('ningún camino se va sin dejar fila', () => {
  it('los cuatro que salían antes de elegir agente tienen política', () => {
    // Salían con un `return` a secas: la pregunta más frecuente del comercio
    // —«¿por qué no contestó?»— no tenía respuesta ni mirando la base, porque
    // no había fila que mirar.
    for (const motivo of [
      'motor_apagado',
      'sin_saldo',
      'suscripcion_vencida',
      'csat_capturada',
      'sin_agente',
      'comment_red_apagada',
    ]) {
      expect(POLITICA, `${motivo} sin política`).toHaveProperty(motivo)
    }
  })

  it('el runner los escribe, no sólo los declara', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'lib', 'ai', 'runner.ts'),
      'utf8',
    )
    expect(src).toContain('anotarSalida')
    for (const motivo of ['motor_apagado', 'csat_capturada', 'sin_agente']) {
      expect(src, `el runner no anota ${motivo}`).toContain(`'${motivo}'`)
    }
  })
})

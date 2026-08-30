import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCommentConversation } from './hilo'
import { POLITICA } from '@/lib/ai/desenlace'

/**
 * Un comentario no puede tocar el chat de la misma persona.
 *
 * Los dos sitios que escribían sobre "la conversación de este contacto" tomaban
 * la más reciente de CUALQUIER canal. Alguien que venía hablando por WhatsApp y
 * además comentaba en Instagram tenía el hilo de WhatsApp como el más reciente,
 * así que un "quiero hablar con una persona" bajo un post escalaba —y con
 * `POLITICA.comment_pide_humano`, APAGABA— la IA del WhatsApp.
 */

/** Guarda los filtros que se le aplicaron a la consulta. */
function dbEspia(fila: unknown) {
  const filtros: Array<[string, unknown]> = []
  const db = {
    from() {
      const chain: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'maybeSingle') return () => Promise.resolve({ data: fila })
            return (...args: unknown[]) => {
              if (prop === 'eq') filtros.push([String(args[0]), args[1]])
              return chain
            }
          },
        },
      )
      return chain
    },
  } as unknown as SupabaseClient
  return { db, filtros }
}

describe('loadCommentConversation', () => {
  it('acota por workspace, contacto Y canal de comentarios', async () => {
    const { db, filtros } = dbEspia({ id: 'c-1', ai_enabled: true })
    await loadCommentConversation(db, {
      workspaceId: 'ws-1',
      contactId: 'contact-1',
      channel: 'ig_comment',
    })
    const claves = filtros.map(([k]) => k)
    expect(claves).toContain('workspace_id')
    expect(claves).toContain('contact_id')
    expect(claves, 'sin filtro de canal agarra el hilo de WhatsApp').toContain('channel')
    expect(filtros.find(([k]) => k === 'channel')?.[1]).toBe('ig_comment')
  })

  it('devuelve el estado que el piso autónomo tiene que mirar', async () => {
    const { db } = dbEspia({
      id: 'c-1',
      ai_enabled: false,
      assigned_agent_id: null,
      status: 'open',
    })
    const hilo = await loadCommentConversation(db, {
      workspaceId: 'ws-1',
      contactId: 'contact-1',
      channel: 'fb_comment',
    })
    expect(hilo?.ai_enabled).toBe(false)
  })
})

describe('el piso autónomo respeta el interruptor del hilo', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'lib', 'instagram-agent', 'realtime.ts'),
    'utf8',
  )

  it('lee ai_enabled, la asignación y el cierre antes de contestar', () => {
    expect(src).toContain('comment_ia_apagada_en_el_hilo')
    expect(src).toContain('comment_asignado_a_persona')
    expect(src).toContain('comment_hilo_cerrado')
  })

  it('los tres motivos tienen política', () => {
    for (const motivo of [
      'comment_ia_apagada_en_el_hilo',
      'comment_asignado_a_persona',
      'comment_hilo_cerrado',
    ]) {
      expect(POLITICA, `${motivo} sin política`).toHaveProperty(motivo)
    }
  })

  it('ya nadie toma "la conversación más reciente, cualquier canal"', () => {
    // La forma exacta del bug: filtrar por contacto y ordenar por fecha sin
    // decir de qué canal.
    const bloques = src.split(/\.from\(\s*'conversations'\s*\)/)
    for (let i = 1; i < bloques.length; i++) {
      const bloque = bloques[i].split(/\.from\(/)[0]
      if (!/\.eq\(\s*'contact_id'/.test(bloque)) continue
      expect(
        /\.eq\(\s*'channel'/.test(bloque),
        'una consulta por contacto sin canal vuelve a poder agarrar el chat',
      ).toBe(true)
    }
  })
})

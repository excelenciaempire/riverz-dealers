import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Conversation } from '@/types'
import { esError, resolveCommentReplyTarget } from './comment-reply-target'

/**
 * Un comentario se contesta bajo el COMENTARIO, con la cuenta DUEÑA de ese
 * comentario. Ninguna de las dos cosas pasaba en los dos caminos de envío.
 */

/** Supabase de mentira: por tabla, una lista de respuestas en orden de consulta. */
function fakeDb(tablas: Record<string, unknown[]>): SupabaseClient {
  const pendientes: Record<string, unknown[]> = {}
  for (const [t, filas] of Object.entries(tablas)) pendientes[t] = [...filas]

  return {
    from(table: string) {
      const siguiente = () => {
        const cola = pendientes[table]
        if (!cola || cola.length === 0) return null
        return cola.shift() ?? null
      }
      const chain: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) => {
                const d = siguiente()
                return Promise.resolve({ data: Array.isArray(d) ? d : d ? [d] : [] }).then(
                  resolve,
                )
              }
            }
            if (prop === 'maybeSingle') {
              const d = siguiente()
              return () => Promise.resolve({ data: Array.isArray(d) ? (d[0] ?? null) : d })
            }
            return () => chain
          },
        },
      )
      return chain
    },
  } as unknown as SupabaseClient
}

const conv = (channel: string, extra: Record<string, unknown> = {}) =>
  ({
    id: 'conv-1',
    workspace_id: 'ws-1',
    channel,
    contact_id: 'contact-1',
    connection_id: 'conn-conversacion',
    thread_external_id: 'post-viejo-de-hace-un-anio',
    ...extra,
  }) as unknown as Conversation

describe('resolveCommentReplyTarget', () => {
  it('usa el comentario que eligió la persona', async () => {
    const db = fakeDb({
      messages: [{ id: 'msg-9', message_id: 'comment-9' }],
      comments_meta: [{ connection_id: 'conn-dueña' }],
      channel_connections: [{ id: 'conn-dueña', workspace_id: 'ws-1' }],
    })
    const r = await resolveCommentReplyTarget(db, {
      workspaceId: 'ws-1',
      conversation: conv('ig_comment'),
      pickedMessageId: 'msg-9',
    })
    expect(esError(r)).toBe(false)
    if (esError(r)) return
    expect(r.externalId).toBe('comment-9')
    expect(r.connection.id).toBe('conn-dueña')
  })

  it('sin elección, cae al último comentario DEL CLIENTE, nunca al post', async () => {
    const db = fakeDb({
      messages: [{ id: 'msg-3', message_id: 'comment-3' }],
      comments_meta: [null],
      channel_connections: [{ id: 'conn-conversacion', workspace_id: 'ws-1' }],
    })
    const r = await resolveCommentReplyTarget(db, {
      workspaceId: 'ws-1',
      conversation: conv('fb_comment'),
    })
    expect(esError(r)).toBe(false)
    if (esError(r)) return
    expect(r.externalId).toBe('comment-3')
    expect(r.externalId).not.toBe('post-viejo-de-hace-un-anio')
  })

  it('en fb/ig sin ningún comentario, falla en vez de publicar en el post', async () => {
    const db = fakeDb({ messages: [null] })
    for (const canal of ['fb_comment', 'ig_comment']) {
      const r = await resolveCommentReplyTarget(db, {
        workspaceId: 'ws-1',
        conversation: conv(canal),
      })
      expect(esError(r)).toBe(true)
      if (esError(r)) expect(r.error).toBe('sin_comentario_al_que_responder')
    }
  })

  it('en TikTok sí lee el comentario codificado en el hilo', async () => {
    const db = fakeDb({
      messages: [null],
      comments_meta: [null],
      channel_connections: [{ id: 'conn-tt', workspace_id: 'ws-1' }],
    })
    const r = await resolveCommentReplyTarget(db, {
      workspaceId: 'ws-1',
      conversation: conv('tiktok_comment', {
        thread_external_id: 'video:v-1|comment:c-77',
        connection_id: 'conn-tt',
      }),
    })
    expect(esError(r)).toBe(false)
    if (esError(r)) return
    expect(r.externalId).toBe('c-77')
  })

  it('prefiere la conexión de comments_meta sobre la de la conversación', async () => {
    const db = fakeDb({
      messages: [{ id: 'msg-1', message_id: 'comment-1' }],
      comments_meta: [{ connection_id: 'conn-pagina-B' }],
      channel_connections: [{ id: 'conn-pagina-B', workspace_id: 'ws-1' }],
    })
    const r = await resolveCommentReplyTarget(db, {
      workspaceId: 'ws-1',
      conversation: conv('fb_comment'),
    })
    expect(esError(r)).toBe(false)
    if (esError(r)) return
    expect(r.connection.id).toBe('conn-pagina-B')
  })

  it('no se llama sobre un canal que no es de comentarios', async () => {
    const r = await resolveCommentReplyTarget(fakeDb({}), {
      workspaceId: 'ws-1',
      conversation: conv('whatsapp'),
    })
    expect(esError(r) && r.error).toBe('no_es_comentario')
  })
})

describe('los adaptadores de comentarios ya no caen al id del post', () => {
  for (const canal of ['fb_comment', 'ig_comment']) {
    it(`${canal} exige el destino resuelto`, () => {
      const src = readFileSync(
        join(process.cwd(), 'src', 'lib', 'channels', canal, 'adapter.ts'),
        'utf8',
      )
      expect(
        src.includes('replyToExternalId ?? input.conversation.thread_external_id'),
        `${canal} volvió a caer al id del post: publicaría bajo la publicación equivocada`,
      ).toBe(false)
    })
  }
})

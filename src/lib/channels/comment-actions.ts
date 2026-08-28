/**
 * Moderar un comentario: ocultarlo, mostrarlo, borrarlo o darle me gusta.
 *
 * Vivía entero dentro de `/api/messages/moderate`, así que sólo existía para
 * quien estaba mirando la bandeja con el mouse en la mano. El Operador podía
 * ver los comentarios pendientes y no podía tocar ninguno.
 *
 * Acá está el cuerpo —qué llamada de Meta o de TikTok corresponde, sobre qué
 * conexión, y qué queda escrito de este lado— y la ruta pasó a ser lo que
 * tenía que ser: sesión, permiso y traducción del error.
 *
 * Lo que NO se movió: quién puede. La ruta exige admin del workspace; la
 * capacidad hereda el alcance de su contexto. El permiso es de quien llama.
 */
import { decrypt } from './encryption'
import { appsecretProof, withAppsecretProof } from './meta-graph'
import { COMMENT_DELETED_TEXT } from './display'
import { getFreshTikTokToken } from './tiktok_comment/adapter'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelConnection, Conversation, Message } from '@/types'

export type AccionComentario = 'hide' | 'unhide' | 'delete' | 'like' | 'unlike'

export const ACCIONES_COMENTARIO: AccionComentario[] = [
  'hide',
  'unhide',
  'delete',
  'like',
  'unlike',
]

export interface ResultadoModeracion {
  ok: boolean
  /** Cuerpo crudo del error, para que quien llama lo traduzca. */
  detail?: string
  /** Por qué no se pudo ni intentar: el mensaje no existe, no es un comentario… */
  motivo?: 'no_existe' | 'no_es_comentario' | 'sin_id_externo' | 'sin_conexion'
}

const GRAPH = 'https://graph.facebook.com/v21.0'
const TT_API = 'https://business-api.tiktok.com/open_api/v1.3'

/**
 * Modera el comentario `messageId` (el uuid de la fila, no el id de la red).
 *
 * Best-effort en la contabilidad y estricto en la llamada: si la red rechaza,
 * no se escribe nada de este lado. Al revés sería peor — la bandeja diría
 * "oculto" sobre un comentario que cualquiera sigue viendo.
 */
export async function moderarComentario(
  db: SupabaseClient,
  input: {
    workspaceId: string
    /** uuid de `messages`. */
    messageId: string
    accion: AccionComentario
    /** Quién lo pidió, cuando fue una persona. Queda en `hidden_by_user_id`. */
    actorUserId?: string | null
  },
): Promise<ResultadoModeracion> {
  const { data: message } = await db
    .from('messages')
    .select('*')
    .eq('id', input.messageId)
    .maybeSingle()
  if (!message) return { ok: false, motivo: 'no_existe' }
  const m = message as Message

  if (
    m.channel !== 'fb_comment' &&
    m.channel !== 'ig_comment' &&
    m.channel !== 'tiktok_comment'
  ) {
    return { ok: false, motivo: 'no_es_comentario' }
  }
  if (!m.message_id) return { ok: false, motivo: 'sin_id_externo' }

  const { data: convRow } = await db
    .from('conversations')
    .select('*')
    .eq('id', m.conversation_id)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (!convRow) return { ok: false, motivo: 'no_existe' }
  const conv = convRow as Conversation

  // La conexión DUEÑA del comentario (migración 117): quien comentó en dos
  // cuentas del mismo comercio colapsa en una conversación, que es de la
  // primera. El token de esa página no puede moderar el comentario de la otra.
  const { data: cmeta } = await db
    .from('comments_meta')
    .select('connection_id')
    .eq('message_id', m.id)
    .maybeSingle()
  const conexionId =
    (cmeta as { connection_id?: string | null } | null)?.connection_id ??
    conv.connection_id ??
    ''
  const { data: connRow } = await db
    .from('channel_connections')
    .select('*')
    .eq('id', conexionId)
    .maybeSingle()
  if (!connRow) return { ok: false, motivo: 'sin_conexion' }
  const conn = connRow as ChannelConnection

  let resultado: ResultadoModeracion
  if (m.channel === 'tiktok_comment') {
    // TikTok guarda "video:<id>|comment:<top>" en el hilo: ocultar necesita el
    // id del video y el business_id de la conexión.
    const cfg = (conn.config ?? {}) as Record<string, unknown>
    const businessId = String(cfg.business_id ?? '')
    const hilo = String(conv.thread_external_id ?? '')
    const videoId = hilo.startsWith('video:') ? hilo.slice(6).split('|')[0] : ''
    resultado = await accionEnTikTok(conn, businessId, videoId, m.message_id, input.accion)
  } else {
    const secrets = (conn.secrets ?? {}) as Record<string, unknown>
    const token = decrypt(String(secrets.access_token ?? ''))
    resultado = await accionEnGraph(m.channel, m.message_id, input.accion, token)
  }
  if (!resultado.ok) return resultado

  await anotarDeEsteLado(db, m.id, input.accion, input.actorUserId ?? null)
  return { ok: true }
}

/**
 * Lo mismo del lado de Riverz.
 *
 * Sin esto el estado vivía sólo en la red y la bandeja lo mostraba mal hasta
 * que pasara la conciliación, hasta diez minutos después — justo cuando el
 * comercio acaba de tocar el botón y viene a comprobar que quedó bien.
 */
async function anotarDeEsteLado(
  db: SupabaseClient,
  messageId: string,
  accion: AccionComentario,
  actorUserId: string | null,
): Promise<void> {
  const parche =
    accion === 'delete'
      ? { status: 'failed', content_text: COMMENT_DELETED_TEXT }
      : accion === 'hide'
        ? {
            is_hidden: true,
            // Quién lo ocultó (migración 212). 'persona' aunque venga del
            // Operador: detrás de una acción del chat hay siempre alguien que
            // la aprobó, y no es el filtro de spam.
            hidden_by: 'persona',
            hidden_by_user_id: actorUserId,
            hidden_reason: null,
            hidden_at: new Date().toISOString(),
          }
        : accion === 'unhide'
          ? {
              is_hidden: false,
              hidden_by: null,
              hidden_by_user_id: null,
              hidden_reason: null,
              hidden_at: null,
            }
          : { is_liked: accion === 'like' }

  const { error } = await db.from('messages').update(parche).eq('id', messageId)
  if (error) console.warn('[moderar] no se pudo anotar:', error.message)
}

/**
 * Modera un comentario de TikTok (Accounts API). Endpoints y valores del
 * parámetro `action` exactos según la doc oficial (mayúsculas):
 *   hide/unhide → /business/comment/hide/  action=HIDE|UNHIDE (+video_id)
 *   like/unlike → /business/comment/like/  action=LIKE|UNLIKE
 *   delete      → /business/comment/delete/ (sin action)
 * Todos requieren business_id + comment_id; hide además el video_id.
 */
export async function accionEnTikTok(
  connection: ChannelConnection,
  businessId: string,
  videoId: string,
  commentId: string,
  action: AccionComentario,
): Promise<ResultadoModeracion> {
  if (!businessId || !commentId) {
    return { ok: false, detail: 'missing business_id/comment_id' }
  }
  let token: string
  try {
    token = await getFreshTikTokToken(connection)
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'token error' }
  }
  const headers = { 'Access-Token': token, 'content-type': 'application/json' }

  const call = async (path: string, payload: Record<string, unknown>) => {
    const r = await fetch(`${TT_API}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string }
    if (!r.ok || (j.code ?? 0) !== 0) {
      return { ok: false, detail: `TikTok ${j.code ?? r.status}: ${j.message ?? ''}` }
    }
    return { ok: true }
  }

  const base = { business_id: businessId, comment_id: commentId }
  switch (action) {
    case 'hide':
      return call('/business/comment/hide/', { ...base, video_id: videoId, action: 'HIDE' })
    case 'unhide':
      return call('/business/comment/hide/', { ...base, video_id: videoId, action: 'UNHIDE' })
    case 'like':
      return call('/business/comment/like/', { ...base, action: 'LIKE' })
    case 'unlike':
      return call('/business/comment/like/', { ...base, action: 'UNLIKE' })
    case 'delete':
      return call('/business/comment/delete/', base)
    default:
      return { ok: false, detail: 'unknown action' }
  }
}

export async function accionEnGraph(
  channel: 'fb_comment' | 'ig_comment',
  commentId: string,
  action: AccionComentario,
  accessToken: string,
): Promise<ResultadoModeracion> {
  // La respuesta de Graph cambia según la acción y la versión —{"success":true},
  // el objeto actualizado, o un `true` pelado—. Así que NO se exige una marca
  // de éxito concreta (eso rechazaba ocultados de Facebook que sí habían
  // funcionado). Falla si no es 2xx o si el cuerpo trae un `error` explícito.
  const finish = async (r: Response): Promise<ResultadoModeracion> => {
    const text = await r.text().catch(() => '')
    if (!r.ok) return { ok: false, detail: text }
    try {
      const json = JSON.parse(text) as unknown
      if (json && typeof json === 'object' && (json as { error?: unknown }).error) {
        return { ok: false, detail: text }
      }
    } catch {
      /* 2xx que no es JSON (un `true` pelado) — cuenta como éxito */
    }
    return { ok: true }
  }
  try {
    if (action === 'delete') {
      const r = await fetch(
        withAppsecretProof(
          `${GRAPH}/${commentId}?access_token=${encodeURIComponent(accessToken)}`,
          accessToken,
        ),
        { method: 'DELETE' },
      )
      return finish(r)
    }
    if (action === 'hide' || action === 'unhide') {
      // Facebook oculta con `is_hidden`; Instagram con `hide`. Son campos
      // DISTINTOS: mandarle `is_hidden` a un comentario de Instagram se ignora
      // en silencio y la llamada devuelve 200 sin ocultar nada.
      const value = action === 'hide' ? 'true' : 'false'
      const body = new URLSearchParams(
        channel === 'ig_comment' ? { hide: value } : { is_hidden: value },
      )
      body.set('access_token', accessToken)
      const proof = appsecretProof(accessToken)
      if (proof) body.set('appsecret_proof', proof)
      const r = await fetch(`${GRAPH}/${commentId}`, { method: 'POST', body })
      return finish(r)
    }
    const url = withAppsecretProof(
      `${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(accessToken)}`,
      accessToken,
    )
    if (action === 'like') return finish(await fetch(url, { method: 'POST' }))
    if (action === 'unlike') return finish(await fetch(url, { method: 'DELETE' }))
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'unknown error' }
  }
  return { ok: false, detail: 'unknown action' }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelConnection, Contact, Conversation } from '@/types'
import { getAdapter } from '@/lib/channels/registry'

/**
 * "¿Te sirvió?", fuera del chat web (migración 202).
 *
 * Las columnas de satisfacción existen desde la migración 181 y las escribía UN
 * solo lugar: el widget. En WhatsApp, Instagram, Messenger y el correo —donde
 * pasa la mayoría de las conversaciones— nunca se le preguntó nada a nadie, así
 * que el número del panel medía un canal y se leía como si midiera la atención
 * entera.
 *
 * Tres decisiones que explican la forma:
 *
 * 1. **Apagado por defecto.** Es un mensaje extra a cada cliente al cerrar el
 *    caso, y en WhatsApp se paga. Que lo encienda quien lo quiera medir.
 *
 * 2. **Una pregunta cerrada, no una escala.** "Responde 1 o 2" lo contesta
 *    cualquiera desde el teléfono; una escala del 1 al 5 por chat baja la
 *    respuesta a la nada y encima obliga a explicar qué significa cada número.
 *
 * 3. **La respuesta llega en un hilo NUEVO.** Cerrar la conversación impide
 *    reusarla, así que quien contesta "1" abre otra. Por eso la calificación se
 *    busca por CONTACTO entre las que preguntaron hace poco y no tienen nota,
 *    y no por conversación.
 */

/** Canales donde tiene sentido preguntar: los que son una conversación 1 a 1. */
const CANALES = new Set(['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook'])

/** Cuánto vale una pregunta. Pasado eso, un "1" vuelve a ser un mensaje normal. */
const VENTANA_RESPUESTA_MS = 48 * 60 * 60 * 1000

/** Cada cuánto, como mucho, se le puede preguntar a la misma persona. */
const DESCANSO_MS = 7 * 24 * 60 * 60 * 1000

/** La ventana de servicio de Meta. Fuera de ella no se puede escribir libre. */
const VENTANA_META_MS = 24 * 60 * 60 * 1000

const TEXTO: Record<string, string> = {
  es: '¿Te sirvió la ayuda? Responde 1 si sí, 2 si no.',
  en: 'Did this help? Reply 1 for yes, 2 for no.',
  pt: 'A ajuda serviu? Responda 1 para sim, 2 para não.',
}

/**
 * Lee una calificación de lo que escribió la persona.
 *
 * Se acepta el número, el sí/no y el pulgar, y nada más: cualquier otra cosa es
 * una consulta nueva y tiene que llegarle al agente. Devuelve `null` cuando no
 * es una calificación, que es el caso normal.
 */
export function leerCalificacion(texto: string): 1 | -1 | null {
  const t = (texto ?? '').trim().toLowerCase().replace(/[.!¡]/g, '')
  if (!t || t.length > 12) return null
  if (t === '1' || t === 'si' || t === 'sí' || t === 'yes' || t === '👍' || t === 'sim') {
    return 1
  }
  if (t === '2' || t === 'no' || t === '👎' || t === 'nao' || t === 'não') return -1
  return null
}

/**
 * ¿Este mensaje es la respuesta a una encuesta que mandamos?
 *
 * Devuelve el id de la conversación calificada, o `null`. Nunca tira: que esto
 * falle no puede impedir que el agente conteste.
 */
export async function registrarCalificacion(
  db: SupabaseClient,
  args: { workspaceId: string; contactId: string; texto: string },
): Promise<string | null> {
  const nota = leerCalificacion(args.texto)
  if (nota === null) return null
  try {
    const desde = new Date(Date.now() - VENTANA_RESPUESTA_MS).toISOString()
    const { data } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', args.workspaceId)
      .eq('contact_id', args.contactId)
      .not('csat_asked_at', 'is', null)
      .is('csat', null)
      .gte('csat_asked_at', desde)
      .order('csat_asked_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const fila = data as { id: string } | null
    if (!fila) return null
    await db
      .from('conversations')
      .update({ csat: nota, csat_at: new Date().toISOString() })
      .eq('id', fila.id)
    return fila.id
  } catch {
    return null
  }
}

/**
 * Pregunta si sirvió, al cerrar.
 *
 * Best-effort de punta a punta: cerrar una conversación no puede fallar porque
 * la encuesta no salió. Devuelve si se preguntó, sólo para poder contarlo.
 */
export async function pedirOpinion(
  db: SupabaseClient,
  args: { workspaceId: string; conversationId: string },
): Promise<boolean> {
  try {
    const { data: ws } = await db
      .from('workspaces')
      .select('csat_enabled')
      .eq('id', args.workspaceId)
      .maybeSingle()
    if (!(ws as { csat_enabled?: boolean } | null)?.csat_enabled) return false

    const { data: convRow } = await db
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', args.conversationId)
      .eq('workspace_id', args.workspaceId)
      .maybeSingle()
    const conversation = convRow as (Conversation & { contact?: Contact }) | null
    if (!conversation?.contact) return false
    if (!CANALES.has(conversation.channel)) return false
    // Ya se preguntó, o ya calificó. Insistir es la forma más rápida de que la
    // próxima encuesta la ignoren.
    if (conversation.csat_asked_at || conversation.csat != null) return false

    // Descanso por persona: quien escribe cuatro veces en una semana no recibe
    // cuatro encuestas.
    const { data: reciente } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', args.workspaceId)
      .eq('contact_id', conversation.contact_id)
      .gte('csat_asked_at', new Date(Date.now() - DESCANSO_MS).toISOString())
      .limit(1)
      .maybeSingle()
    if (reciente) return false

    // La ventana de servicio de Meta. Fuera de ella el envío falla —y en
    // WhatsApp, una plantilla para preguntar esto no vale lo que cuesta.
    if (conversation.channel !== 'gmail' && conversation.channel !== 'outlook') {
      const { data: ultimo } = await db
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const at = Date.parse((ultimo as { created_at?: string } | null)?.created_at ?? '')
      if (!Number.isFinite(at) || Date.now() - at > VENTANA_META_MS) return false
    }

    const { data: connRow } = await db
      .from('channel_connections')
      .select('*')
      .eq('id', conversation.connection_id ?? '')
      .maybeSingle()
    const connection = connRow as ChannelConnection | null
    if (!connection) return false

    // En el idioma en que se le viene hablando, que es el del agente.
    const { data: agente } = await db
      .from('ai_agents')
      .select('language')
      .eq('workspace_id', args.workspaceId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    const idioma = ((agente as { language?: string } | null)?.language ?? 'es')
      .toLowerCase()
      .slice(0, 2)
    const text = TEXTO[idioma] ?? TEXTO.es

    const adapter = getAdapter(conversation.channel)
    const enviado = await adapter.sendText({
      channel: conversation.channel,
      connection,
      conversation,
      contact: conversation.contact,
      text,
    })

    const ahora = new Date().toISOString()
    await db.from('messages').insert({
      conversation_id: conversation.id,
      channel: conversation.channel,
      sender_type: 'bot',
      content_type: 'text',
      content_text: text,
      message_id: enviado.externalMessageId,
      status: enviado.status ?? 'sent',
      origin: 'csat',
    })
    await db
      .from('conversations')
      .update({ csat_asked_at: ahora })
      .eq('id', conversation.id)
    return true
  } catch (err) {
    console.error('[csat] no se pudo preguntar:', err)
    return false
  }
}

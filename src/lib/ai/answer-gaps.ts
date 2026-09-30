import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

/**
 * Lo que el agente no supo contestar.
 *
 * Es la mitad del valor de tener un agente: las preguntas donde falla son el
 * próximo pedazo de conocimiento que hay que cargarle. Hasta acá se perdían —
 * la conversación quedaba marcada para una persona, el caso se resolvía a mano,
 * y la PREGUNTA no quedaba en ningún lado. Así se arregla el caso y nunca el
 * agujero, y la misma pregunta vuelve la semana que viene.
 *
 * **La escribe el propio agente, no un detector.** Mirar su texto no sirve: un
 * modelo que dice "no tengo esa información" y otro que improvisa una respuesta
 * plausible se leen igual desde afuera, y el segundo es justamente el que hay
 * que cazar. Por eso es una herramienta que se le ofrece siempre y que el
 * prompt le pide usar antes de inventar.
 */

export interface HuecoCtx {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  conversationId?: string | null
  agentId?: string | null
  channel?: string | null
}

/**
 * La forma en que se agrupan las repetidas.
 *
 * Sin esto, "¿Hacen envíos?", "hacen envios" y "HACEN ENVIOS?" son tres huecos
 * distintos y la pantalla no muestra lo único que importa: que es LA pregunta
 * que el agente no sabe contestar.
 */
export function claveDePregunta(texto: string): string {
  const normalized = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length<=200 ? normalized : `${normalized.slice(0,167)} ${createHash('sha256').update(normalized).digest('hex').slice(0,32)}`
}

export async function registrarHueco(
  ctx: HuecoCtx,
  input: { pregunta?: string; falta?: string },
): Promise<string> {
  const pregunta = typeof input.pregunta==='string' ? input.pregunta.trim().slice(0,500) : ''
  const falta = typeof input.falta==='string' ? input.falta.trim().slice(0,300) : ''
  if (pregunta.length < 3 || !claveDePregunta(pregunta)) {
    return JSON.stringify({
      ok: false,
      message: 'Di cuál fue la pregunta que no pudiste contestar.',
    })
  }

  const { error } = await ctx.db.from('answer_gaps').insert({
    workspace_id: ctx.workspaceId,
    conversation_id: ctx.conversationId ?? null,
    contact_id: ctx.contactId,
    agent_id: ctx.agentId ?? null,
    channel: ctx.channel ?? null,
    question: pregunta,
    question_key: claveDePregunta(pregunta),
    missing: falta || null,
  })
  if (error) {
    console.error('[huecos] no se pudo anotar la pregunta')
    return JSON.stringify({ ok:false,message:'No se pudo guardar la pregunta. No afirmes que quedó anotada ni inventes una respuesta.' })
  }

  // Y se le pasa a una persona. Anotar el hueco sin traspasar dejaría a la
  // clienta esperando una respuesta que el agente ya dijo que no tiene.
  if (ctx.conversationId) {
    const handoff=await ctx.db
      .from('conversations')
      .update({
        status: 'pending',
        needs_human_reason: 'answer_gap',
        needs_human_at: new Date().toISOString(),
        // Lo que necesita quien recibe el hilo: la pregunta exacta y qué dato
        // dijo que le faltaba. Sin esto tenía que leer la conversación entera
        // para descubrir en qué se trabó (migración 201).
        needs_human_summary: [
          `Preguntó: "${pregunta.slice(0, 240)}"`,
          falta ? `Le faltaba: ${falta.slice(0,240)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      })
      .eq('id', ctx.conversationId)
      .eq('workspace_id', ctx.workspaceId)
      .select('id')
      .maybeSingle()
    if (handoff.error || !handoff.data) return JSON.stringify({ ok:true,handoff_confirmed:false,message:'La pregunta quedó guardada, pero no se confirmó el traspaso al equipo. No prometas que alguien ya la recibió ni una fecha de respuesta.' })
  }

  return JSON.stringify({
    ok: true,
    message:
      'Quedó anotado y el equipo lo va a ver. Dile con honestidad que eso no lo sabes y que le confirman en un rato. ' +
      'NO inventes una respuesta aproximada ni le prometas una fecha.',
  })
}

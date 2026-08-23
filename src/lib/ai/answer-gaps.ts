import type { SupabaseClient } from '@supabase/supabase-js'

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
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export async function registrarHueco(
  ctx: HuecoCtx,
  input: { pregunta?: string; falta?: string },
): Promise<string> {
  const pregunta = (input.pregunta ?? '').trim().slice(0, 500)
  if (pregunta.length < 3) {
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
    missing: (input.falta ?? '').trim().slice(0, 300) || null,
  })
  if (error) {
    console.error('[huecos] no se pudo anotar:', error.message)
  }

  // Y se le pasa a una persona. Anotar el hueco sin traspasar dejaría a la
  // clienta esperando una respuesta que el agente ya dijo que no tiene.
  if (ctx.conversationId) {
    await ctx.db
      .from('conversations')
      .update({
        status: 'pending',
        needs_human_reason: 'answer_gap',
        needs_human_at: new Date().toISOString(),
      })
      .eq('id', ctx.conversationId)
      .eq('workspace_id', ctx.workspaceId)
  }

  return JSON.stringify({
    ok: true,
    message:
      'Quedó anotado y el equipo lo va a ver. Dile con honestidad que eso no lo sabes y que le confirman en un rato. ' +
      'NO inventes una respuesta aproximada ni le prometas una fecha.',
  })
}

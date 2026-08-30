import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El hilo de COMENTARIOS de una persona en UNA red.
 *
 * Existe porque los dos sitios que escribían sobre "la conversación de este
 * contacto" tomaban *la más reciente de cualquier canal*. Alguien que ya venía
 * hablando por WhatsApp y además comentaba en Instagram tenía su hilo de
 * WhatsApp como el más reciente — así que un "quiero hablar con una persona"
 * escrito debajo de un post terminaba escalando el chat de WhatsApp y, con
 * `POLITICA.comment_pide_humano`, apagándole la IA a un canal donde el cliente
 * nunca se quejó. Uno de los dos ni siquiera filtraba por workspace.
 *
 * Devuelve además el estado que el piso autónomo tiene que mirar antes de
 * contestar: si el comercio apagó la IA en ese hilo, se lo asignó a alguien o
 * lo cerró, no se contesta. Sin esto el escalado era de ida y sin vuelta —
 * `aplicarDesenlace` apagaba `ai_enabled` y el camino de comentarios no lo
 * leía nunca.
 */

export type CommentChannel = 'ig_comment' | 'fb_comment' | 'tiktok_comment'

export interface HiloDeComentarios {
  id: string
  ai_enabled: boolean | null
  assigned_agent_id: string | null
  status: string | null
}

export async function loadCommentConversation(
  db: SupabaseClient,
  input: { workspaceId: string; contactId: string; channel: CommentChannel },
): Promise<HiloDeComentarios | null> {
  const { data } = await db
    .from('conversations')
    .select('id, ai_enabled, assigned_agent_id, status')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .eq('channel', input.channel)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as HiloDeComentarios | null) ?? null
}

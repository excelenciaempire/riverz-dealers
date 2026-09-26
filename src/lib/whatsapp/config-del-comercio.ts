import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * La copia de WhatsApp (whatsapp_config) con la que envían automatizaciones,
 * flujos, difusiones y plantillas. Es una por comercio: se busca por el
 * comercio y nunca por el dueño, porque un dueño con dos comercios tiene dos
 * números y leer por dueño mandaba los mensajes de uno por el número del otro.
 * Sin comercio a mano (rutas viejas) se usa la última del usuario.
 */
export async function leerConfigWhatsApp<T = Record<string, unknown>>(
  db: SupabaseClient,
  args: { workspaceId?: string | null; userId?: string | null; campos?: string },
): Promise<T | null> {
  const campos = args.campos ?? '*'
  if (args.workspaceId) {
    const { data } = await db
      .from('whatsapp_config')
      .select(campos)
      .eq('workspace_id', args.workspaceId)
      .eq('status', 'connected')
      .maybeSingle()
    return (data as T | null) ?? null
  }
  if (!args.userId) return null
  const { data } = await db
    .from('whatsapp_config')
    .select(campos)
    .eq('user_id', args.userId)
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as T | null) ?? null
}

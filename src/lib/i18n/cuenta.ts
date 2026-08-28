import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_LOCALE, isLocale, type Locale } from './config'

/**
 * En qué idioma le habla Riverz a un comercio, fuera de una petición.
 *
 * El idioma de la interfaz vive en una cookie del navegador, y eso alcanza
 * mientras la persona está mirando la pantalla. No alcanza para lo que sale sin
 * que nadie esté: el WhatsApp de "te quedaste sin saldo", el de "no pudimos
 * cobrar tu plan". Esos se escriben desde un cron, donde no hay cookie ni
 * navegador ni nadie a quien preguntarle.
 *
 * El orden es el de la señal más fuerte a la más débil:
 *
 * 1. **El idioma que eligió el dueño** (`profiles.locale`, que la app
 *    sincroniza desde la cookie justamente para esto).
 * 2. **El de cualquier miembro** que sí lo haya elegido. Un equipo que trabaja
 *    en inglés no tiene por qué recibir avisos en español porque el dueño nunca
 *    tocó el selector.
 * 3. **El idioma en que habla su agente.** Es lo que el comercio configuró para
 *    hablarle a SUS clientes: no es su idioma necesariamente, pero es una pista
 *    mucho mejor que el default.
 * 4. El default.
 */
export async function localeDeCuenta(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Locale> {
  try {
    const { data: ws } = await db
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    const ownerId = (ws as { owner_id?: string | null } | null)?.owner_id ?? null

    const { data: miembros } = await db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
    const ids = ((miembros ?? []) as { user_id: string }[]).map((m) => m.user_id)
    if (ownerId && !ids.includes(ownerId)) ids.push(ownerId)

    if (ids.length > 0) {
      const { data: perfiles } = await db
        .from('profiles')
        .select('user_id, locale')
        .in('user_id', ids)
        .not('locale', 'is', null)
      const filas = (perfiles ?? []) as { user_id: string; locale: string }[]
      const delDuenio = filas.find((p) => p.user_id === ownerId)?.locale
      if (isLocale(delDuenio)) return delDuenio
      const deAlguien = filas.find((p) => isLocale(p.locale))?.locale
      if (isLocale(deAlguien)) return deAlguien
    }

    const { data: agente } = await db
      .from('ai_agents')
      .select('language')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .not('language', 'is', null)
      .limit(1)
      .maybeSingle()
    const idioma = (agente as { language?: string | null } | null)?.language
    if (isLocale(idioma)) return idioma

    return DEFAULT_LOCALE
  } catch {
    // Un error leyendo el idioma no puede impedir que el aviso salga: se manda
    // en el idioma por defecto, que es infinitamente mejor que no mandarlo.
    return DEFAULT_LOCALE
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverWabaYToken } from '@/lib/templates/create'
import { deleteMessageTemplate } from '@/lib/whatsapp/meta-api'

/**
 * Borrar una plantilla — también de Meta.
 *
 * El orden importa: **primero Meta, después la fila**. Al revés, un fallo de
 * Meta deja la plantilla viva allá y muerta acá, y el siguiente «Sincronizar»
 * la trae de vuelta. Si Meta falla, la fila se queda y se dice por qué. Un
 * borrador nunca llegó a Meta: ahí no hay nada que borrar del otro lado.
 */
export interface PlantillaABorrar {
  id: string
  name: string
  status: string | null
  meta_template_id: string | null
}

export type ResultadoDeBorrar =
  | { ok: true; enMeta: boolean }
  | { ok: false; motivo: 'sin_whatsapp' | 'meta' | 'base'; detalle?: string }

export async function borrarPlantilla(
  db: SupabaseClient,
  args: { workspaceId: string; userId: string; plantilla: PlantillaABorrar },
): Promise<ResultadoDeBorrar> {
  const { workspaceId, userId, plantilla } = args
  const estaEnMeta = Boolean(plantilla.meta_template_id) || plantilla.status !== 'Draft'

  if (estaEnMeta) {
    const { wabaId, accessToken } = await resolverWabaYToken(db, workspaceId, userId)
    if (!wabaId || !accessToken) return { ok: false, motivo: 'sin_whatsapp' }
    try {
      await deleteMessageTemplate({
        wabaId,
        accessToken,
        name: plantilla.name,
        // Con el id se borra SÓLO este idioma. Sin él, Meta se lleva todas las
        // versiones del nombre.
        hsmId: plantilla.meta_template_id ?? undefined,
      })
    } catch (err) {
      const detalle = err instanceof Error ? err.message : ''
      // Que Meta no la encuentre es el final que se buscaba.
      if (!pareceQueYaNoEsta(detalle)) return { ok: false, motivo: 'meta', detalle }
    }
  }

  const { error } = await db
    .from('message_templates')
    .delete()
    .eq('id', plantilla.id)
    .eq('workspace_id', workspaceId)
  if (error) return { ok: false, motivo: 'base' }
  return { ok: true, enMeta: estaEnMeta }
}

/**
 * ¿Meta está diciendo que esa plantilla ya no existe? No hay un código propio:
 * contesta el 100 genérico con el texto adentro. Un falso positivo sólo borra
 * una fila local que igual iba a borrarse.
 */
function pareceQueYaNoEsta(motivo: string): boolean {
  const m = motivo.toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('no existe') ||
    m.includes('not found') ||
    m.includes('unsupported get request') ||
    m.includes('cannot be found')
  )
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TemplateButtonInput } from '@/lib/whatsapp/template-components'
import { crearPlantilla, type ResultadoCrearPlantilla } from './create'

/** Una plantilla guardada como borrador, tal como está en `message_templates`. */
export interface BorradorGuardado {
  id: string
  name: string
  language: string
  category: string | null
  user_id: string | null
  header_type: string | null
  header_content: string | null
  body_text: string
  footer_text: string | null
  buttons: unknown
  variable_samples: string[] | null
  variable_fields: Record<string, string> | null
}

export const COLUMNAS_DE_BORRADOR =
  'id, name, language, category, user_id, header_type, header_content, body_text, footer_text, buttons, variable_samples, variable_fields, status'

/**
 * Manda a aprobación de Meta un borrador que ya está escrito, pisando su fila.
 *
 * Los botones se pasan como están guardados; el dinámico (carrito,
 * seguimiento) conserva `url_variable` y Meta recibe el dominio con `{{1}}`.
 */
export async function enviarBorradorAMeta(
  db: SupabaseClient,
  args: { workspaceId: string; userId: string | null; fila: BorradorGuardado }
): Promise<ResultadoCrearPlantilla> {
  const { fila } = args
  const botones: TemplateButtonInput[] = (Array.isArray(fila.buttons) ? fila.buttons : []).map((b) => {
    const x = (b ?? {}) as Record<string, unknown>
    const tipo = String(x.type ?? 'QUICK_REPLY').toUpperCase()
    return {
      type: (tipo === 'URL' || tipo === 'PHONE_NUMBER' ? tipo : 'QUICK_REPLY') as TemplateButtonInput['type'],
      text: String(x.text ?? '').trim(),
      url: typeof x.url === 'string' ? x.url : undefined,
      phone_number: typeof x.phone_number === 'string' ? x.phone_number : undefined,
      url_variable: (x.url_variable ?? undefined) as TemplateButtonInput['url_variable'],
    }
  })
  return crearPlantilla(db, {
    workspaceId: args.workspaceId,
    userId: fila.user_id ?? args.userId,
    nombre: fila.name,
    idioma: fila.language,
    categoria: (fila.category ?? 'Marketing').toUpperCase(),
    headerType: (fila.header_type as 'text' | undefined) ?? 'none',
    headerText: fila.header_content ?? undefined,
    bodyText: fila.body_text,
    footerText: fila.footer_text ?? undefined,
    buttons: botones,
    bodySamples: fila.variable_samples ?? undefined,
    variableFields: fila.variable_fields,
    plantillaExistenteId: fila.id,
  })
}

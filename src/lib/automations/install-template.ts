/**
 * Instalar una receta en una cuenta.
 *
 * Estaba dentro del route handler de la galería, mezclada con la resolución de
 * sesión y de workspace. El Operator necesita exactamente el mismo trabajo —
 * crear la fila y su árbol de pasos, y limpiar si el árbol falla— sin nada de
 * lo otro, así que la parte que es negocio vive acá y la parte que es HTTP se
 * queda en el route.
 *
 * Siempre nace PAUSADA. Las recetas dejan el nombre de la plantilla y la
 * etiqueta en blanco a propósito, así que activarla sin completarla no pasaría
 * la validación igual; nacer pausada hace que eso sea un paso consciente y no
 * un error.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTemplate, automationTemplateNameKey, automationTemplateDescKey } from './templates'
import { insertSteps, type BuilderStepInput } from './steps-tree'
import { resolverEtiquetas } from './resolve-tag-seeds'
import { translate } from '@/lib/i18n/translate'
import type { Locale } from '@/lib/i18n/config'
import { installRetentionPackage } from './install-retention'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'

export interface InstalledAutomation {
  id: string
  name: string
  trigger_type: string
  is_active: boolean
}

export async function installTemplate(
  db: SupabaseClient,
  args: {
    templateId: string
    workspaceId: string
    /** Dueño de la fila. Puede faltar cuando la crea un proceso y no una persona. */
    userId?: string | null
    locale: Locale
  },
): Promise<InstalledAutomation> {
  const template = getTemplate(args.templateId, args.locale)
  if (!template) throw new Error(`no existe la receta "${args.templateId}"`)

  // `automations.user_id` es NOT NULL, y quien instala no siempre es una
  // persona: puede ser el Operator o la activación guiada. En ese caso la fila
  // queda a nombre del dueño de la cuenta, que es de quien es la automatización
  // igual. Sin esto, instalar una receta sin sesión falla con un error de
  // restricción que no dice nada.
  const userId = args.userId ?? (await resolveWorkspaceOwnerUserId(db, args.workspaceId))
  if (!userId) throw new Error('esta cuenta no tiene dueño: no se puede crear la automatización')

  if (args.templateId === 'postventa-reposicion' || args.templateId === 'postventa-acompanamiento') {
    const replenishment = args.templateId === 'postventa-reposicion'
    const pack = await installRetentionPackage(db, {
      workspaceId: args.workspaceId, userId, locale: args.locale,
      product: args.locale === 'en' ? 'your product' : 'tu producto',
      offers: replenishment ? [{ units: 1, day: 22, label: args.locale === 'en' ? '1 unit' : '1 unidad' }] : [],
      requireProductSelection: true,
    })
    const main = pack.automations.find(a => a.trigger_type === 'shopify_order_delivered')
    if (!main) throw new Error('Retention package has no delivery workflow')
    return main
  }

  const { data, error } = await db
    .from('automations')
    .insert({
      user_id: userId,
      workspace_id: args.workspaceId,
      name: translate(args.locale, automationTemplateNameKey(template.slug)),
      description: translate(args.locale, automationTemplateDescKey(template.slug)),
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config ?? {},
      is_active: false,
    })
    .select('id, name, trigger_type, is_active')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'no se pudo crear la automatización')
  const automation = data as InstalledAutomation

  if (template.steps.length > 0) {
    const err = await insertSteps(
      automation.id,
      await resolverEtiquetas(
        db,
        args.workspaceId,
        template.steps as unknown as BuilderStepInput[],
      ),
    )
    if (err) {
      // Sin esto queda una automatización vacía, que es peor que ninguna: se
      // ve en la lista, no hace nada y nadie sabe por qué está.
      await db.from('automations').delete().eq('id', automation.id)
      throw new Error(err)
    }
  }

  return automation
}

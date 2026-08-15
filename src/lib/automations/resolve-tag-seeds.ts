import { ensureTag } from '@/lib/contacts/tags'
import type { supabaseAdmin } from './admin-client'
import type { BuilderStepInput } from './steps-tree'

/**
 * Cambia los `tag_name` de una receta por ids reales del workspace.
 *
 * `add_tag` sólo entiende `tag_id`, y una receta no puede traer el id de una
 * etiqueta de un workspace que todavía no existe. Sin esto, el rescate de
 * carrito llega con DOS selectores de etiqueta vacíos e indistinguibles entre
 * sí, y no se puede activar hasta que alguien les invente nombre a las dos.
 *
 * Corre en el guardado —no en la instalación— porque el camino vivo de la
 * galería no pasa por ningún endpoint de instalación: la tarjeta abre una
 * vista previa en el constructor y lo que se guarda es un árbol común y
 * corriente. El `tag_name` viaja dentro de `step_config`, que nadie toca de
 * punta a punta.
 *
 * Sólo rellena huecos: un `tag_id` ya elegido no se pisa nunca. Si la etiqueta
 * no se puede crear, el hueco queda vacío y `validate.ts` frena la activación
 * con el mensaje de siempre — nunca se cuela un id inválido.
 */
export async function resolverEtiquetas(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  steps: BuilderStepInput[],
  cache: Map<string, string> = new Map(),
): Promise<BuilderStepInput[]> {
  const out: BuilderStepInput[] = []
  for (const s of steps) {
    const cfg = (s.step_config ?? {}) as Record<string, unknown>
    const nombre = typeof cfg.tag_name === 'string' ? cfg.tag_name.trim() : ''
    const yaTiene = typeof cfg.tag_id === 'string' && cfg.tag_id.length > 0

    let paso = s
    if ((s.step_type === 'add_tag' || s.step_type === 'remove_tag') && nombre && !yaTiene) {
      const id = await ensureTag(admin, workspaceId, nombre, { cache })
      if (id) paso = { ...s, step_config: { ...cfg, tag_id: id } }
    }

    if (paso.branches) {
      paso = {
        ...paso,
        branches: {
          yes: await resolverEtiquetas(admin, workspaceId, paso.branches.yes ?? [], cache),
          no: await resolverEtiquetas(admin, workspaceId, paso.branches.no ?? [], cache),
        },
      }
    }
    out.push(paso)
  }
  return out
}

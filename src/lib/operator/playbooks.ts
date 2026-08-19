/**
 * Los tres objetivos con los que arranca un comercio.
 *
 * No son "funcionalidades": son problemas. Nadie se levanta queriendo activar
 * una automatización de carrito abandonado; se levanta queriendo dejar de
 * perder ventas. Cada playbook agrupa el agente y las recetas que resuelven UN
 * problema, y por eso la activación puede preguntar una sola cosa.
 *
 * Son deliberadamente tres. Con ocho, elegir vuelve a ser trabajo del comercio,
 * que es justo lo que esto viene a sacarle de encima.
 */
import { ROLE_TEMPLATES } from '@/lib/ai/role-templates'
import type { AgentRole } from '@/lib/ai/roles'
import type { TemplateSlug } from '@/lib/automations/templates'

export type PlaybookKey = 'postventa' | 'recuperacion' | 'ventas'

export interface Playbook {
  key: PlaybookKey
  /** Claves i18n (namespace operation). */
  titleKey: string
  whatKey: string
  role: AgentRole
  recipes: TemplateSlug[]
}

export const PLAYBOOKS: Playbook[] = [
  {
    key: 'postventa',
    titleKey: 'operation.pbAftersaleTitle',
    whatKey: 'operation.pbAftersaleWhat',
    role: 'postventa',
    recipes: ROLE_TEMPLATES.postventa.recipes,
  },
  {
    key: 'recuperacion',
    titleKey: 'operation.pbRecoveryTitle',
    whatKey: 'operation.pbRecoveryWhat',
    role: 'recuperacion',
    recipes: ROLE_TEMPLATES.recuperacion.recipes,
  },
  {
    key: 'ventas',
    titleKey: 'operation.pbSalesTitle',
    whatKey: 'operation.pbSalesWhat',
    role: 'ventas',
    // El de ventas no trae recetas propias en su rol: lo que lo acompaña es la
    // recompra, que es lo que convierte una venta suelta en un cliente.
    recipes: ['recompras'],
  },
]

export function playbook(key: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.key === key)
}

export interface ActivationPlan {
  agentes: { rol: AgentRole; permisos: Record<string, boolean> }[]
  recetas: TemplateSlug[]
}

/**
 * Qué se va a crear con los objetivos elegidos.
 *
 * Las recetas se deduplican: "postventa" y "recuperación" comparten ninguna hoy,
 * pero elegir dos objetivos que pidan la misma receta no puede crear la
 * automatización dos veces.
 *
 * Vive acá y no en el route handler porque es lo mismo que se muestra y lo que
 * se ejecuta: si el navegador armara la lista, se mostraría una cosa y se haría
 * otra.
 */
export function planFor(keys: string[]): ActivationPlan {
  const agentes: ActivationPlan['agentes'] = []
  const recetas = new Set<TemplateSlug>()
  for (const k of keys) {
    const p = playbook(k)
    if (!p) continue
    const preset = p.role === 'general' ? null : ROLE_TEMPLATES[p.role]
    agentes.push({
      rol: p.role,
      permisos: (preset?.permissions ?? {}) as Record<string, boolean>,
    })
    for (const r of p.recipes) recetas.add(r)
  }
  return { agentes, recetas: [...recetas] }
}

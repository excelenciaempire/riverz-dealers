/**
 * Automatizaciones: verlas, prenderlas, ajustarlas y crearlas desde una receta.
 *
 * Prender pasa por `assertActivable`, la misma puerta que usa el editor. Antes
 * el MCP hacía el UPDATE directo y se saltaba la validación: se podía dejar
 * activa una automatización a la que le faltaba el nombre de la plantilla, y el
 * resultado era una corrida fallida por cada disparo, en silencio.
 */
import { assertActivable, activationIssuesById } from '@/lib/automations/activation'
import { installTemplate } from '@/lib/automations/install-template'
import {
  AI_STEPS_SCHEMA,
  AI_TRIGGERS,
  artefactoDePlan,
  planDesdeIA,
  type AiPaso,
} from '@/lib/automations/ai-steps'
import { insertSteps } from '@/lib/automations/steps-tree'
import { resolverEtiquetas } from '@/lib/automations/resolve-tag-seeds'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import {
  AUTOMATION_TEMPLATES,
  TEMPLATE_GALLERY_ORDER,
  automationTemplateNameKey,
  type TemplateSlug,
} from '@/lib/automations/templates'
import { translate } from '@/lib/i18n/translate'
import type { Capability, CapabilityContext } from './types'

async function listar(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('automations')
    .select(
      'id, name, description, trigger_type, is_active, execution_count, last_executed_at, created_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  return data ?? []
}

async function activar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.automation_id)
  const activa = Boolean(args.activa)

  // Sólo al PRENDER: un borrador puede estar incompleto, y pausar algo roto
  // tiene que poder hacerse siempre.
  if (activa) await assertActivable(ctx.db, id, ctx.workspaceId)

  const { data, error } = await ctx.db
    .from('automations')
    .update({ is_active: activa })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .select('id, name, is_active')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('esa automatización no existe en esta cuenta')
  return data
}

async function editarEspera(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { data: paso } = await ctx.db
    .from('automation_steps')
    .select('id, automation_id, step_type, automations!inner(workspace_id)')
    .eq('id', String(args.step_id))
    .maybeSingle()
  const fila = paso as
    | { id: string; step_type: string; automations?: { workspace_id?: string } }
    | null
  if (!fila) throw new Error('ese paso no existe')
  if (fila.automations?.workspace_id !== ctx.workspaceId) {
    throw new Error('ese paso es de otra cuenta')
  }
  if (fila.step_type !== 'wait') throw new Error('ese paso no es una espera')

  const { data, error } = await ctx.db
    .from('automation_steps')
    .update({ step_config: { amount: Number(args.amount), unit: String(args.unit) } })
    .eq('id', fila.id)
    .select('id, step_config')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function recetas(ctx: CapabilityContext) {
  const locale = ctx.locale ?? 'es'
  return TEMPLATE_GALLERY_ORDER.map((slug) => {
    const t = AUTOMATION_TEMPLATES[slug]
    return {
      receta: slug,
      nombre: translate(locale, automationTemplateNameKey(slug)),
      disparador: t.trigger_type,
      pasarela_requerida: t.requiresGateway ?? null,
    }
  })
}

/**
 * Una automatización armada desde cero.
 *
 * Las recetas cubren los siete casos que se repiten en todas las tiendas; esto
 * es para el octavo, el que es de este comercio y de ningún otro. Nace pausada
 * igual: lo que cambia es de dónde salen los pasos, no cuándo empieza a
 * escribirle a la gente.
 */
async function crear(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { plan, problemas } = planDesdeIA({
    nombre: args.nombre as string,
    disparador: args.disparador as string,
    pasos: args.pasos as AiPaso[],
  })
  if (!plan) {
    // Se devuelve legible para que el modelo pueda corregir en la misma vuelta
    // en vez de fallar y quedarse ahí.
    throw new Error(
      `no se puede crear así — ${problemas.map((p) => `${p.path}: ${p.message}`).join('; ')}`,
    )
  }

  const userId =
    ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? ctx.actor.id : null

  const { data, error } = await ctx.db
    .from('automations')
    .insert({
      user_id: userId ?? (await resolveWorkspaceOwnerUserId(ctx.db, ctx.workspaceId)),
      workspace_id: ctx.workspaceId,
      name: plan.nombre,
      trigger_type: plan.disparador,
      trigger_config: {},
      is_active: false,
    })
    .select('id, name, trigger_type, is_active')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'no se pudo crear')
  const automation = data as { id: string; name: string }

  // Las etiquetas viajan por nombre y acá se convierten en filas reales de la
  // cuenta, creándolas si no existían. Sin esto, el paso guarda un texto donde
  // va un uuid y la corrida falla contra la clave foránea.
  const err = await insertSteps(
    automation.id,
    await resolverEtiquetas(ctx.db, ctx.workspaceId, plan.pasos),
  )
  if (err) {
    await ctx.db.from('automations').delete().eq('id', automation.id)
    throw new Error(err)
  }

  return {
    ...automation,
    pasos: plan.pasos.length,
    nota: 'Queda pausada. Revisala y prendela cuando quieras.',
  }
}

async function crearDesdeReceta(ctx: CapabilityContext, args: Record<string, unknown>) {
  const automation = await installTemplate(ctx.db, {
    templateId: String(args.receta),
    workspaceId: ctx.workspaceId,
    userId: ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? ctx.actor.id : null,
    locale: ctx.locale ?? 'es',
  })
  return {
    ...automation,
    // Se dice acá y no en la descripción porque es lo que hay que hacer
    // ahora: la receta deja en blanco la plantilla y la etiqueta a propósito.
    nota: 'Queda pausada. Completá el nombre de la plantilla y la etiqueta antes de prenderla.',
  }
}

/**
 * Qué dice que va a hacer, en castellano.
 *
 * No es decorado: es lo que lee la persona que aprueba. Sin esto la tarjeta
 * mostraba "automatizaciones.crear_desde_receta — receta: carrito-abandonado",
 * que es el nombre interno de una función, y aprobar algo que no se entiende
 * no es aprobar.
 */
async function nombreDe(ctx: CapabilityContext, automationId: string): Promise<string> {
  const { data } = await ctx.db
    .from('automations')
    .select('name')
    .eq('id', automationId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  return (data as { name?: string } | null)?.name ?? 'esa automatización'
}

export const AUTOMATION_CAPABILITIES: Capability[] = [
  {
    key: 'automatizaciones.listar',
    description:
      'Las automatizaciones de la cuenta con su disparador, si están activas, cuántas veces corrieron y cuándo fue la última.',
    descriptionEn:
      'The automations of the account with their trigger, whether they are active, how many times they ran and when the last one was.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: listar,
  },

  {
    key: 'automatizaciones.recetas',
    description:
      'Las recetas disponibles para crear una automatización ya armada (carrito abandonado, pago rechazado, nuevo pedido, tracking, encuesta, recompras).',
    descriptionEn:
      'The available recipes to create a ready-made automation (abandoned cart, rejected payment, new order, tracking, survey, repurchase).',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: recetas,
  },

  {
    key: 'automatizaciones.activar',
    description:
      'Prende o pausa una automatización. Se deshace llamando de nuevo. Al prender valida la configuración: si le falta la plantilla o la etiqueta, no la deja activa.',
    descriptionEn:
      'Turns an automation on or off. Undone by calling it again. Turning it on validates the configuration: if the template or the tag is missing, it will not activate.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        automation_id: { type: 'string' },
        activa: { type: 'boolean' },
      },
      required: ['automation_id', 'activa'],
    },
    // Pausar no alcanza a nadie; prender empieza a dispararse con cada evento
    // y le escribe a clientes. La misma capacidad, dos cosas distintas.
    inerte: (args) => args.activa === false,
    async preview(ctx, args) {
      const nombre = await nombreDe(ctx, String(args.automation_id))
      if (!args.activa) return `Pausaría «${nombre}». Deja de dispararse hasta que la prendas.`
      // Se valida acá y no sólo al ejecutar: si le falta la plantilla, decirlo
      // antes evita que alguien apruebe algo que va a fallar.
      const issues = await activationIssuesById(
        ctx.db,
        String(args.automation_id),
        ctx.workspaceId,
      ).catch(() => null)
      if (issues && issues.length > 0) {
        return `«${nombre}» todavía no se puede prender: falta ${issues
          .map((i) => i.message)
          .join('; ')}.`
      }
      return `Prendería «${nombre}». Empieza a dispararse con cada evento que la active.`
    },
    run: activar,
  },

  {
    key: 'automatizaciones.editar_espera',
    description:
      'Cambia cuánto espera un paso de espera. El paso se identifica por su id, que sale de la automatización o del lienzo.',
    descriptionEn:
      'Changes how long a wait step waits. The step is identified by its id, which comes from the automation or from the canvas.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        step_id: { type: 'string' },
        amount: { type: 'number' },
        unit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
      },
      required: ['step_id', 'amount', 'unit'],
    },
    // Cambia cuánto espera un paso. Si la automatización está pausada no pasa
    // nada, y si está activa cambia un tiempo — no manda nada nuevo.
    inerte: true,
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('automation_steps')
        .select('step_config, automations!inner(name, workspace_id)')
        .eq('id', String(args.step_id))
        .maybeSingle()
      const fila = data as
        | {
            step_config?: { amount?: number; unit?: string }
            automations?: { name?: string; workspace_id?: string }
          }
        | null
      if (!fila || fila.automations?.workspace_id !== ctx.workspaceId) {
        return 'Ese paso no existe en esta cuenta.'
      }
      const antes = fila.step_config
        ? `${fila.step_config.amount} ${fila.step_config.unit}`
        : 'la espera actual'
      return `En «${fila.automations?.name ?? 'la automatización'}» cambiaría la espera de ${antes} a ${args.amount} ${args.unit}.`
    },
    run: editarEspera,
  },

  {
    key: 'automatizaciones.crear',
    description: `Arma una automatización desde cero, con sus pasos. Para lo que no cubre ninguna receta. Nace pausada.
Disparadores: ${AI_TRIGGERS.map((x) => `${x.value} (${x.que})`).join('; ')}.
Pasos: send_message (texto, admite {{nombre}}), send_template (nombre exacto de una plantilla YA aprobada — consultá plantillas.estado antes), wait (cantidad + unidad), add_tag (nombre de etiqueta), condition (sujeto + operando, con ramas si/no), close_conversation.`,
    descriptionEn:
      'Builds an automation from scratch, with its steps, for what no recipe covers. It starts paused.',
    risk: 'reversible',
    inerte: true,
    schema: AI_STEPS_SCHEMA,
    async preview(ctx, args) {
      const { plan, problemas } = planDesdeIA({
        nombre: args.nombre as string,
        disparador: args.disparador as string,
        pasos: args.pasos as AiPaso[],
      })
      if (!plan) {
        return `Todavía no se puede: ${problemas.map((p) => p.message).join('; ')}.`
      }
      const cuando =
        AI_TRIGGERS.find((x) => x.value === plan.disparador)?.que ?? plan.disparador
      return `Crearía «${plan.nombre}»: cuando ${cuando}, ${plan.pasos.length} paso(s). Nace pausada.`
    },
    artifact: (_ctx, args) =>
      artefactoDePlan({
        nombre: args.nombre as string,
        disparador: args.disparador as string,
        pasos: args.pasos as AiPaso[],
      }),
    run: crear,
  },

  {
    key: 'automatizaciones.crear_desde_receta',
    description:
      'Crea una automatización a partir de una receta, con sus pasos ya armados. Nace pausada: hay que completar la plantilla y la etiqueta antes de prenderla.',
    descriptionEn:
      'Creates an automation from a recipe, with its steps already built. It starts paused: the template and the tag must be filled in before turning it on.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        receta: {
          type: 'string',
          description: 'Clave de la receta, de automatizaciones.recetas.',
        },
      },
      required: ['receta'],
    },
    // Nace pausada y con la plantilla en blanco: no se dispara ni aunque
    // alguien quisiera. Borrarla no deja rastro.
    inerte: true,
    async preview(ctx, args) {
      const slug = String(args.receta)
      const t = AUTOMATION_TEMPLATES[slug as TemplateSlug]
      if (!t) return `No existe la receta "${slug}".`
      const nombre = translate(ctx.locale ?? 'es', automationTemplateNameKey(slug))
      return `Crearía «${nombre}» con sus ${t.steps.length} pasos ya armados, en pausa. Después hay que completar la plantilla de WhatsApp y la etiqueta antes de prenderla.`
    },
    run: crearDesdeReceta,
  },
]

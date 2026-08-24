/**
 * Automatizaciones: verlas, prenderlas, ajustarlas y crearlas desde una receta.
 *
 * Prender pasa por `assertActivable`, la misma puerta que usa el editor. Antes
 * el MCP hacía el UPDATE directo y se saltaba la validación: se podía dejar
 * activa una automatización a la que le faltaba el nombre de la plantilla, y el
 * resultado era una corrida fallida por cada disparo, en silencio.
 */
import {
  assertActivable,
  activationIssues,
  activationIssuesById,
  comoSeLee,
} from '@/lib/automations/activation'
import { installTemplate } from '@/lib/automations/install-template'
import {
  AI_STEPS_SCHEMA,
  AI_TRIGGERS,
  MAX_PROFUNDIDAD,
  artefactoDePlan,
  planDesdeIA,
  type AiEntradaPlan,
  type AiPaso,
} from '@/lib/automations/ai-steps'
import {
  PATCHES_SCHEMA,
  artefactoDeSnapshot,
  ensayarPatches,
  leerPatches,
  listarRutas,
  type AutomatizacionSnapshot,
  type Ensayo,
} from '@/lib/automations/ai-patches'
import { insertSteps, loadStepsTree, replaceSteps } from '@/lib/automations/steps-tree'
import { resolverReferencias } from '@/lib/automations/resolve-tag-seeds'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import {
  AUTOMATION_TEMPLATES,
  TEMPLATE_GALLERY_ORDER,
  automationTemplateNameKey,
  type TemplateSlug,
  type TemplateStepSeed,
} from '@/lib/automations/templates'
import type { BuilderStepInput } from '@/lib/automations/steps-tree'
import { translate } from '@/lib/i18n/translate'
import type { Artefacto } from '@/lib/operator/artifacts'
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

// ---------------------------------------------------------------------------
// Ver y editar una que ya existe
// ---------------------------------------------------------------------------

/** Los uuids de `add_tag` se cambian por el nombre para poder leer el árbol. */
async function nombresDeEtiqueta(ctx: CapabilityContext): Promise<Map<string, string>> {
  const { data } = await ctx.db
    .from('tags')
    .select('id, name')
    .eq('workspace_id', ctx.workspaceId)
  return new Map((data ?? []).map((t) => [(t as { id: string }).id, (t as { name: string }).name]))
}

interface Cargada {
  id: string
  activa: boolean
  snapshot: AutomatizacionSnapshot
  nombresEtiqueta: Map<string, string>
}

/**
 * La automatización entera, ya recortada por cuenta.
 *
 * El `eq('workspace_id')` es lo único que separa esto de poder editar la
 * automatización de otro comercio: `loadStepsTree` va por el cliente de
 * servicio y no sabe de cuentas, así que la autorización tiene que pasar acá
 * antes y cortar si la fila no aparece.
 */
async function cargar(ctx: CapabilityContext, automationId: string): Promise<Cargada> {
  const { data } = await ctx.db
    .from('automations')
    .select('id, name, trigger_type, trigger_config, is_active')
    .eq('id', automationId)
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  const fila = data as {
    id: string
    name: string
    trigger_type: string
    trigger_config: Record<string, unknown> | null
    is_active: boolean
  } | null
  if (!fila) throw new Error('esa automatización no existe en esta cuenta')

  return {
    id: fila.id,
    activa: fila.is_active,
    snapshot: {
      nombre: fila.name,
      disparador: fila.trigger_type,
      triggerConfig: fila.trigger_config ?? {},
      pasos: await loadStepsTree(fila.id),
    },
    nombresEtiqueta: await nombresDeEtiqueta(ctx),
  }
}

/**
 * Cómo quedó GUARDADA una automatización, dibujable.
 *
 * No es lo mismo que el artefacto que se calcula al proponerla: aquél sale de
 * los argumentos del modelo y éste de la base. La diferencia es justo lo que
 * hay que poder mirar —las etiquetas ya resueltas, los pasos que de verdad
 * entraron— y fue lo que destapó que una automatización creada desde el chat
 * no se parecía a lo que el chat había dicho.
 */
export async function artefactoGuardadoDeAutomatizacion(
  ctx: CapabilityContext,
  automationId: string,
): Promise<Artefacto | null> {
  const { id, snapshot, nombresEtiqueta } = await cargar(ctx, automationId)
  return artefactoDeSnapshot(snapshot, { id, nombresEtiqueta })
}

async function ver(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { id, activa, snapshot, nombresEtiqueta } = await cargar(
    ctx,
    String(args.automation_id),
  )
  const falta = activationIssues({
    triggerType: snapshot.disparador,
    triggerConfig: snapshot.triggerConfig,
    steps: snapshot.pasos,
  })
  return {
    id,
    nombre: snapshot.nombre,
    activa,
    disparador: snapshot.disparador,
    cuando: AI_TRIGGERS.find((t) => t.value === snapshot.disparador)?.que ?? snapshot.disparador,
    // Con la ruta ya calculada: es lo que después se escribe en `paso` para
    // editar. Contando pasos de un dibujo se edita el equivocado.
    pasos: listarRutas(snapshot.pasos, nombresEtiqueta),
    // En castellano y sin la ruta: quien lee esto es un comercio, no quien
    // programó el validador.
    falta_para_prenderla: falta.map((i) => comoSeLee(i, ctx.locale ?? 'es')),
  }
}

interface EnsayoDeEdicion extends Cargada {
  ensayo: Ensayo
}

/**
 * El ensayo, guardado un rato.
 *
 * `artifact` es SÍNCRONO por contrato —así lo llama `escribir.ts`, sin await— y
 * el árbol que hay que dibujar vive en la base. Sin esto, una propuesta de
 * edición no podía mostrar nada: `artifact` corre antes que `artifactBefore` y
 * no tiene forma de leer.
 *
 * Así que lo carga el primero que pasa (siempre `preview`, en los dos caminos
 * de `escribir.ts`) y `artifact` lo lee de acá. La vida es corta a propósito:
 * es para dibujar, no para decidir. `run` lo recalcula SIEMPRE contra la base,
 * porque entre la propuesta y el click alguien pudo haber tocado la
 * automatización desde la pantalla.
 */
const ENSAYOS = new Map<string, { hasta: number; valor: EnsayoDeEdicion }>()
const VIDA_ENSAYO_MS = 30_000
const TOPE_ENSAYOS = 20

/**
 * Lo que la vista previa de una espera dejó cargado.
 *
 * `artifact` es SÍNCRONO —se llama al proponer, cuando ya no se puede leer la
 * base— así que el árbol tiene que quedar de la pasada anterior. Es la misma
 * idea que el ensayo de `editar`, más chica: acá no hay nada que ensayar, sólo
 * el árbol sobre el que se va a cambiar un número.
 */
const ESPERAS = new Map<string, { hasta: number; id: string; snapshot: AutomatizacionSnapshot }>()

function claveEspera(ctx: CapabilityContext, args: Record<string, unknown>): string {
  return `${ctx.workspaceId}|${args.step_id}`
}

function claveEnsayo(ctx: CapabilityContext, args: Record<string, unknown>): string {
  return `${ctx.workspaceId}|${args.automation_id}|${JSON.stringify(args.patches ?? null)}`
}

async function ensayoDeEdicion(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
  opciones?: { fresco?: boolean },
): Promise<EnsayoDeEdicion> {
  const clave = claveEnsayo(ctx, args)
  const ahora = Date.now()
  if (!opciones?.fresco) {
    const guardado = ENSAYOS.get(clave)
    if (guardado && guardado.hasta > ahora) return guardado.valor
  }

  const cargada = await cargar(ctx, String(args.automation_id))
  const { patches } = leerPatches(args.patches)
  const valor: EnsayoDeEdicion = { ...cargada, ensayo: ensayarPatches(cargada.snapshot, patches) }

  for (const [k, v] of ENSAYOS) if (v.hasta <= ahora) ENSAYOS.delete(k)
  if (ENSAYOS.size >= TOPE_ENSAYOS) ENSAYOS.delete(ENSAYOS.keys().next().value as string)
  ENSAYOS.set(clave, { hasta: ahora + VIDA_ENSAYO_MS, valor })
  return valor
}

function ensayoGuardado(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): EnsayoDeEdicion | null {
  const guardado = ENSAYOS.get(claveEnsayo(ctx, args))
  return guardado && guardado.hasta > Date.now() ? guardado.valor : null
}

/** Por qué no se puede aplicar esta edición, en una línea. Null = se puede. */
function porQueNo(ensayo: Ensayo, nombre: string, locale: string): string | null {
  if (ensayo.problemas.length > 0) {
    return `no se puede editar así — ${ensayo.problemas
      .map((p) => p.message)
      .join('; ')}`
  }
  if (ensayo.erroresNuevos.length > 0) {
    // El ensayo en una frase: esto es lo que separa "editar" de "romper sin
    // enterarse". Una automatización que no se puede prender no avisa nada.
    return `ese cambio dejaría «${nombre}» sin poder prenderse — ${ensayo.erroresNuevos
      .map((i) => comoSeLee(i, locale))
      .join('; ')}`
  }
  return null
}

async function editar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { patches, descartados } = leerPatches(args.patches)
  // Los patches mal formados NO se saltean, a diferencia del lienzo de flujos:
  // allá el merchant mira el canvas y tiene Ctrl+Z, acá esto escribe en la base.
  // Aplicar tres de cuatro cambios deja una automatización que nadie pidió.
  if (descartados > 0) {
    throw new Error(
      `no entendí ${descartados} de los ${descartados + patches.length} cambios pedidos, así que no apliqué ninguno`,
    )
  }
  if (patches.length === 0) throw new Error('no hay ningún cambio que aplicar')

  // Fresco: entre la propuesta y el click alguien pudo haber editado desde la
  // pantalla, y el ensayo viejo estaría hablando de otro árbol.
  const { id, activa, snapshot, ensayo } = await ensayoDeEdicion(ctx, args, { fresco: true })
  const no = porQueNo(ensayo, snapshot.nombre, ctx.locale ?? 'es')
  if (no) throw new Error(no)

  const { despues } = ensayo
  const update: Record<string, unknown> = {}
  if (despues.nombre !== snapshot.nombre) update.name = despues.nombre
  if (despues.disparador !== snapshot.disparador) {
    update.trigger_type = despues.disparador
    update.trigger_config = despues.triggerConfig
  }
  if (Object.keys(update).length > 0) {
    const { error } = await ctx.db
      .from('automations')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', ctx.workspaceId)
    if (error) throw new Error(error.message)
  }

  // Sólo si los pasos cambiaron de verdad: `replaceSteps` borra y reinserta el
  // árbol entero, y aunque repone las referencias de las corridas dormidas, no
  // hay ninguna razón para hacerle pasar eso a una automatización a la que sólo
  // le cambiaron el nombre.
  if (JSON.stringify(snapshot.pasos) !== JSON.stringify(despues.pasos)) {
    const refs = await resolverReferencias(ctx.db, ctx.workspaceId, { pasos: despues.pasos })
    if (refs.problemas.length > 0) {
      // Aplicar la mitad de una edición es peor que no aplicar ninguna: la
      // misma regla que ya rige el ensayo de los patches.
      throw new Error(`no se pudo editar — ${refs.problemas.map((q) => q.message).join('; ')}`)
    }
    const err = await replaceSteps(id, refs.pasos)
    if (err) throw new Error(err)
  }

  return {
    id,
    nombre: despues.nombre,
    cambios: ensayo.resumen,
    activa,
    nota: activa
      ? 'Está activa: el cambio rige desde el próximo disparo.'
      : 'Sigue pausada.',
  }
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
/** Los argumentos del modelo, con la forma que espera `planDesdeIA`. */
function entradaDePlan(args: Record<string, unknown>): AiEntradaPlan {
  return {
    nombre: args.nombre as string,
    disparador: args.disparador as string,
    dias: typeof args.dias === 'number' ? args.dias : undefined,
    palabras: Array.isArray(args.palabras) ? (args.palabras as string[]) : undefined,
    coincidencia: typeof args.coincidencia === 'string' ? args.coincidencia : undefined,
    pasos: args.pasos as AiPaso[],
  }
}

async function crear(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { plan, problemas } = planDesdeIA(entradaDePlan(args))
  if (!plan) {
    // Se devuelve legible para que el modelo pueda corregir en la misma vuelta
    // en vez de fallar y quedarse ahí.
    throw new Error(
      // Sin la ruta: «pasos:» delante de una frase en castellano es el nombre
      // de un campo del validador, y no le dice nada a quien lo lee.
      `no se puede crear así — ${problemas.map((p) => p.message).join('; ')}`,
    )
  }

  // Los nombres se convierten en ids ANTES de escribir nada. Antes era al
  // revés —insertar, resolver, y borrar la fila si algo falló— y un nombre de
  // grupo mal escrito dejaba una etiqueta recién creada colgada en la cuenta.
  const refs = await resolverReferencias(ctx.db, ctx.workspaceId, {
    pasos: plan.pasos,
    triggerConfig: plan.disparadorConfig,
  })
  if (refs.problemas.length > 0) {
    throw new Error(`no se puede crear así — ${refs.problemas.map((p) => p.message).join('; ')}`)
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
      // Con `{}` fijo —que es lo que había— ninguna automatización por
      // inactividad se podía crear: la validación pedía los días y el modelo
      // no tenía dónde ponerlos.
      trigger_config: refs.triggerConfig,
      is_active: false,
    })
    .select('id, name, trigger_type, is_active')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'no se pudo crear')
  const automation = data as { id: string; name: string }

  const err = await insertSteps(automation.id, refs.pasos)
  if (err) {
    await ctx.db.from('automations').delete().eq('id', automation.id)
    throw new Error(err)
  }

  return {
    ...automation,
    pasos: plan.total,
    nota: 'Queda pausada. Al cerrar se le pregunta a la persona si la prende.',
  }
}

/**
 * Las semillas de una receta, como árbol.
 *
 * Se guardan planas —cada una apuntando a su condición padre por índice— porque
 * así se insertan en la base. El dibujo necesita el árbol, que es el mismo que
 * arma el editor al cargar. Son quince líneas y evitan importar el constructor
 * entero, que son cuatro mil y vive en el navegador.
 */
function arbolDeSemillas(semillas: TemplateStepSeed[]): BuilderStepInput[] {
  const nodos: BuilderStepInput[] = semillas.map((s) => ({
    step_type: s.step_type,
    step_config: (s.step_config ?? {}) as Record<string, unknown>,
    branches: { yes: [], no: [] },
  }))
  const raiz: BuilderStepInput[] = []
  semillas.forEach((s, i) => {
    const padre = s.parent_index != null ? nodos[s.parent_index] : undefined
    if (!padre) {
      raiz.push(nodos[i])
      return
    }
    ;(s.branch === 'no' ? padre.branches!.no! : padre.branches!.yes!).push(nodos[i])
  })
  return raiz
}

/**
 * Borrar una automatización que el Operador acaba de crear.
 *
 * Borrado blando: la fila queda con `deleted_at` y sale de todas las listas. Es
 * lo mismo que hace la pantalla, así que deshacer desde el chat y borrar desde
 * el editor dejan la cuenta igual.
 */
async function borrarAutomatizacion(
  ctx: CapabilityContext,
  result: unknown,
): Promise<string> {
  const id = (result as { id?: string } | undefined)?.id
  if (!id) throw new Error('No quedó registrado qué automatización se creó.')
  const nombre = await nombreDe(ctx, id)
  const { error } = await ctx.db
    .from('automations')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
  if (error) throw new Error(error.message)
  return `Se borró «${nombre}».`
}

/**
 * El árbol con una espera cambiada, sin tocar el resto.
 *
 * Se busca por el id del paso y se recorre entero, ramas incluidas: una espera
 * puede estar a tres condiciones de profundidad, y el dibujo tiene que mostrar
 * el árbol completo con ese número movido y nada más.
 */
function conEsperaCambiada(
  pasos: BuilderStepInput[],
  stepId: string,
  amount: number,
  unit: string,
): BuilderStepInput[] {
  return pasos.map((p) => {
    const propio =
      (p as { id?: string }).id === stepId
        ? { ...p, step_config: { ...(p.step_config ?? {}), amount, unit } }
        : p
    if (!propio.branches) return propio
    return {
      ...propio,
      branches: {
        yes: conEsperaCambiada(propio.branches.yes ?? [], stepId, amount, unit),
        no: conEsperaCambiada(propio.branches.no ?? [], stepId, amount, unit),
      },
    }
  })
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
    nota: 'Queda pausada. Completa el nombre de la plantilla y la etiqueta antes de prenderla.',
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
    key: 'automatizaciones.ver',
    description:
      'Una automatización por dentro: su disparador, sus pasos en orden y qué le falta para poder prenderse. Cada paso viene con su ruta ("2", "2.si.1"), que es la que hay que pasarle a automatizaciones.editar. Miralo antes de editar: adivinar la posición de un paso es editar el equivocado.',
    descriptionEn:
      'An automation from the inside: its trigger, its steps in order, and what it still needs to be turned on. Each step comes with the route to address it in automatizaciones.editar.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { automation_id: { type: 'string' } },
      required: ['automation_id'],
    },
    run: ver,
  },

  {
    key: 'automatizaciones.recetas',
    description:
      'Las automatizaciones listas para usar, ya armadas (carrito abandonado, pago rechazado, nuevo pedido, seguimiento del envío, encuesta, recompras). Al hablar con la persona llámalas por su nombre, nunca "receta": esa palabra es de acá adentro.',
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
    // Prender es el momento en que empieza a hablarle a gente real, y eso no se
    // deshace para quien ya recibió el mensaje. `risk` es una sola etiqueta para
    // toda la capacidad, así que pausar también pide confirmación: de los dos
    // lados posibles, ése es el seguro. Los cuatro interruptores de la cuenta
    // —menús, reglas de comentario, automatizaciones y agentes— dicen lo mismo.
    risk: 'irreversible',
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
        throw new Error(
          // Sin «falta»: lo que sigue son oraciones enteras, no fragmentos.
          `«${nombre}» todavía no se puede prender. ${issues
            .map((i) => comoSeLee(i, ctx.locale ?? 'es'))
            .join('; ')}`,
        )
      }
      return `Prendería «${nombre}». Empieza a dispararse con cada evento que la active.`
    },
    // Vuelve al estado anterior. Lo que ya se disparó mientras estuvo prendida
    // no se deshace —eso ya le llegó a alguien— y por eso lo dice el texto.
    async deshacer(ctx, args) {
      const id = String(args.automation_id)
      const nombre = await nombreDe(ctx, id)
      await ctx.db
        .from('automations')
        .update({ is_active: args.activa === false })
        .eq('id', id)
        .eq('workspace_id', ctx.workspaceId)
      return args.activa
        ? `«${nombre}» quedó pausada otra vez. Lo que se disparó mientras estuvo prendida ya salió.`
        : `«${nombre}» quedó prendida otra vez.`
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
    // Sin `inerte`, como la capacidad general de editar. Estaba marcada inerte
    // con el argumento de que «cambia un tiempo, no manda nada nuevo»: es cierto
    // que no agrega un mensaje, y también que bajar una espera de 21 días a una
    // hora manda HOY los que iban a salir en tres semanas. La capacidad ancha
    // —`automatizaciones.editar`, que puede hacer exactamente esto— siempre
    // pidió un click; la angosta no puede ser la permisiva.
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('automation_steps')
        .select('automation_id, step_config, automations!inner(name, workspace_id)')
        .eq('id', String(args.step_id))
        .maybeSingle()
      const fila = data as
        | {
            automation_id?: string
            step_config?: { amount?: number; unit?: string }
            automations?: { name?: string; workspace_id?: string }
          }
        | null
      if (!fila || fila.automations?.workspace_id !== ctx.workspaceId) {
        throw new Error('Ese paso no existe en esta cuenta.')
      }
      const antes = fila.step_config
        ? `${fila.step_config.amount} ${fila.step_config.unit}`
        : 'la espera actual'

      // De paso queda cargado el árbol, para poder dibujarlo. `artifact` es
      // síncrono y no puede leer la base.
      if (fila.automation_id) {
        try {
          const cargada = await cargar(ctx, fila.automation_id)
          const ahora = Date.now()
          for (const [k, v] of ESPERAS) if (v.hasta <= ahora) ESPERAS.delete(k)
          ESPERAS.set(claveEspera(ctx, args), {
            hasta: ahora + VIDA_ENSAYO_MS,
            id: cargada.id,
            snapshot: cargada.snapshot,
          })
        } catch {
          // Sin árbol se sigue igual: el dibujo es lo que se muestra, no lo
          // que se hace.
        }
      }

      return `En «${fila.automations?.name ?? 'la automatización'}» cambiaría la espera de ${antes} a ${args.amount} ${args.unit}.`
    },
    /** El árbol como quedaría, con la espera nueva puesta en su paso. */
    artifact(ctx, args) {
      const guardado = ESPERAS.get(claveEspera(ctx, args))
      if (!guardado || guardado.hasta <= Date.now()) return null
      const pasos = conEsperaCambiada(
        guardado.snapshot.pasos,
        String(args.step_id),
        Number(args.amount),
        String(args.unit),
      )
      return artefactoDeSnapshot(
        { ...guardado.snapshot, pasos },
        { id: guardado.id },
      )
    },
    async artifactBefore(ctx, args) {
      const guardado = ESPERAS.get(claveEspera(ctx, args))
      if (!guardado || guardado.hasta <= Date.now()) return null
      return artefactoDeSnapshot(guardado.snapshot, { id: guardado.id })
    },
    run: editarEspera,
  },

  {
    key: 'automatizaciones.editar',
    description: `Cambia una automatización que ya existe, sin volver a escribirla entera. Los pasos se nombran por posición: "2" es el segundo del tronco y "2.si.1" el primero de la rama del sí de ese paso — las rutas salen de automatizaciones.ver, no las cuentes.
Cambios: renombrar (nombre); cambiar_disparador (disparador, más dias en customer_inactive y post_delivery_feedback); cambiar_texto (paso, texto) sólo sobre un send_message, porque el cuerpo de una plantilla lo fija Meta; cambiar_espera (paso, cantidad, unidad); agregar_paso (nuevo, y donde para elegir el lugar); quitar_paso (paso).
Se aplican en orden, cada uno sobre cómo quedó el anterior. Antes de escribir se ensaya el resultado: si quedara sin poder prenderse, no se aplica ninguno.`,
    descriptionEn:
      'Edits an existing automation with a small set of changes instead of rewriting it: rename, change the trigger, change a message text, change a wait, add a step, remove a step. Steps are addressed by position ("2", "2.si.1"). The changes are rehearsed first: if the result could no longer be turned on, none of them are applied.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        automation_id: { type: 'string' },
        patches: PATCHES_SCHEMA,
      },
      required: ['automation_id', 'patches'],
    },
    async preview(ctx, args) {
      const { descartados } = leerPatches(args.patches)
      if (descartados > 0) {
        throw new Error(`No entiendo ${descartados} de los cambios pedidos.`)
      }
      const { activa, snapshot, ensayo } = await ensayoDeEdicion(ctx, args)
      // Lanzar y no devolver: una vista previa que explica por qué no se puede
      // igual terminaba en una tarjeta con botón de aprobar. Y decía «No se
      // puede: no se puede editar así», dos veces lo mismo.
      const no = porQueNo(ensayo, snapshot.nombre, ctx.locale ?? 'es')
      if (no) throw new Error(no)
      // Un cambio que no cambia nada tampoco es una decisión: es un click que
      // no hace nada.
      if (ensayo.resumen.length === 0) {
        throw new Error(`Esos cambios dejarían «${snapshot.nombre}» igual que ahora.`)
      }
      return `En «${snapshot.nombre}»: ${ensayo.resumen.join('; ')}. ${
        activa
          ? 'Está activa: el cambio rige desde el próximo disparo.'
          : 'Sigue pausada.'
      }`
    },
    // El "antes" es lo que convierte el dibujo en un diff. Sin esto el panel
    // redibuja el árbol entero y quien mira tiene que compararlo de memoria con
    // el que ya conocía.
    async artifactBefore(ctx, args) {
      const { id, snapshot, nombresEtiqueta } = await ensayoDeEdicion(ctx, args)
      return artefactoDeSnapshot(snapshot, { id, nombresEtiqueta })
    },
    artifact: (ctx, args) => {
      const guardado = ensayoGuardado(ctx, args)
      // Sin ensayo a mano no se dibuja nada: inventar un árbol sería mostrar
      // algo que no describe lo que va a pasar, que es peor que no mostrar.
      if (!guardado || guardado.ensayo.problemas.length > 0) return null
      return artefactoDeSnapshot(guardado.ensayo.despues, {
        id: guardado.id,
        nombresEtiqueta: guardado.nombresEtiqueta,
      })
    },
    run: editar,
  },

  {
    key: 'automatizaciones.crear',
    description: `Arma una automatización desde cero, con sus pasos y sus preguntas. Para lo que no cubre ninguna de las listas para usar. Nace pausada.
Disparadores: ${AI_TRIGGERS.map((x) => `${x.value} = cuando ${x.que}${x.pide ? ` [pide ${x.pide}]` : ''}`).join('; ')}.
Pasos: send_message, send_template (nombre exacto de una plantilla YA aprobada — consulta plantillas.estado antes), wait, add_tag, remove_tag, condition, close_conversation, assign_conversation, update_contact_field, send_webhook, voice_call.
Las preguntas (condition) NO se escriben a mano: se elige un "dato" de la lista del esquema y el resto lo arma el sistema. Hasta ${MAX_PROFUNDIDAD} preguntas encadenadas.`,
    descriptionEn:
      'Builds an automation from scratch, with its steps, for what no recipe covers. It starts paused.',
    risk: 'reversible',
    inerte: true,
    schema: AI_STEPS_SCHEMA,
    async preview(ctx, args) {
      const { plan, problemas } = planDesdeIA(entradaDePlan(args))
      if (!plan) {
        throw new Error(problemas.map((p) => p.message).join('; '))
      }
      const cuando =
        AI_TRIGGERS.find((x) => x.value === plan.disparador)?.que ?? plan.disparador
      // `total` y no `pasos.length`: la raíz de una automatización con ramas
      // son dos o tres pasos y el árbol entero dieciséis. La vista previa decía
      // "1 paso(s)" sobre algo que tenía dieciséis.
      return `Crearía «${plan.nombre}»: cuando ${cuando}, ${plan.total} pasos. Nace pausada.`
    },
    artifact: (_ctx, args) => artefactoDePlan(entradaDePlan(args)),
    // Se borra entera. Nació pausada y no se disparó nunca, así que no hay
    // nada que reponer: ni una corrida a medias ni un mensaje ya enviado.
    deshacer: (ctx, _args, result) => borrarAutomatizacion(ctx, result),
    run: crear,
  },

  {
    key: 'automatizaciones.crear_desde_receta',
    description:
      'Crea una automatización a partir de una de las listas para usar, con sus pasos ya armados. Nace pausada: hay que completar la plantilla y la etiqueta antes de prenderla.',
    descriptionEn:
      'Creates an automation from a recipe, with its steps already built. It starts paused: the template and the tag must be filled in before turning it on.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        receta: {
          type: 'string',
          description: 'Cuál de las listas para usar, de automatizaciones.recetas.',
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
      if (!t) throw new Error(`No hay ninguna lista para armar que se llame "${slug}".`)
      const nombre = translate(ctx.locale ?? 'es', automationTemplateNameKey(slug))
      return `Crearía «${nombre}» con sus ${t.steps.length} pasos ya armados, en pausa. Después hay que completar la plantilla de WhatsApp y la etiqueta antes de prenderla.`
    },
    // Se dibuja igual que la que se arma desde cero. Sin esto, elegir una lista
    // para usar dejaba el banco vacío: la única de las dos formas de crear una
    // automatización que no mostraba lo que iba a quedar.
    artifact: (ctx, args) => {
      const t = AUTOMATION_TEMPLATES[String(args.receta) as TemplateSlug]
      if (!t) return null
      return artefactoDeSnapshot({
        nombre: translate(ctx.locale ?? 'es', automationTemplateNameKey(String(args.receta))),
        disparador: t.trigger_type,
        triggerConfig: (t.trigger_config ?? {}) as Record<string, unknown>,
        pasos: arbolDeSemillas(t.steps),
      })
    },
    deshacer: (ctx, _args, result) => borrarAutomatizacion(ctx, result),
    run: crearDesdeReceta,
  },
]

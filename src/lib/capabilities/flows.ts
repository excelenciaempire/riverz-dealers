/**
 * Los menús: el árbol de botones que atiende al cliente antes que nadie.
 *
 * Editar uno ya estaba resuelto y a medias. `flows/ai-patches.ts` es la pieza
 * más terminada del repo —un DSL de mutación tipado que simula los cambios
 * sobre una copia y devuelve sólo los errores NUEVOS— pero no guardaba: el
 * lienzo le devolvía los patches al navegador y guardaba un humano. Así, el
 * único que podía editar un menú era alguien mirando la pantalla.
 *
 * Acá se usa el mismo DSL contra `flows/write.ts`, que simula, revalida y
 * recién ahí escribe. No hay un segundo dialecto: un menú editado desde el chat
 * pasa por el mismo validador que uno editado a mano, y por eso no puede quedar
 * en un estado que el editor consideraría roto.
 *
 * Prender es aparte y siempre pregunta. Un menú activo intercepta los mensajes
 * entrantes: deja de ser una configuración y pasa a ser quien contesta.
 */
import {
  NODOS_Y_CONFIG,
  PUERTOS_Y_CABLEADO,
  ASSIST_TOOL_SCHEMA,
  isPatch,
  type AiPatch,
} from '@/lib/flows/ai-patches'
import { validateFlowForActivation } from '@/lib/flows/validate'
import { aplicarPatches, cambiarEstado, leerFlujo } from '@/lib/flows/write'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { Capability, CapabilityContext } from './types'

/** Cuánto texto de un mensaje entra en el resumen de un paso. */
const TOPE_RESUMEN = 70

/**
 * El disparador y el inicio no son pasos, pero un patch los mueve.
 *
 * Se dibujan como una fila más del artefacto para que "ahora empieza por otro
 * lado" se vea. Las claves llevan guiones bajos adelante porque los `node_key`
 * son slugs y nunca pueden colisionar con éstas.
 */
const CLAVE_DISPARADOR = '__disparador'
const CLAVE_INICIO = '__inicio'

function recortar(valor: unknown, tope = TOPE_RESUMEN): string {
  const texto = String(valor ?? '').replace(/\s+/g, ' ').trim()
  return texto.length > tope ? `${texto.slice(0, tope)}…` : texto
}

/**
 * Qué hace un paso, en una línea.
 *
 * Tiene que incluir el CONTENIDO y no sólo el tipo: el diff de artefactos marca
 * como "editado" comparando estos resúmenes, así que un resumen que dijera sólo
 * "Manda un mensaje" haría invisible un cambio de texto, que es justamente el
 * cambio más común.
 */
export function resumirNodo(tipo: string, config: Record<string, unknown>): string {
  const c = config ?? {}
  switch (tipo) {
    case 'start':
      return 'Empieza acá'
    case 'send_message':
      return `Manda: "${recortar(c.text)}"`
    case 'send_buttons': {
      const botones = Array.isArray(c.buttons)
        ? (c.buttons as Array<{ title?: string }>).map((b) => b.title ?? '?')
        : []
      return `Pregunta "${recortar(c.text, 40)}" con botones: ${botones.join(' · ') || '(sin botones)'}`
    }
    case 'send_list': {
      const filas = Array.isArray(c.sections)
        ? (c.sections as Array<{ rows?: Array<{ title?: string }> }>).flatMap(
            (s) => s.rows ?? [],
          )
        : []
      return `Lista "${recortar(c.text, 40)}" con ${filas.length} opción(es): ${filas
        .map((f) => f.title ?? '?')
        .join(' · ')}`
    }
    case 'send_image':
      return `Manda una imagen: ${recortar(c.url, 50)}`
    case 'send_video':
      return `Manda un video: ${recortar(c.url, 50)}`
    case 'send_document':
      return `Manda un documento: ${recortar(c.url, 50)}`
    case 'send_cta_url':
      return `Manda "${recortar(c.text, 40)}" con el botón "${recortar(c.button_title, 20)}" a ${recortar(c.url, 40)}`
    case 'collect_input':
      return `Pregunta "${recortar(c.prompt_text, 40)}" y guarda la respuesta en {${recortar(c.var_key, 20)}}`
    case 'customer_reply':
      return 'Espera a que el cliente escriba'
    case 'condition': {
      const valor = c.value === undefined || c.value === '' ? '' : ` "${recortar(c.value, 30)}"`
      return `Si ${recortar(c.subject_key, 30)} ${recortar(c.operator, 20)}${valor}`
    }
    case 'set_tag':
      return c.mode === 'remove'
        ? `Le quita una etiqueta al contacto`
        : `Le pone una etiqueta al contacto`
    case 'handoff':
      return `Pasa la conversación a una persona${c.reason ? `: ${recortar(c.reason, 40)}` : ''}`
    case 'wait':
      return `Espera ${recortar(c.amount, 10)} ${recortar(c.unit, 10)}`
    case 'ai_intent': {
      const intenciones = Array.isArray(c.intents)
        ? (c.intents as Array<{ intent_key?: string }>).map((i) => i.intent_key ?? '?')
        : []
      return `La IA clasifica lo que escribió el cliente: ${intenciones.join(' · ') || '(sin intenciones)'}`
    }
    case 'shopify_lookup':
      return `Busca en la tienda: ${recortar(c.kind, 30)}`
    case 'subflow':
      return 'Ejecuta otro menú y vuelve'
    case 'end':
      return 'Termina la conversación'
    default:
      return `Paso de tipo ${tipo}`
  }
}

/** Cuándo se dispara el menú, en palabras. */
function describirDisparador(tipo: string, config: Record<string, unknown>): string {
  if (tipo === 'keyword') {
    const claves = Array.isArray(config?.keywords) ? (config.keywords as unknown[]) : []
    return `Se dispara cuando el cliente escribe: ${claves.join(' · ') || '(sin palabras clave)'}`
  }
  if (tipo === 'first_inbound_message') return 'Se dispara con el primer mensaje del cliente'
  return 'Se dispara sólo a mano'
}

/** Los patches, ya verificados. Rechaza la tanda entera si alguno viene roto. */
function leerPatches(valor: unknown): AiPatch[] {
  const crudos = Array.isArray(valor) ? valor : []
  const buenos = crudos.filter(isPatch)
  if (buenos.length !== crudos.length) {
    throw new Error(
      `${crudos.length - buenos.length} cambio(s) venían incompletos o con un tipo de paso que no existe.`,
    )
  }
  return buenos
}

/**
 * Qué claves toca esta tanda de patches.
 *
 * El artefacto muestra sólo esto y no el menú entero, a propósito: en un menú
 * de veinte pasos, redibujar los veinte para señalar que cambió uno obliga a
 * buscarlo. `to_node_key` de un `wire` no entra — el que cambia es el nodo de
 * origen, que es donde se guarda la conexión.
 */
function clavesTocadas(patches: AiPatch[]): {
  nodos: string[]
  disparador: boolean
  inicio: boolean
} {
  const nodos: string[] = []
  let disparador = false
  let inicio = false
  for (const p of patches) {
    switch (p.kind) {
      case 'add_node':
      case 'remove_node':
      case 'update_node_config':
      case 'move_node':
        nodos.push(p.node_key)
        break
      case 'wire':
        nodos.push(p.from_node_key)
        break
      case 'set_entry':
        // El paso no cambia, cambia por dónde se entra: va como fila aparte. Si
        // se contara como paso tocado, el "antes" tendría una fila que el
        // "después" no, y el diff lo mostraría como borrado.
        inicio = true
        break
      case 'set_trigger':
        disparador = true
        break
    }
  }
  return { nodos: [...new Set(nodos)], disparador, inicio }
}

type NodoArtefacto = Extract<Artefacto, { kind: 'flujo' }>['nodos'][number]

/**
 * El cambio dibujado cuando todavía no se ejecutó nada.
 *
 * `artifact` es síncrono a propósito —no puede leer la base—, así que acá sólo
 * se sabe lo que dicen los patches. Alcanza: contra el "antes" que sí lee la
 * base, el diff marca cada fila (nuevo, editado, quitado) y eso es exactamente
 * lo que hay que aprobar. El nombre real del menú lo dice el `preview`, que sí
 * puede consultarlo.
 */
function artefactoDePatches(patches: AiPatch[]): NodoArtefacto[] {
  const porClave = new Map<string, string[]>()
  const borrados = new Set<string>()
  const tipos = new Map<string, string>()
  const agregar = (clave: string, texto: string) => {
    const lista = porClave.get(clave)
    if (lista) lista.push(texto)
    else porClave.set(clave, [texto])
  }

  for (const p of patches) {
    switch (p.kind) {
      case 'add_node':
        tipos.set(p.node_key, p.node_type)
        borrados.delete(p.node_key)
        agregar(p.node_key, resumirNodo(p.node_type, p.config))
        break
      case 'remove_node':
        borrados.add(p.node_key)
        break
      case 'update_node_config':
        agregar(
          p.node_key,
          `Ajusta ${Object.entries(p.config_patch)
            .map(([k, v]) => `${k} = ${recortar(typeof v === 'object' ? JSON.stringify(v) : v, 40)}`)
            .join(', ')}`,
        )
        break
      case 'move_node':
        agregar(p.node_key, 'Lo mueve de lugar en el lienzo')
        break
      case 'wire':
        agregar(p.from_node_key, `Conecta ${p.kind_of_port} → «${p.to_node_key}»`)
        break
      case 'set_entry':
        agregar(CLAVE_INICIO, `El menú empieza por «${p.node_key}»`)
        break
      case 'set_trigger':
        agregar(CLAVE_DISPARADOR, describirDisparador(p.trigger_type, p.trigger_config))
        break
    }
  }

  const nodos: NodoArtefacto[] = []
  for (const [clave, textos] of porClave) {
    // Un paso borrado no se dibuja: aparece igual, tachado, porque está en el
    // "antes" y el diff lo marca como quitado.
    if (borrados.has(clave)) continue
    nodos.push({ clave, tipo: tipos.get(clave) ?? 'paso', resumen: textos.join(' · ') })
  }
  return nodos
}

// ---------------------------------------------------------------------------

async function listar(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('flows')
    .select(
      'id, short_id, name, description, status, trigger_type, trigger_config, entry_node_id, execution_count, last_executed_at, updated_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    ...f,
    cuando: describirDisparador(
      String(f.trigger_type),
      (f.trigger_config ?? {}) as Record<string, unknown>,
    ),
  }))
}

async function detalle(ctx: CapabilityContext, args: Record<string, unknown>) {
  const actual = await leerFlujo(ctx.db, String(args.flujo_id), ctx.workspaceId)
  if (!actual) throw new Error('ese menú no existe en esta cuenta')
  const { flow, nodos } = actual

  // Los problemas viajan con el detalle porque son la mitad de la respuesta a
  // "¿por qué no se prende?". Sin esto habría que adivinarlos leyendo configs.
  const problemas = validateFlowForActivation(
    {
      name: flow.name,
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config ?? {},
      entry_node_id: flow.entry_node_id,
    },
    nodos.map((n) => ({ node_key: n.node_key, node_type: n.node_type, config: n.config })),
  )

  return {
    id: flow.id,
    nombre: flow.name,
    estado: flow.status,
    cuando: describirDisparador(flow.trigger_type, flow.trigger_config ?? {}),
    disparador: { tipo: flow.trigger_type, config: flow.trigger_config ?? {} },
    inicio: flow.entry_node_id,
    veces_ejecutado: flow.execution_count,
    ultima_ejecucion: flow.last_executed_at,
    nodos: nodos.map((n) => ({
      clave: n.node_key,
      tipo: n.node_type,
      resumen: resumirNodo(n.node_type, n.config),
      config: n.config,
    })),
    problemas: problemas.map((p) => ({
      gravedad: p.severity === 'error' ? 'error' : 'aviso',
      paso: p.node_key ?? null,
      campo: p.field ?? null,
      mensaje: p.message,
    })),
  }
}

async function editar(ctx: CapabilityContext, args: Record<string, unknown>) {
  return aplicarPatches(ctx.db, {
    flowId: String(args.flujo_id),
    workspaceId: ctx.workspaceId,
    patches: leerPatches(args.patches),
    userId: ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? ctx.actor.id : null,
  })
}

async function activar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const activo = args.activo !== false
  const resultado = await cambiarEstado(ctx.db, {
    flowId: String(args.flujo_id),
    workspaceId: ctx.workspaceId,
    // Pausar deja el menú en borrador y no archivado: archivar lo saca de la
    // lista y esto tiene que poder deshacerse prendiéndolo de nuevo.
    estado: activo ? 'active' : 'draft',
    userId: ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? ctx.actor.id : null,
    nota: 'Publicado desde el chat',
  })
  if (!resultado.ok) {
    throw new Error(
      `todavía no se puede prender: ${resultado.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join(' ')}`,
    )
  }
  return {
    id: (resultado.flow as { id?: string } | null)?.id ?? null,
    estado: (resultado.flow as { status?: string } | null)?.status ?? null,
  }
}

/**
 * El menú como quedó guardado, entero.
 *
 * A diferencia del dibujo de una edición —que muestra SÓLO los nodos tocados,
 * para que el diff se lea— acá van todos: la pregunta es cómo quedó.
 */
export async function artefactoGuardadoDeFlujo(
  ctx: CapabilityContext,
  flujoId: string,
): Promise<Artefacto | null> {
  const actual = await leerFlujo(ctx.db, flujoId, ctx.workspaceId)
  if (!actual) return null
  return {
    kind: 'flujo',
    nombre: actual.flow.name,
    nodos: [
      {
        clave: CLAVE_DISPARADOR,
        tipo: 'disparador',
        resumen: describirDisparador(
          actual.flow.trigger_type,
          actual.flow.trigger_config ?? {},
        ),
      },
      ...actual.nodos.map((n) => ({
        clave: n.node_key,
        tipo: n.node_type,
        resumen: resumirNodo(n.node_type, n.config),
      })),
    ],
    base: { id: actual.flow.id, nombre: actual.flow.name },
  }
}

/**
 * CÓMO LES FUE A LAS CONVERSACIONES QUE PASARON POR UN MENÚ.
 *
 * El flujo se podía leer y editar, y no había forma de saber si funciona: en
 * qué paso se caen las personas, cuántas llegaron al final, cuántas siguen
 * trabadas. Un menú que pierde a todos en el paso tres se ve igual de bien que
 * uno que cierra ventas.
 */
async function corridas(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 30, 100)
  let q = ctx.db
    .from('flow_runs')
    .select(
      'id, flow_id, status, current_node_key, started_at, last_advanced_at, ended_at, end_reason, reprompt_count, conversation_id, contacts(name, phone), flows(name)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('started_at', { ascending: false })
    .limit(limite)
  if (typeof args.flujo_id === 'string' && args.flujo_id) q = q.eq('flow_id', args.flujo_id)
  if (args.solo_en_curso === true) q = q.is('ended_at', null)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    flow_id: string
    status: string
    current_node_key: string | null
    started_at: string
    ended_at: string | null
    end_reason: string | null
    reprompt_count: number | null
    conversation_id: string | null
    contacts: { name: string | null; phone: string | null } | null
    flows: { name: string | null } | null
  }>

  // Dónde se traba la gente: agrupado, es lo único que dice qué arreglar.
  const porPaso = new Map<string, number>()
  for (const f of filas) {
    if (f.ended_at) continue
    const paso = f.current_node_key ?? 'sin paso'
    porPaso.set(paso, (porPaso.get(paso) ?? 0) + 1)
  }

  return {
    trabadas_en: [...porPaso.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([paso, cuantas]) => ({ paso, cuantas })),
    corridas: filas.map((f) => ({
      corrida_id: f.id,
      menu: f.flows?.name ?? f.flow_id,
      cliente: f.contacts?.name ?? f.contacts?.phone ?? 'sin nombre',
      estado: f.status,
      paso_actual: f.current_node_key,
      // Cuántas veces hubo que repreguntarle: alto = el paso no se entiende.
      repreguntas: f.reprompt_count ?? 0,
      empezo: f.started_at,
      termino: f.ended_at,
      como_termino: f.end_reason,
      conversation_id: f.conversation_id,
    })),
  }
}

export const FLOW_CAPABILITIES: Capability[] = [
  {
    key: 'flujos.corridas',
    description:
      'Cómo les fue a las personas que pasaron por un menú: en qué paso está cada una, cuántas veces hubo que repreguntarle, cómo terminó. Viene con el corte de dónde se traba la gente, que es lo único que dice qué paso hay que reescribir. Un menú que pierde a todos en el paso tres se lee igual de bien que uno que vende.',
    descriptionEn:
      'How the people who went through a menu did: which step each one is on, how many times they had to be re-prompted, how it ended. It comes with the breakdown of where people get stuck, which is the only thing that says which step to rewrite. A menu that loses everyone on step three reads just as well as one that sells.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        flujo_id: { type: 'string', description: 'Sólo las de ese menú.' },
        solo_en_curso: { type: 'boolean', description: 'Sólo las que no terminaron.' },
        limite: { type: 'number', description: 'Por defecto 30, máximo 100.' },
      },
    },
    run: corridas,
  },
  {
    key: 'flujos.listar',
    description:
      'Los menús de la cuenta (los árboles de botones que atienden en WhatsApp): si están activos, con qué se disparan, cuántas veces corrieron y cuándo fue la última.',
    descriptionEn:
      'The account menus (the button trees that answer on WhatsApp): whether they are active, what triggers them, how many times they ran and when the last one was.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: listar,
  },

  {
    key: 'flujos.detalle',
    description:
      'Los pasos de un menú, uno por uno, con su configuración completa, por dónde empieza y qué le falta para poder prenderse. Es lo que hay que leer antes de editarlo: los cambios se escriben contra las claves de estos pasos.',
    descriptionEn:
      'The steps of a menu, one by one, with their full configuration, where it starts and what it needs before it can be turned on. Read this before editing: changes are written against these step keys.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        flujo_id: { type: 'string', description: 'Id del menú, de flujos.listar.' },
      },
      required: ['flujo_id'],
    },
    run: detalle,
  },

  {
    key: 'flujos.editar',
    description: `Cambia un menú: agrega pasos, edita el texto de uno, los conecta, cambia el disparador o por dónde empieza. Los cambios se simulan y se revalidan antes de guardar: si romperían algo que hoy funciona, no se guarda nada. Leé flujos.detalle primero para saber las claves de los pasos.
Tipos de paso y su config:
${NODOS_Y_CONFIG}
Cómo conectar (patch \`wire\`):
${PUERTOS_Y_CABLEADO}`,
    descriptionEn:
      'Edits a menu: adds steps, changes the text of one, wires them together, changes the trigger or the entry step. Changes are simulated and revalidated before saving: if they would break something that works today, nothing is saved.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        flujo_id: { type: 'string', description: 'Id del menú, de flujos.listar.' },
        // El mismo schema que usa la IA del lienzo: un solo dialecto de cambios
        // para los dos, o el día que se agregue un tipo de paso uno queda viejo.
        patches: ASSIST_TOOL_SCHEMA.properties.patches,
      },
      required: ['flujo_id', 'patches'],
    },
    async preview(ctx, args) {
      const actual = await leerFlujo(ctx.db, String(args.flujo_id), ctx.workspaceId)
      if (!actual) throw new Error('Ese menú no existe en esta cuenta.')
      let patches: AiPatch[]
      try {
        patches = leerPatches(args.patches)
      } catch (e) {
        return e instanceof Error ? e.message : 'Esos cambios no se entienden.'
      }
      const tocadas = clavesTocadas(patches)
      const nuevos = patches.filter((p) => p.kind === 'add_node').length
      const borrados = patches.filter((p) => p.kind === 'remove_node').length
      const partes = [
        nuevos > 0 ? `agregaría ${nuevos} paso(s)` : null,
        borrados > 0 ? `borraría ${borrados}` : null,
        `tocaría ${tocadas.nodos.length} paso(s) existentes o nuevos`,
      ].filter(Boolean)
      const vivo =
        actual.flow.status === 'active'
          ? ' El menú está activo: si los cambios lo dejaran incompleto, no se guardan.'
          : ''
      return `En «${actual.flow.name}» ${partes.join(', ')}.${vivo}`
    },
    artifact(_ctx, args, result) {
      let patches: AiPatch[]
      try {
        patches = leerPatches(args.patches)
      } catch {
        return null
      }
      const salida = result as
        | { flujo?: { nombre?: string }; nodos?: Array<{ node_key: string; node_type: string; config: Record<string, unknown> }>; disparador?: { tipo: string; config: Record<string, unknown> }; inicio?: string | null }
        | undefined
      if (!salida?.nodos) {
        return { kind: 'flujo', nombre: 'Menú', nodos: artefactoDePatches(patches) }
      }

      // Ya ejecutado: se dibujan los mismos pasos que se tocaron, pero con lo
      // que quedó de verdad en la base y no con lo que decía el patch.
      const tocadas = clavesTocadas(patches)
      const enTocadas = new Set(tocadas.nodos)
      const nodos: NodoArtefacto[] = salida.nodos
        .filter((n) => enTocadas.has(n.node_key))
        .map((n) => ({
          clave: n.node_key,
          tipo: n.node_type,
          resumen: resumirNodo(n.node_type, n.config),
        }))
      if (tocadas.disparador && salida.disparador) {
        nodos.push({
          clave: CLAVE_DISPARADOR,
          tipo: 'disparador',
          resumen: describirDisparador(salida.disparador.tipo, salida.disparador.config),
        })
      }
      if (tocadas.inicio) {
        nodos.push({
          clave: CLAVE_INICIO,
          tipo: 'inicio',
          resumen: `El menú empieza por «${salida.inicio ?? 'ningún paso'}»`,
        })
      }
      return { kind: 'flujo', nombre: salida.flujo?.nombre ?? 'Menú', nodos }
    },
    async artifactBefore(ctx, args) {
      const actual = await leerFlujo(ctx.db, String(args.flujo_id), ctx.workspaceId)
      if (!actual) return null
      let patches: AiPatch[]
      try {
        patches = leerPatches(args.patches)
      } catch {
        return null
      }
      const tocadas = clavesTocadas(patches)
      const enTocadas = new Set(tocadas.nodos)
      const nodos: NodoArtefacto[] = actual.nodos
        .filter((n) => enTocadas.has(n.node_key))
        .map((n) => ({
          clave: n.node_key,
          tipo: n.node_type,
          resumen: resumirNodo(n.node_type, n.config),
        }))
      if (tocadas.disparador) {
        nodos.push({
          clave: CLAVE_DISPARADOR,
          tipo: 'disparador',
          resumen: describirDisparador(
            actual.flow.trigger_type,
            actual.flow.trigger_config ?? {},
          ),
        })
      }
      if (tocadas.inicio) {
        nodos.push({
          clave: CLAVE_INICIO,
          tipo: 'inicio',
          resumen: `El menú empieza por «${actual.flow.entry_node_id ?? 'ningún paso'}»`,
        })
      }
      return {
        kind: 'flujo',
        nombre: actual.flow.name,
        nodos,
        base: { id: actual.flow.id, nombre: actual.flow.name },
      }
    },
    run: editar,
  },

  {
    key: 'flujos.activar',
    description:
      'Prende o pausa un menú. Prenderlo lo pone a atender: desde ese momento intercepta los mensajes que coincidan con su disparador y contesta él, antes que cualquier agente. Al prender valida el menú entero y se niega si algún paso quedó sin conectar.',
    descriptionEn:
      'Turns a menu on or off. Turning it on puts it in charge: from that moment it intercepts messages matching its trigger and answers before any agent. Turning it on validates the whole menu and refuses if any step is left unconnected.',
    // Irreversible aunque prender y pausar sean simétricos: el momento en que un
    // menú se prende es el momento en que empieza a contestarle a gente real, y
    // eso no se deshace para el que ya recibió el mensaje. `risk` es una sola
    // etiqueta para toda la capacidad, así que pausar también pide confirmación
    // — de los dos lados posibles, ése es el seguro.
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        flujo_id: { type: 'string', description: 'Id del menú, de flujos.listar.' },
        activo: { type: 'boolean' },
      },
      required: ['flujo_id', 'activo'],
    },
    async preview(ctx, args) {
      const actual = await leerFlujo(ctx.db, String(args.flujo_id), ctx.workspaceId)
      if (!actual) throw new Error('Ese menú no existe en esta cuenta.')
      const { flow, nodos } = actual
      if (args.activo === false) {
        return `Pausaría «${flow.name}». Deja de atender: los mensajes que hoy toma vuelven al agente.`
      }
      // Se valida acá y no sólo al ejecutar: aprobar algo que va a fallar es
      // gastarle el click a una persona.
      const errores = validateFlowForActivation(
        {
          name: flow.name,
          trigger_type: flow.trigger_type,
          trigger_config: flow.trigger_config ?? {},
          entry_node_id: flow.entry_node_id,
        },
        nodos.map((n) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
        })),
      ).filter((i) => i.severity === 'error')
      if (errores.length > 0) {
        throw new Error(
          `«${flow.name}» todavía no se puede prender: ${errores.map((i) => i.message).join(' ')}`,
        )
      }
      return `Prendería «${flow.name}» (${nodos.length} pasos). ${describirDisparador(
        flow.trigger_type,
        flow.trigger_config ?? {},
      )}, y desde ese momento contesta el menú antes que cualquier agente.`
    },
    run: activar,
  },
]

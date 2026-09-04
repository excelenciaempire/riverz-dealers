import { sembrarReglasPorDefecto } from '@/lib/ai/reglas-por-defecto'
/**
 * Los agentes de IA de la cuenta.
 *
 * Crear y activar llegaron junto con la flota (migración 164), y no antes: sin
 * el rol y los permisos por acción, un agente creado desde acá no se podía
 * gobernar — nacía pudiendo todo lo que permitiera la infraestructura.
 *
 * Todo lo que se crea nace PAUSADO. Activar es una acción aparte porque es el
 * momento en que empieza a hablarle a clientes reales, y ahí se valida que no
 * le dispute el canal a otro agente del mismo rol.
 *
 * Editar expone SEIS cosas y no las cuarenta columnas que acepta el PATCH de la
 * pantalla. No es prudencia genérica: un agente que ya está atendiendo se rompe
 * en silencio si alguien le mueve el modelo, el debounce o el alcance por canal,
 * y nadie se entera hasta que un cliente no recibe respuesta. Lo que se puede
 * tocar desde el chat es lo que un comercio sabe explicar en una frase — cómo se
 * llama, cómo habla, cuándo atiende y qué tiene permitido.
 */
import { findChannelConflict, channelLabels } from '@/lib/ai/channel-conflict'
import { updateAgent } from '@/lib/ai/agents/update'
import { roleTemplate } from '@/lib/ai/role-templates'
import {
  AGENT_PERMISSIONS,
  ROLE_BEHAVIOR,
  agentCan,
  isAgentRole,
  type AgentPermission,
  type AgentPermissions,
  type AgentRole,
} from '@/lib/ai/roles'
import type { AiTone, BusinessHours } from '@/lib/ai/types'
import type { Artefacto } from '@/lib/operator/artifacts'
import { MAX_REGLAS } from '@/lib/ai/guidance'
import { cambio, corto, fecha, lista, tabla, tieneCampos, tt } from './vistas'
import type { Capability, CapabilityContext } from './types'

async function listar(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('ai_agents')
    .select(
      'id, name, is_active, scope, product_scope, priority, language, tone, puede_crear_pedidos, voice_enabled, followup_enabled, created_at, ai_agent_channels(channel)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  const filas = (data ?? []) as unknown as Array<{
    id: string
    name: string
    is_active: boolean
    scope: string
    puede_crear_pedidos: boolean | null
    ai_agent_channels: { channel: string }[] | null
  }>

  return filas.map((a) => ({
    ...a,
    // El alcance real: `workspace` ocupa todos los canales aunque la tabla de
    // canales esté vacía. Sin esto, un agente de cuenta parece no atender nada.
    canales: a.scope === 'workspace' ? 'todos' : (a.ai_agent_channels ?? []).map((c) => c.channel),
    ai_agent_channels: undefined,
  }))
}

async function crearBorrador(ctx: CapabilityContext, args: Record<string, unknown>) {
  const role: AgentRole = isAgentRole(args.rol) ? args.rol : 'general'
  const preset = roleTemplate(role)
  const canales = Array.isArray(args.canales) ? (args.canales as string[]) : []

  const { data, error } = await ctx.db
    .from('ai_agents')
    .insert({
      workspace_id: ctx.workspaceId,
      name: String(args.nombre ?? '').trim() || 'Asistente',
      // Nace pausado SIEMPRE. Un agente que empieza a contestar en el mismo
      // momento en que se crea no le da a nadie la oportunidad de leerlo.
      is_active: false,
      role,
      permissions: preset?.permissions ?? null,
      persona: String(args.persona ?? ''),
      knowledge: args.conocimiento ? String(args.conocimiento) : null,
      language: ctx.locale ?? 'es',
      escalate_keywords: preset?.escalateKeywords ?? [],
      followup_enabled: preset?.followupEnabled ?? false,
      puede_crear_pedidos: preset?.permissions.crear_pedidos === true,
      scope: canales.length > 0 ? 'channels' : 'workspace',
      product_scope: 'all',
    })
    .select('id, name, role, is_active')
    .single()
  if (error) throw new Error(error.message)
  const agent = data as { id: string; name: string; role: string; is_active: boolean }

  if (canales.length > 0) {
    await ctx.db
      .from('ai_agent_channels')
      .insert(canales.map((channel) => ({ agent_id: agent.id, channel })))
  }

  // El piso de reglas. Un asistente nacía con CERO, y las reglas son justo lo
  // que impide que invente: sin ellas prometió pago contra entrega donde no
  // existe y repitió como cierta una condición de venta porque la dijo el
  // cliente. Sólo si la cuenta no tiene ninguna: devolvérselas a quien las
  // borró sería discutirle una decisión suya.
  await sembrarReglasPorDefecto(ctx.db, ctx.workspaceId)

  return { ...agent, nota: 'Queda pausado. Revísalo y actívalo cuando estés listo.' }
}

async function activarAgente(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.agent_id)
  const activo = args.activo !== false

  const { data: cur } = await ctx.db
    .from('ai_agents')
    .select('id, name, scope, role, voice_enabled, ai_agent_channels(channel)')
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  const fila = cur as
    | {
        id: string
        name: string
        scope: string
        role?: string | null
        voice_enabled?: boolean | null
        ai_agent_channels?: { channel: string }[]
      }
    | null
  if (!fila) throw new Error('ese agente no existe en esta cuenta')

  if (activo) {
    const conflicto = await findChannelConflict(ctx.db, {
      workspaceId: ctx.workspaceId,
      agentId: id,
      scope: fila.scope,
      channels: (fila.ai_agent_channels ?? []).map((c) => c.channel),
      voiceEnabled: fila.voice_enabled !== false,
      role: fila.role,
    })
    if (conflicto) {
      throw new Error(
        `«${conflicto.agentName}» ya atiende ${channelLabels(conflicto.channels, ctx.locale)} con el mismo rol. Pausalo o cambiá el rol de este.`,
      )
    }
  }

  const { data, error } = await ctx.db
    .from('ai_agents')
    .update({ is_active: activo })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .select('id, name, is_active, role')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------
// La configuración, en palabras

/** Los mismos nombres que muestra la pantalla: un tono no puede llamarse de dos formas. */
const TONOS: Record<AiTone, string> = {
  friendly: 'cercano — cálido, conversacional, frases cortas',
  formal: 'formal — profesional, distancia respetuosa',
  casual: 'coloquial — directo, modismos suaves',
  concise: 'breve — una o dos frases, sin rodeos',
}

const PERMISOS_EN_PALABRAS: Record<AgentPermission, string> = {
  crear_pedidos: 'crear pedidos',
  crear_checkout: 'enviar link de pago',
  registrar_pago: 'registrar un pago informado',
  editar_pedido: 'editar un pedido',
  escalar_llamada: 'llamar por teléfono',
  enviar_proactivo: 'escribir primero',
}

const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Las claves que se aceptan al escribir un horario, sin tildes y en minúscula. */
const DIA_POR_NOMBRE: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
}

function sinTildes(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

interface FilaAgente {
  id: string
  name: string
  role?: string | null
  permissions?: AgentPermissions | null
  puede_crear_pedidos?: boolean | null
  escalate_keywords?: string[] | null
  business_hours?: BusinessHours | null
  reply_outside_hours?: boolean | null
}

/** Lo que tiene permitido y lo que no, por `agentCan` y no por la columna cruda. */
function permisosEnPalabras(fila: FilaAgente): { puede: string[]; no_puede: string[] } {
  const puede: string[] = []
  const no_puede: string[] = []
  for (const p of AGENT_PERMISSIONS) {
    ;(agentCan(fila, p) ? puede : no_puede).push(PERMISOS_EN_PALABRAS[p])
  }
  return { puede, no_puede }
}

/**
 * El horario tal como se comporta, no como está guardado.
 *
 * Son dos columnas y una sola pregunta: `reply_outside_hours` en true anula el
 * horario entero. Mostrar las ventanas sin decir eso es la forma más rápida de
 * que alguien jure que configuró 9 a 18 y no entienda por qué contesta a las 3
 * de la mañana.
 */
function horarioEnPalabras(fila: FilaAgente): Record<string, unknown> {
  const franjasPorDia = Object.entries(fila.business_hours?.windows ?? {})
    .map(([d, franjas]) => ({ dia: Number(d), franjas: (franjas ?? []) as string[] }))
    .filter((x) => x.franjas.length > 0)
    .sort((a, b) => a.dia - b.dia)

  const escrito = franjasPorDia
    .map((x) => `${NOMBRE_DIA[x.dia] ?? x.dia} ${x.franjas.join(' y ')}`)
    .join(', ')

  if (fila.reply_outside_hours !== false) {
    return {
      atiende: 'a toda hora',
      ...(escrito
        ? { nota: `hay un horario escrito (${escrito}) pero no lo limita: contesta igual fuera de él` }
        : {}),
    }
  }
  if (!escrito) return { atiende: 'a toda hora' }
  return {
    atiende: escrito,
    zona_horaria: fila.business_hours?.timezone ?? null,
    fuera_de_horario: 'no contesta',
  }
}

async function detalle(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { data } = await ctx.db
    .from('ai_agents')
    .select(
      'id, name, is_active, role, permissions, puede_crear_pedidos, persona, knowledge, knowledge_url, language, tone, scope, product_scope, priority, requires_approval, reply_when_assigned, reply_outside_hours, business_hours, escalate_keywords, escalate_after_messages, followup_enabled, followup_delay_hours, followup_max_count, voice_enabled, created_at, ai_agent_channels(channel)',
    )
    .eq('id', String(args.agent_id))
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .maybeSingle()

  const fila = data as
    | (FilaAgente & {
        is_active: boolean
        persona: string | null
        knowledge: string | null
        knowledge_url: string | null
        language: string
        tone: AiTone
        scope: string
        product_scope: string
        priority: number
        requires_approval: boolean | null
        reply_when_assigned: boolean | null
        escalate_after_messages: number | null
        followup_enabled: boolean | null
        followup_delay_hours: number | null
        followup_max_count: number | null
        voice_enabled: boolean | null
        created_at: string
        ai_agent_channels?: { channel: string }[]
      })
    | null
  if (!fila) throw new Error('ese agente no existe en esta cuenta')

  const rol = isAgentRole(fila.role) ? fila.role : 'general'
  const { puede, no_puede } = permisosEnPalabras(fila)

  return {
    id: fila.id,
    nombre: fila.name,
    estado: fila.is_active ? 'atendiendo' : 'pausado',
    rol,
    trabajo: ROLE_BEHAVIOR[rol] ?? 'Atiende cualquier consulta: no tiene un trabajo asignado.',
    tono: TONOS[fila.tone] ?? fila.tone,
    idioma: fila.language,
    persona: fila.persona || null,
    conocimiento: fila.knowledge
      ? `${fila.knowledge.length} caracteres de texto propio`
      : 'ninguno propio (usa lo que sabe de los productos)',
    sitio_del_conocimiento: fila.knowledge_url,
    // `workspace` ocupa todos los canales aunque la tabla esté vacía: sin esto
    // un agente de cuenta parece no atender nada.
    canales:
      fila.scope === 'workspace'
        ? 'todos'
        : (fila.ai_agent_channels ?? []).map((c) => c.channel),
    productos: fila.product_scope === 'all' ? 'todo el catálogo' : 'sólo los elegidos',
    horario: horarioEnPalabras(fila),
    responde: fila.requires_approval
      ? 'escribe la respuesta y espera que una persona la mande'
      : 'contesta solo',
    si_ya_hay_alguien_asignado: fila.reply_when_assigned
      ? 'contesta igual'
      : 'se calla y la deja a esa persona',
    escala_si_dicen: fila.escalate_keywords ?? [],
    escala_tras_mensajes: fila.escalate_after_messages,
    puede,
    no_puede,
    seguimiento: fila.followup_enabled
      ? `sí, a las ${fila.followup_delay_hours ?? 0} h de silencio, hasta ${fila.followup_max_count ?? 0} ${
          (fila.followup_max_count ?? 0) === 1 ? 'vez' : 'veces'
        }`
      : 'no',
    voz: fila.voice_enabled ? 'atiende llamadas' : 'no atiende llamadas',
    prioridad: fila.priority,
    desde: fila.created_at,
  }
}

// ---------------------------------------------------------------------------
// Editar

/**
 * Un horario escrito en palabras se convierte en las DOS columnas que lo mandan.
 *
 * El runner calla al agente sólo si `reply_outside_hours` es false: guardar las
 * ventanas y no tocar esa columna deja un horario que no limita nada, y desde
 * afuera parece que se guardó bien. Por eso acá el horario es un control único,
 * igual que en la pantalla — poner días lo enciende, no poner ninguno lo apaga.
 */
function leerHorario(
  valor: unknown,
  actual: BusinessHours | null | undefined,
): { business_hours: BusinessHours | null; reply_outside_hours: boolean; dicho: string } {
  const h = (valor ?? {}) as { zona_horaria?: unknown; dias?: Record<string, unknown> }
  const dias = (h.dias ?? {}) as Record<string, unknown>

  const windows: BusinessHours['windows'] = {}
  const escritos: string[] = []
  for (const [nombre, franjas] of Object.entries(dias)) {
    const dia = DIA_POR_NOMBRE[sinTildes(nombre)]
    if (dia === undefined) {
      throw new Error(
        `No entiendo el día "${nombre}". Los días son: ${Object.keys(DIA_POR_NOMBRE).join(', ')}.`,
      )
    }
    const lista = (Array.isArray(franjas) ? franjas : [])
      .filter((f): f is string => typeof f === 'string')
      .map((f) => f.trim())
      .filter(Boolean)
    for (const f of lista) validarFranja(f, nombre)
    if (lista.length > 0) {
      windows[dia as 0 | 1 | 2 | 3 | 4 | 5 | 6] = lista
      escritos.push(`${NOMBRE_DIA[dia]} ${lista.join(' y ')}`)
    }
  }

  if (escritos.length === 0) {
    return { business_hours: null, reply_outside_hours: true, dicho: 'atiende a toda hora' }
  }

  const zona =
    typeof h.zona_horaria === 'string' && h.zona_horaria.trim()
      ? h.zona_horaria.trim()
      : (actual?.timezone ?? 'America/Bogota')
  validarZona(zona)

  return {
    business_hours: { timezone: zona, windows },
    reply_outside_hours: false,
    dicho: `atiende ${escritos.join(', ')} (hora de ${zona})`,
  }
}

/**
 * Una franja mal escrita no falla: cierra el agente.
 *
 * `withinBusinessHours` no entiende "9 a 18" y devuelve que la ventana no
 * aplica, así que el agente deja de contestar en horario laboral y no queda
 * ningún error en ningún lado. Preferimos rechazar el cambio acá, donde todavía
 * hay alguien mirando.
 */
function validarFranja(franja: string, dia: string): void {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(franja)
  const nums = m ? m.slice(1).map(Number) : null
  const valida =
    nums !== null &&
    nums[0] <= 24 &&
    nums[1] <= 59 &&
    nums[2] <= 24 &&
    nums[3] <= 59
  if (!valida) {
    throw new Error(
      `La franja "${franja}" de ${dia} no vale: se escribe HH:mm-HH:mm, por ejemplo 09:00-18:00.`,
    )
  }
}

/**
 * Una zona horaria inventada tampoco falla: apaga el horario.
 *
 * `withinBusinessHours` atrapa el error de `Intl` y devuelve true, o sea 24/7.
 * Un "Bogota" a secas o un "GMT-5" —las dos formas en que se escribe una zona
 * cuando no se sabe que se escriben así— dejarían al agente contestando de
 * madrugada sin una sola señal de que el horario no se aplicó.
 */
function validarZona(zona: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona })
  } catch {
    throw new Error(
      `La zona horaria "${zona}" no existe. Se escribe como America/Bogota o America/Argentina/Buenos_Aires.`,
    )
  }
}

/** Los campos de `ai_agents` que toca este cambio, y qué se movió en palabras. */
interface Cambio {
  patch: Record<string, unknown>
  dichos: string[]
}

function armarCambio(fila: FilaAgente, args: Record<string, unknown>): Cambio {
  const patch: Record<string, unknown> = {}
  const dichos: string[] = []

  if (typeof args.nombre === 'string') {
    const nombre = args.nombre.trim()
    if (!nombre) throw new Error('El nombre no puede quedar vacío.')
    patch.name = nombre
    dichos.push(`se llama «${nombre}»`)
  }

  if (typeof args.tono === 'string') {
    if (!(args.tono in TONOS)) {
      throw new Error(`El tono "${args.tono}" no existe. Los que hay: ${Object.keys(TONOS).join(', ')}.`)
    }
    patch.tone = args.tono
    dichos.push(`tono ${TONOS[args.tono as AiTone].split(' —')[0]}`)
  }

  if (typeof args.persona === 'string') {
    const persona = args.persona.trim()
    // Vaciarla deja al agente sin nada que decir de la marca y sigue
    // contestando igual, con lo que sepa el modelo. Si alguien la quiere
    // borrar, que lo haga en la pantalla y lo vea.
    if (!persona) throw new Error('La persona no puede quedar vacía.')
    patch.persona = persona
    dichos.push('cambia cómo se presenta y actúa')
  }

  if (args.horario !== undefined) {
    const h = leerHorario(args.horario, fila.business_hours)
    patch.business_hours = h.business_hours
    patch.reply_outside_hours = h.reply_outside_hours
    dichos.push(h.dicho)
  }

  if (args.escalar_palabras !== undefined) {
    if (!Array.isArray(args.escalar_palabras)) {
      throw new Error('escalar_palabras es una lista de palabras.')
    }
    const palabras = args.escalar_palabras
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean)
    patch.escalate_keywords = palabras
    dichos.push(
      palabras.length > 0
        ? `pasa a una persona si dicen: ${palabras.join(', ')}`
        : 'ya no pasa a una persona por ninguna palabra',
    )
  }

  if (args.permisos !== undefined) {
    if (typeof args.permisos !== 'object' || args.permisos === null || Array.isArray(args.permisos)) {
      throw new Error('permisos es un objeto de acción → true/false.')
    }
    const pedidos = args.permisos as Record<string, unknown>
    const nuevos: AgentPermissions = {}
    for (const [k, v] of Object.entries(pedidos)) {
      if (!(AGENT_PERMISSIONS as readonly string[]).includes(k)) {
        throw new Error(
          `No existe el permiso "${k}". Los que hay: ${AGENT_PERMISSIONS.join(', ')}.`,
        )
      }
      if (typeof v !== 'boolean') throw new Error(`El permiso "${k}" es true o false.`)
      nuevos[k as AgentPermission] = v
    }
    // Se MEZCLA con lo que ya tenía: mandar sólo `crear_pedidos` no puede
    // apagar los otros cinco sin que nadie lo haya pedido.
    const permissions: AgentPermissions = { ...(fila.permissions ?? {}), ...nuevos }
    patch.permissions = permissions
    for (const [k, v] of Object.entries(nuevos)) {
      dichos.push(`${v ? 'puede' : 'no puede'} ${PERMISOS_EN_PALABRAS[k as AgentPermission]}`)
    }
    // La voz y el super-agente leen `puede_crear_pedidos` directo, sin pasar por
    // `agentCan`. Si sólo se escribiera `permissions`, el mismo agente cerraría
    // pedidos por teléfono y no por chat (o al revés). Se guardan iguales.
    if ('crear_pedidos' in nuevos) patch.puede_crear_pedidos = nuevos.crear_pedidos === true
  }

  if (dichos.length === 0) {
    throw new Error(
      'No hay nada que cambiar: mandá al menos uno de nombre, tono, persona, horario, escalar_palabras o permisos.',
    )
  }
  return { patch, dichos }
}

/** El agente que se va a editar, con lo que hace falta para armar el cambio. */
async function traerParaEditar(ctx: CapabilityContext, agentId: string): Promise<FilaAgente> {
  const { data } = await ctx.db
    .from('ai_agents')
    .select('id, name, role, permissions, puede_crear_pedidos, escalate_keywords, business_hours, reply_outside_hours')
    .eq('id', agentId)
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  const fila = data as FilaAgente | null
  if (!fila) throw new Error('ese agente no existe en esta cuenta')
  return fila
}

async function editar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const fila = await traerParaEditar(ctx, String(args.agent_id))
  const { patch, dichos } = armarCambio(fila, args)

  // Por `updateAgent` y no por un UPDATE propio: es la misma puerta que usa la
  // pantalla, con la misma validación de choque de canal. Un agente activo al
  // que se le cambia el rol puede quedar disputando WhatsApp con otro, y esa
  // regla no puede tener dos versiones.
  const salida = await updateAgent(ctx.db, {
    agentId: fila.id,
    workspaceId: ctx.workspaceId,
    patch,
  })
  if (!salida.ok) {
    if (salida.fail.code === 'channel_conflict') {
      throw new Error(
        `«${salida.fail.agentName}» ya atiende ${channelLabels(salida.fail.channels, ctx.locale)} con el mismo rol.`,
      )
    }
    if (salida.fail.code === 'channels_required') {
      throw new Error(
        'ese agente atiende canales elegidos y no tiene ninguno: elegí al menos uno antes de editarlo',
      )
    }
    if (salida.fail.code === 'voice_agent_invalid') {
      throw new Error('el agente de voz vinculado ya no está disponible')
    }
    throw new Error((salida.fail.error as { message?: string })?.message ?? 'no se pudo guardar')
  }

  const guardado = (salida.agent ?? fila) as FilaAgente
  const rol = isAgentRole(guardado.role) ? guardado.role : 'general'
  return {
    id: fila.id,
    nombre: guardado.name,
    rol,
    cambios: dichos,
    ...permisosEnPalabras(guardado),
    escala_si_dicen: guardado.escalate_keywords ?? [],
  }
}

/**
 * El agente como quedó guardado, para el panel.
 *
 * Lo mismo que hace la capacidad de editar con su resultado, pero leyendo la
 * fila: es lo que separa «esto es lo que pedí» de «esto es lo que hay».
 */
export async function artefactoGuardadoDeAgente(
  ctx: CapabilityContext,
  agentId: string,
): Promise<Artefacto | null> {
  const { data } = await ctx.db
    .from('ai_agents')
    .select('id, name, role, permissions, escalate_keywords')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', agentId)
    .maybeSingle()
  const fila = data as {
    id: string
    name: string
    role: string | null
    permissions: Record<string, boolean> | null
    escalate_keywords: string[] | null
  } | null
  if (!fila) return null
  return {
    kind: 'agente',
    nombre: fila.name,
    rol: fila.role ?? 'general',
    puede: Object.entries(fila.permissions ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k.replace(/_/g, ' ')),
    escala: fila.escalate_keywords ?? [],
    base: { id: fila.id, nombre: fila.name },
  }
}

// ---------------------------------------------------------------------------
// LAS REGLAS DEL NEGOCIO.
//
// El agente las lee en cada respuesta —`cargarReglas` las mete en el prompt— y
// el Operador no las conocía. Eso lo dejaba explicando por qué la IA contestó
// algo sin poder ver la instrucción que se lo hizo contestar, y le impedía la
// mitad más útil: agregar la regla que faltaba.
//
// Van con `agentes.` y no con un dominio propio porque son eso: cómo se
// comporta la IA. Una regla sin agente vale para todos los de la cuenta.
// ---------------------------------------------------------------------------

const MAX_TITULO = 80
const MAX_TEXTO = 600

async function reglas(ctx: CapabilityContext, args: Record<string, unknown>) {
  let q = ctx.db
    .from('agent_guidance')
    .select('id, agent_id, titulo, cuando, hacer, activa, orden, origen, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(100)
  if (args.solo_activas === true) q = q.eq('activa', true)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as Array<{
    id: string
    agent_id: string | null
    titulo: string
    cuando: string | null
    hacer: string
    activa: boolean
    orden: number
    origen: string
    created_at: string
  }>

  // El nombre del agente y no su uuid, y sólo si alguna regla es de uno.
  const nombres = new Map<string, string>()
  if (filas.some((r) => r.agent_id)) {
    const { data: ags } = await ctx.db
      .from('ai_agents')
      .select('id, name')
      .eq('workspace_id', ctx.workspaceId)
    for (const a of (ags ?? []) as Array<{ id: string; name: string }>) {
      nombres.set(a.id, a.name)
    }
  }

  return {
    // Sólo las primeras entran al prompt: pasado el tope, una regla nueva no
    // cambia nada y hay que apagar otra.
    entran_al_prompt: MAX_REGLAS,
    reglas: filas.map((r) => ({
      regla_id: r.id,
      titulo: r.titulo,
      cuando: r.cuando,
      hacer: r.hacer,
      activa: r.activa,
      orden: r.orden,
      // 'pliego' = salió del cuestionario de alta; 'comercio' = la escribió una
      // persona.
      origen: r.origen,
      para: r.agent_id ? (nombres.get(r.agent_id) ?? r.agent_id) : 'todos los agentes',
    })),
  }
}

async function crearRegla(ctx: CapabilityContext, args: Record<string, unknown>) {
  const titulo = String(args.titulo ?? '').trim().slice(0, MAX_TITULO)
  const hacer = String(args.hacer ?? '').trim().slice(0, MAX_TEXTO)
  if (!titulo) throw new Error('Falta el título de la regla.')
  if (!hacer) throw new Error('Falta qué tiene que hacer el agente.')

  const cuando =
    typeof args.cuando === 'string' && args.cuando.trim()
      ? args.cuando.trim().slice(0, MAX_TEXTO)
      : null

  const { count } = await ctx.db
    .from('agent_guidance')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)
    .eq('activa', true)
  if ((count ?? 0) >= MAX_REGLAS) {
    throw new Error(
      `Ya hay ${count} reglas activas y al prompt entran ${MAX_REGLAS}. Apagá una antes de sumar otra.`,
    )
  }

  const { data, error } = await ctx.db
    .from('agent_guidance')
    .insert({
      workspace_id: ctx.workspaceId,
      agent_id: typeof args.agent_id === 'string' && args.agent_id ? args.agent_id : null,
      titulo,
      cuando,
      hacer,
      // Nace APAGADA: una regla nueva cambia lo que la IA le contesta a un
      // cliente en el próximo mensaje, y eso lo prende una persona.
      activa: false,
      orden: (count ?? 0) + 1,
      origen: 'comercio',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  return { regla_id: (data as { id: string }).id, titulo, cuando, hacer, activa: false }
}

async function reglaPorId(ctx: CapabilityContext, id: string) {
  const { data } = await ctx.db
    .from('agent_guidance')
    .select('id, titulo, hacer, activa')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!data) throw new Error('Esa regla no existe en esta cuenta.')
  return data as { id: string; titulo: string; hacer: string; activa: boolean }
}

async function activarRegla(ctx: CapabilityContext, args: Record<string, unknown>) {
  const regla = await reglaPorId(ctx, String(args.regla_id ?? '').trim())
  const activa = args.activa === true

  const { error } = await ctx.db
    .from('agent_guidance')
    .update({ activa })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', regla.id)
  if (error) throw new Error(error.message)

  return { regla_id: regla.id, titulo: regla.titulo, activa }
}

/**
 * LOS DESCUENTOS QUE DIO LA IA.
 *
 * Cada fila es un cupón que el agente creó en la tienda y le pasó a un cliente
 * concreto. Es plata regalada con permiso, y no había forma de verla junta.
 */
async function descuentos(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 30, 100)
  const { data, error } = await ctx.db
    .from('agent_discounts')
    .select('id, code, percent, shop_domain, redeemed_at, created_at, conversation_id, contacts(name, phone)')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    code: string
    percent: number | null
    shop_domain: string | null
    redeemed_at: string | null
    created_at: string
    conversation_id: string | null
    contacts: { name: string | null; phone: string | null } | null
  }>

  return {
    usados: filas.filter((d) => d.redeemed_at).length,
    descuentos: filas.map((d) => ({
      codigo: d.code,
      porcentaje: d.percent,
      cliente: d.contacts?.name ?? d.contacts?.phone ?? 'sin nombre',
      tienda: d.shop_domain,
      cuando: d.created_at,
      // Si lo usó de verdad: un cupón dado y no usado no costó nada.
      usado_el: d.redeemed_at,
      conversation_id: d.conversation_id,
    })),
  }
}


/**
 * Los agentes y sus reglas, dibujados.
 *
 * El detalle de un agente reusa el kind `agente` que el banco ya dibuja al
 * crearlo: mirar el que existe y aprobar el que se está armando tienen que
 * verse igual, o compararlos obliga a traducir entre dos formas.
 */
function vistaAgente(ctx: CapabilityContext, r: Awaited<ReturnType<typeof detalle>>): Artefacto | null {
  if (!tieneCampos(r, 'nombre', 'puede')) return null
  return {
    kind: 'agente',
    nombre: String(r.nombre),
    rol: [r.trabajo, r.estado].filter(Boolean).map(String).join(' · '),
    puede: lista<string>(r, 'puede'),
    escala: lista<string>(r, 'escala_si_dicen'),
  }
}

function vistaAgentes(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    name: string
    is_active: boolean
    scope: string
    canales: string | string[]
    priority?: number
  }>(r)
  return tabla({
    titulo: tt(ctx, 'operation.subAgentes'),
    columnas: [
      { clave: 'nombre', titulo: tt(ctx, 'operation.vColNombre') },
      { clave: 'canales', titulo: tt(ctx, 'operation.vColCanal') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
    ],
    filas: filas.map((a) => ({
      nombre: corto(a.name, 30),
      canales: Array.isArray(a.canales) ? corto(a.canales.join(', '), 30) : String(a.canales),
      estado: a.is_active ? tt(ctx, 'operation.vAtendiendo') : tt(ctx, 'operation.vPausado'),
    })),
    vacio: tt(ctx, 'operation.vSinAgentes'),
  })
}

/**
 * Las reglas del negocio.
 *
 * Sólo las primeras entran al prompt, así que la lista se lee EN ORDEN: pasado
 * el tope, una regla más no cambia nada y hay que apagar otra. Por eso el
 * encabezado dice cuántas entran y las apagadas no se esconden.
 */
function vistaReglasNegocio(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    titulo: string
    cuando: string | null
    hacer: string
    activa: boolean
    para: string
  }>(r, 'reglas')
  const entran = (r as { entran_al_prompt?: number } | null)?.entran_al_prompt
  return tabla({
    titulo: tt(ctx, 'operation.vTitReglasNegocio'),
    columnas: [
      { clave: 'titulo', titulo: tt(ctx, 'operation.vColRegla') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuandoAplica') },
      { clave: 'hacer', titulo: tt(ctx, 'operation.vColQueHace') },
      { clave: 'para', titulo: tt(ctx, 'operation.vColPara') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
    ],
    filas: filas.map((g) => ({
      titulo: corto(g.titulo, 26),
      cuando: corto(g.cuando, 34),
      hacer: corto(g.hacer, 40),
      para: corto(g.para, 18),
      estado: g.activa ? tt(ctx, 'operation.vEncendida') : tt(ctx, 'operation.vApagada'),
    })),
    total: entran != null && filas.length > entran ? filas.length : undefined,
    vacio: tt(ctx, 'operation.vSinReglas'),
  })
}

/**
 * Los descuentos que dio la IA.
 *
 * Es plata regalada con permiso. La columna que cierra la cuenta es si lo
 * usaron: un cupón dado y no usado no costó nada, y sin esa columna la lista
 * asusta el doble de lo que corresponde.
 */
function vistaDescuentos(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    codigo: string
    porcentaje: number | null
    cliente: string
    cuando: string
    usado_el: string | null
  }>(r, 'descuentos')
  return tabla({
    titulo: tt(ctx, 'operation.vTitDescuentos'),
    columnas: [
      { clave: 'codigo', titulo: tt(ctx, 'operation.vColCodigo') },
      { clave: 'cliente', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuando') },
      { clave: 'usado', titulo: tt(ctx, 'operation.vColUsado') },
      { clave: 'porcentaje', titulo: tt(ctx, 'operation.vColDescuento'), alineado: 'der' },
    ],
    filas: filas.map((d) => ({
      codigo: corto(d.codigo, 18),
      cliente: corto(d.cliente, 22),
      cuando: fecha(ctx, d.cuando),
      usado: d.usado_el ? fecha(ctx, d.usado_el) : tt(ctx, 'operation.vNo'),
      porcentaje: d.porcentaje != null ? `${d.porcentaje} %` : '—',
    })),
    vacio: tt(ctx, 'operation.vSinDescuentos'),
  })
}

/** Prender o pausar un agente: es cuándo empieza o deja de contestarle a gente. */
function vistaActivarAgente(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const prende = args.activa === true
  return cambio({
    titulo: tt(ctx, prende ? 'operation.vTitPrenderAgente' : 'operation.vTitPausarAgente'),
    que: tt(ctx, prende ? 'operation.vQuePrenderAgente' : 'operation.vQuePausarAgente'),
  })
}

/** Una regla nueva, con su texto entero: es lo que la IA va a obedecer. */
function vistaCrearRegla(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const t = (k: string) => tt(ctx, `operation.${k}`)
  return cambio({
    titulo: corto(args.titulo, 60),
    que: t('vQueCrearRegla'),
    campos: [
      ...(typeof args.cuando === 'string' && args.cuando
        ? [{ etiqueta: t('vColCuandoAplica'), despues: String(args.cuando) }]
        : []),
      { etiqueta: t('vColQueHace'), despues: String(args.hacer ?? '') },
    ],
    // Nace apagada: decirlo evita que alguien apruebe creyendo que ya rige.
    aviso: t('vReglaNaceApagada'),
  })
}

/** Prender o apagar una regla: cambia lo que la IA contesta en el próximo mensaje. */
function vistaActivarRegla(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const prende = args.activa === true
  return cambio({
    titulo: tt(ctx, 'operation.vTitReglasNegocio'),
    que: tt(ctx, prende ? 'operation.vQuePrenderRegla' : 'operation.vQueApagarRegla'),
  })
}
export const AGENT_CAPABILITIES: Capability[] = [
  {
    key: 'agentes.reglas',
    description:
      'Las reglas del negocio que los agentes obedecen en cada respuesta: cuándo aplica cada una y qué tienen que hacer. Una regla sin agente vale para todos. Dice también cuántas entran al prompt: pasadas esas, una regla más no cambia nada. Es lo primero que hay que mirar cuando la IA contestó algo raro.',
    descriptionEn:
      'The business rules the agents obey on every reply: when each one applies and what they must do. A rule with no agent applies to all of them. It also says how many fit in the prompt: past that, one more rule changes nothing. This is the first thing to check when the AI answered something odd.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { solo_activas: { type: 'boolean' } },
    },
    run: reglas,
    vista: (ctx, _args, r) => vistaReglasNegocio(ctx, r),
  },

  {
    key: 'agentes.crear_regla',
    description:
      'Escribe una regla del negocio, APAGADA. Cuando se prenda, todos los agentes (o el que se indique) la obedecen en cada respuesta. Se escribe en las palabras del comercio: "cuándo" es la situación y "hacer" es qué tiene que hacer la IA.',
    descriptionEn:
      'Writes a business rule, switched OFF. Once turned on, every agent (or the one given) obeys it on each reply. It is written in the merchant words: "cuándo" is the situation and "hacer" is what the AI must do.',
    risk: 'reversible',
    // Nace apagada: no cambia ninguna respuesta hasta que alguien la prenda.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: `Cómo se llama la regla. Hasta ${MAX_TITULO} caracteres.` },
        cuando: { type: 'string', description: 'En qué situación aplica. Vacío = siempre.' },
        hacer: { type: 'string', description: 'Qué tiene que hacer el agente.' },
        agent_id: { type: 'string', description: 'Vacío = vale para todos los agentes.' },
      },
      required: ['titulo', 'hacer'],
    },
    async preview(_ctx, args) {
      const cuando = typeof args.cuando === 'string' && args.cuando.trim() ? ` Cuando ${args.cuando}.` : ''
      return `Guardaría la regla «${args.titulo}», apagada.${cuando} Al prenderla, la IA hará: ${args.hacer}`
    },
    run: crearRegla,
    artifact: (ctx, args) => vistaCrearRegla(ctx, args),
  },

  {
    key: 'agentes.activar_regla',
    description:
      'Prende o apaga una regla del negocio. Prenderla cambia lo que la IA le contesta a un cliente en el próximo mensaje. Se deshace llamando de nuevo.',
    descriptionEn:
      'Turns a business rule on or off. Turning it on changes what the AI replies to a customer on the next message. Undone by calling it again.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        regla_id: { type: 'string', description: 'El id que devuelve agentes.reglas.' },
        activa: { type: 'boolean' },
      },
      required: ['regla_id', 'activa'],
    },
    async preview(ctx, args) {
      const regla = await reglaPorId(ctx, String(args.regla_id ?? '').trim())
      return args.activa === true
        ? `Prendería la regla «${regla.titulo}». Desde el próximo mensaje la IA hará: ${regla.hacer}`
        : `Apagaría la regla «${regla.titulo}». La IA deja de tenerla en cuenta.`
    },
    run: activarRegla,
    artifact: (ctx, args) => vistaActivarRegla(ctx, args),
  },

  {
    key: 'agentes.descuentos',
    description:
      'Los descuentos que la IA le dio a clientes: el código, el porcentaje, a quién, y si lo usó. Es plata regalada con permiso, y sirve para saber si el permiso está bien puesto.',
    descriptionEn:
      'The discounts the AI gave customers: the code, the percentage, to whom, and whether it was redeemed. It is money given away with permission, and it shows whether that permission is set right.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { limite: { type: 'number', description: 'Por defecto 30, máximo 100.' } },
    },
    run: descuentos,
    vista: (ctx, _args, r) => vistaDescuentos(ctx, r),
  },
  {
    key: 'agentes.listar',
    description:
      'Los agentes de IA de la cuenta: si están activos, qué canales atienden, si pueden cerrar pedidos, si tienen voz y seguimiento.',
    descriptionEn:
      'The AI agents of the account: whether they are active, which channels they cover, whether they can close orders, and whether they have voice and follow-ups.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: listar,
    vista: (ctx, _args, r) => vistaAgentes(ctx, r),
  },

  {
    key: 'agentes.crear_borrador',
    description:
      'Crea un agente con el preset de su rol (qué puede hacer, qué escala a una persona, si hace seguimiento). Nace pausado: no le contesta a nadie hasta que se active.',
    descriptionEn:
      'Creates an agent with its role preset (what it can do, what it escalates to a human, whether it follows up). It starts paused: it answers nobody until activated.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        rol: {
          type: 'string',
          enum: ['general', 'ventas', 'postventa', 'recuperacion', 'retencion'],
        },
        persona: { type: 'string', description: 'Cómo habla y qué sabe del negocio.' },
        conocimiento: { type: 'string' },
        canales: {
          type: 'array',
          items: { type: 'string' },
          description: 'Vacío = atiende todos los canales de la cuenta.',
        },
      },
      required: ['nombre', 'rol'],
    },
    // Nace pausado: no le contesta a nadie hasta que se lo active.
    inerte: true,
    async preview(ctx, args) {
      const rol = isAgentRole(args.rol) ? args.rol : 'general'
      const preset = roleTemplate(rol)
      const puede = preset
        ? Object.entries(preset.permissions)
            .filter(([, v]) => v)
            .map(([k]) => k.replace(/_/g, ' '))
            .join(', ')
        : 'lo que permita la tienda conectada'
      return `Crearía el agente «${args.nombre}» con rol ${rol}, pausado. Podría: ${puede}.`
    },
    // `editar` dibujaba y `crear` no, que es al revés de lo que sirve: cuando
    // más falta hace ver qué te van a dejar es al crearlo.
    artifact(_ctx, args) {
      const rol = isAgentRole(args.rol) ? args.rol : 'general'
      const preset = roleTemplate(rol)
      const nombre = String(args.nombre ?? '').trim()
      if (!nombre) return null
      return {
        kind: 'agente',
        nombre,
        rol,
        puede: Object.entries(preset?.permissions ?? {})
          .filter(([, v]) => v)
          .map(([k]) => k.replace(/_/g, ' ')),
        escala: preset?.escalateKeywords ?? [],
      }
    },
    // Nació pausado y no le contestó a nadie: se borra y no pasó nada.
    async deshacer(ctx, _args, result) {
      const r = result as { id?: string; nombre?: string } | undefined
      if (!r?.id) throw new Error('No quedó registrado qué agente se creó.')
      await ctx.db
        .from('ai_agents')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', r.id)
        .eq('workspace_id', ctx.workspaceId)
      return `Se borró el agente «${r.nombre ?? 'sin nombre'}».`
    },
    run: crearBorrador,
  },

  {
    key: 'agentes.activar',
    description:
      'Prende o pausa un agente. Al prenderlo valida que no le dispute el canal a otro agente del mismo rol.',
    descriptionEn:
      'Turns an agent on or off. Turning it on checks that it does not compete for the channel with another agent of the same role.',
    // Prender es el momento en que empieza a hablarle a gente real, y eso no se
    // deshace para quien ya recibió el mensaje. `risk` es una sola etiqueta para
    // toda la capacidad, así que pausar también pide confirmación: de los dos
    // lados posibles, ése es el seguro. Los cuatro interruptores de la cuenta
    // —menús, reglas de comentario, automatizaciones y agentes— dicen lo mismo.
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        activo: { type: 'boolean' },
      },
      required: ['agent_id', 'activo'],
    },
    // Prenderlo lo pone a contestarle a clientes reales; pausarlo lo calla.
    inerte: (args) => args.activo === false,
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('ai_agents')
        .select('name')
        .eq('id', String(args.agent_id))
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      const nombre = (data as { name?: string } | null)?.name ?? 'ese agente'
      return args.activo !== false
        ? `Prendería «${nombre}». Empieza a contestarle a clientes reales.`
        : `Pausaría «${nombre}». Deja de contestar hasta que lo prendas.`
    },
    run: activarAgente,
    artifact: (ctx, args) => vistaActivarAgente(ctx, args),
  },

  {
    key: 'agentes.detalle',
    description:
      'Cómo está configurado un agente, en palabras: qué trabajo hace, cómo habla, qué sabe, cuándo atiende, qué lo hace pasar la conversación a una persona y qué tiene permitido hacer. Es lo que hay que leer antes de editarlo.',
    descriptionEn:
      "One agent's configuration in plain words: its job, how it speaks, what it knows, when it answers, what makes it hand over to a human, and what it is allowed to do. Read this before editing it.",
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { agent_id: { type: 'string' } },
      required: ['agent_id'],
    },
    run: detalle,
    vista: (ctx, _args, r) => vistaAgente(ctx, r as Awaited<ReturnType<typeof detalle>>),
  },

  {
    key: 'agentes.editar',
    description: `Cambia la configuración de un agente. Sólo estas cosas: el nombre, el tono, cómo se presenta y actúa (persona), el horario de atención, las palabras que pasan la conversación a una persona y los permisos por acción. Manda sólo lo que cambia; lo que no viaja queda como está.
Permisos: ${AGENT_PERMISSIONS.join(', ')}.
Para prenderlo o pausarlo está agentes.activar; el resto de la configuración se toca en la pantalla del agente.`,
    descriptionEn:
      "Changes an agent's configuration: name, tone, persona, business hours, the words that hand over to a human, and per-action permissions. Send only what changes. Use agentes.activar to turn it on or off.",
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        nombre: { type: 'string' },
        tono: {
          type: 'string',
          enum: ['friendly', 'formal', 'casual', 'concise'],
          description:
            'friendly = cercano; formal = profesional; casual = coloquial; concise = breve.',
        },
        persona: {
          type: 'string',
          description: 'Cómo se presenta y actúa. Reemplaza la anterior entera.',
        },
        horario: {
          type: 'object',
          description:
            'Horario de atención. Sin días, atiende a toda hora. Fuera del horario no contesta.',
          properties: {
            zona_horaria: {
              type: 'string',
              description: 'IANA, por ejemplo America/Bogota. Por defecto, la que ya tenía.',
            },
            dias: {
              type: 'object',
              description:
                'Por día, las franjas "HH:mm-HH:mm". Claves: lunes, martes, miercoles, jueves, viernes, sabado, domingo. Una franja que termina antes de empezar cruza la medianoche (22:00-02:00). Reemplaza el horario entero.',
              properties: {
                lunes: { type: 'array', items: { type: 'string' } },
                martes: { type: 'array', items: { type: 'string' } },
                miercoles: { type: 'array', items: { type: 'string' } },
                jueves: { type: 'array', items: { type: 'string' } },
                viernes: { type: 'array', items: { type: 'string' } },
                sabado: { type: 'array', items: { type: 'string' } },
                domingo: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        escalar_palabras: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Si el cliente escribe alguna, la conversación pasa a una persona. Reemplaza la lista entera; vacía = ninguna.',
        },
        permisos: {
          type: 'object',
          description:
            'Acción → true/false. Sólo las que se mandan cambian. crear_pedidos, crear_checkout, registrar_pago, editar_pedido, escalar_llamada, enviar_proactivo.',
          properties: Object.fromEntries(
            AGENT_PERMISSIONS.map((p) => [p, { type: 'boolean' }]),
          ),
        },
      },
      required: ['agent_id'],
    },
    async preview(ctx, args) {
      try {
        const fila = await traerParaEditar(ctx, String(args.agent_id))
        const { dichos } = armarCambio(fila, args)
        return `En «${fila.name}»: ${dichos.join('; ')}.`
      } catch (e) {
        // Lanzar y no devolver: si no se puede describir el cambio, no hay
        // nada que aprobar. Devolviéndolo quedaba una tarjeta con el motivo
        // escrito donde va la descripción, y su botón intacto.
        throw e
      }
    },
    // Sólo con el resultado: cómo queda el agente depende de lo que ya tenía
    // guardado, y esto se calcula sin poder consultar la base. Dibujar sólo lo
    // que llegó en los argumentos mostraría un agente sin permisos ni nombre.
    artifact(_ctx, _args, result) {
      const r = result as
        | { id: string; nombre: string; rol: string; puede: string[]; escala_si_dicen: string[] }
        | undefined
      if (!r) return null
      return {
        kind: 'agente',
        nombre: r.nombre,
        rol: r.rol,
        puede: r.puede,
        escala: r.escala_si_dicen,
        base: { id: r.id, nombre: r.nombre },
      }
    },
    run: editar,
  },
]

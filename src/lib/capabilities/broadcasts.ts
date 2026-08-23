/**
 * Campañas: armarlas, lanzarlas y ver cómo salieron.
 *
 * El envío NO se implementa acá, y no es prolijidad: el fan-out real ya existe
 * y corre cada minuto en `app/api/broadcasts/cron/route.ts`. Ese cron reclama
 * las campañas `scheduled` que vencieron, resuelve las variables contacto por
 * contacto, respeta la baja, el cupo del WABA y el bloqueo de marketing a
 * Estados Unidos, y revive las que quedaron trabadas. Una segunda
 * implementación del envío sería una segunda forma de saltarse todo eso.
 *
 * La otra implementación que existe —`hooks/use-broadcast-sending.ts`— manda
 * desde la pestaña del navegador: si el comercio cierra la pestaña a mitad de
 * camino, la campaña queda a medias hasta que el cron la rescata. Un agente no
 * tiene pestaña, así que acá se escribe SÓLO lo que el cron sabe leer:
 *
 *   crear  → una fila en `broadcasts` con status 'draft' + sus
 *            `broadcast_recipients` en 'pending'. El cron nunca mira los
 *            borradores, así que crear no le llega a nadie.
 *   lanzar → esa misma fila pasa a 'scheduled' con su `scheduled_at`. Desde
 *            ese momento el próximo tick del cron la manda.
 *
 * Separar las dos cosas es lo que permite armar la campaña entera, mirarla, y
 * recién ahí decidir. Mientras está en borrador se puede borrar y no pasó nada.
 */
import {
  BROADCAST_VARIABLE_FIELDS,
  resolveContactField,
  templateVariableNumbers,
} from '@/lib/broadcasts/variables'
import { resolveSegment } from '@/lib/segments/resolve'
import type { SegmentMatchMode, SegmentRule } from '@/lib/segments/types'
import { idColumn } from '@/lib/short-id'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { Capability, CapabilityContext } from './types'

/** Filas por INSERT: una lista larga de destinatarios no entra en un solo pedido. */
const LOTE_INSERT = 200

/** Errores distintos que se muestran al explicar por qué falló una campaña. */
const TOPE_MOTIVOS = 5

type Contacto = Record<string, unknown> & { id: string }

interface Plantilla {
  name: string
  language: string | null
  status: string | null
  body_text: string | null
  header_type: string | null
  header_content: string | null
  buttons: unknown
}

interface Campana {
  id: string
  short_id: string | null
  name: string
  template_name: string
  template_language: string | null
  status: string
  scheduled_at: string | null
  user_id: string
  total_recipients: number | null
}

// ---------------------------------------------------------------------------

/** Acepta el uuid completo o el id corto de 8 que aparece en la URL. */
async function buscarCampana(ctx: CapabilityContext, raw: unknown): Promise<Campana> {
  const id = String(raw ?? '').trim()
  if (!id) throw new Error('Falta el id de la campaña.')
  const { data } = await ctx.db
    .from('broadcasts')
    .select(
      'id, short_id, name, template_name, template_language, status, scheduled_at, user_id, total_recipients',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq(idColumn(id), id)
    .maybeSingle()
  if (!data) throw new Error('Esa campaña no existe en esta cuenta.')
  return data as Campana
}

async function cargarPlantilla(
  ctx: CapabilityContext,
  nombre: string,
): Promise<Plantilla> {
  const { data } = await ctx.db
    .from('message_templates')
    .select('name, language, status, body_text, header_type, header_content, buttons')
    .eq('workspace_id', ctx.workspaceId)
    .eq('name', nombre)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) {
    throw new Error(
      `No existe la plantilla "${nombre}" en esta cuenta. Mirá plantillas.estado para ver los nombres exactos.`,
    )
  }
  return data as Plantilla
}

/**
 * Qué texto le va a llegar a cada variable, o por qué todavía no se puede.
 *
 * Meta llena los parámetros por POSICIÓN: si la plantilla tiene {{1}} y {{2}} y
 * la campaña sólo define {{2}}, ese valor sale en el lugar de {{1}} y el resto
 * queda vacío. Por eso se exige la lista completa acá y no al enviar, cuando el
 * único síntoma sería un error de Meta por campaña ya lanzada.
 */
function leerVariables(
  plantilla: Plantilla,
  args: Record<string, unknown>,
): { campos: Record<string, string>; textos: Record<string, string> } {
  const campos = objetoDeTextos(args.variables, 'variables')
  const textos = objetoDeTextos(args.textos_fijos, 'textos_fijos')

  for (const [n, campo] of Object.entries(campos)) {
    if (!BROADCAST_VARIABLE_FIELDS.includes(campo as never)) {
      throw new Error(
        `"${campo}" no es un campo del contacto. Los que valen: ${BROADCAST_VARIABLE_FIELDS.join(', ')}. Si querías un texto igual para todos, va en textos_fijos.`,
      )
    }
    if (textos[n] !== undefined) {
      throw new Error(`La variable {{${n}}} está declarada dos veces: elegí campo o texto fijo.`)
    }
  }

  const necesarias = templateVariableNumbers(plantilla.body_text)
  const declaradas = new Set([...Object.keys(campos), ...Object.keys(textos)])
  const faltan = necesarias.filter((n) => !declaradas.has(String(n)))
  if (faltan.length > 0) {
    throw new Error(
      `La plantilla "${plantilla.name}" usa ${faltan.map((n) => `{{${n}}}`).join(', ')} y nadie los llena. Cada variable necesita un campo del contacto o un texto fijo.`,
    )
  }
  const sobran = [...declaradas].filter((n) => !necesarias.includes(Number(n)))
  if (sobran.length > 0) {
    throw new Error(
      `La plantilla "${plantilla.name}" no tiene ${sobran.map((n) => `{{${n}}}`).join(', ')}. Meta rechaza el envío si sobran parámetros.`,
    )
  }

  // El cron manda los parámetros SÓLO en el bloque `body` (ver
  // sendTemplateMessage). Una plantilla con variable en el encabezado o en un
  // botón dinámico saldría con parámetros de menos y Meta la rechazaría
  // destinatario por destinatario: mejor no dejar armar la campaña.
  if (
    plantilla.header_type === 'text' &&
    templateVariableNumbers(plantilla.header_content).length > 0
  ) {
    throw new Error(
      `La plantilla "${plantilla.name}" tiene una variable en el encabezado y las campañas sólo llenan las del cuerpo. Usá otra plantilla.`,
    )
  }
  if (botonDinamico(plantilla.buttons)) {
    throw new Error(
      `La plantilla "${plantilla.name}" tiene un botón con enlace variable y las campañas no lo llenan. Usá otra plantilla.`,
    )
  }

  return { campos, textos }
}

function botonDinamico(buttons: unknown): boolean {
  if (!Array.isArray(buttons)) return false
  return buttons.some((b) => {
    const boton = (b ?? {}) as { url?: unknown; url_variable?: unknown }
    if (typeof boton.url_variable === 'string' && boton.url_variable.trim()) return true
    return typeof boton.url === 'string' && boton.url.includes('{{')
  })
}

function objetoDeTextos(valor: unknown, campo: string): Record<string, string> {
  if (valor == null) return {}
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${campo} tiene que ser un objeto tipo {"1": "..."}.`)
  }
  const salida: Record<string, string> = {}
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (!/^[1-9]\d*$/.test(k)) {
      throw new Error(`"${k}" no es el número de una variable: se numeran 1, 2, 3…`)
    }
    salida[k] = String(v ?? '')
  }
  return salida
}

/** Los parámetros de ESTE contacto, en el orden en que los espera Meta. */
function paramsDe(
  contacto: Contacto,
  campos: Record<string, string>,
  textos: Record<string, string>,
  posiciones: number[],
): string[] {
  return posiciones.map((n) => {
    const clave = String(n)
    if (textos[clave] !== undefined) return textos[clave]
    const campo = campos[clave]
    if (!campo) return ''
    return resolveContactField(campo, contacto) ?? ''
  })
}

/**
 * A quién alcanza el segmento y quién puede recibir un WhatsApp.
 *
 * El teléfono se filtra con la misma puerta que usa el cron al enviar. Si se
 * dejaran pasar, entrarían como destinatarios que fallan uno por uno — y el
 * número que la persona aprueba al lanzar diría un alcance que la campaña no
 * tiene.
 */
async function publicoDeSegmento(
  ctx: CapabilityContext,
  segmentoId: unknown,
): Promise<{
  segmento: string
  enviables: Contacto[]
  sin_whatsapp: number
  dados_de_baja: number
}> {
  const id = String(segmentoId ?? '').trim()
  if (!id) throw new Error('Falta el segmento: una campaña se manda a un segmento guardado.')

  const { data } = await ctx.db
    .from('contact_segments')
    .select('name, rules, match_mode')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!data) {
    throw new Error('Ese segmento no existe en esta cuenta. Mirá segmentos.listar.')
  }
  const seg = data as { name: string; rules: SegmentRule[]; match_mode: SegmentMatchMode }

  const { contacts } = await resolveSegment(
    ctx.db,
    ctx.workspaceId,
    seg.rules ?? [],
    seg.match_mode ?? 'all',
    { excludeOptedOut: true },
  )

  // La baja se filtra de nuevo acá, y no por desconfianza: `resolveSegment`
  // corta antes de aplicar `excludeOptedOut` cuando el segmento no tiene
  // criterios (el segmento "todos"), que es justamente el público más grande
  // que puede tener una campaña. Además así se puede DECIR cuántos quedaron
  // afuera, que es lo que explica un alcance más chico del esperado.
  const sinBaja = (contacts as unknown as Contacto[]).filter(
    (c) => c.opted_out !== true,
  )

  const enviables = sinBaja.filter((c) => {
    const tel = sanitizePhoneForMeta(String(c.phone ?? ''))
    return Boolean(tel) && isValidE164(tel)
  })

  return {
    segmento: seg.name,
    enviables,
    sin_whatsapp: sinBaja.length - enviables.length,
    dados_de_baja: contacts.length - sinBaja.length,
  }
}

// ---------------------------------------------------------------------------

async function crear(ctx: CapabilityContext, args: Record<string, unknown>) {
  const nombre = String(args.nombre ?? '').trim()
  if (!nombre) throw new Error('Falta el nombre de la campaña.')

  const plantilla = await cargarPlantilla(ctx, String(args.plantilla ?? '').trim())
  const { campos, textos } = leerVariables(plantilla, args)
  const posiciones = templateVariableNumbers(plantilla.body_text)
  const cuando = leerFecha(args.programada_para)

  const { segmento, enviables, sin_whatsapp, dados_de_baja } = await publicoDeSegmento(
    ctx,
    args.segmento_id,
  )
  if (enviables.length === 0) {
    throw new Error(
      `El segmento "${segmento}" no alcanza a nadie con WhatsApp. No se creó la campaña.`,
    )
  }

  // `broadcasts.user_id` es NOT NULL y apunta a auth.users: el cron busca las
  // credenciales de WhatsApp por ESE user_id. Va el dueño de la cuenta y no
  // quien pidió la campaña, porque un miembro del equipo no tiene fila en
  // whatsapp_config y el envío moriría con "WhatsApp not configured for owner".
  const userId = await resolveWorkspaceOwnerUserId(ctx.db, ctx.workspaceId)
  if (!userId) throw new Error('Esta cuenta no tiene dueño: no se puede crear la campaña.')

  const { data, error } = await ctx.db
    .from('broadcasts')
    .insert({
      user_id: userId,
      workspace_id: ctx.workspaceId,
      name: nombre,
      template_name: plantilla.name,
      template_language: plantilla.language ?? 'es',
      // Legible, para la pantalla de la campaña: qué va a mostrar cada {{n}}.
      template_variables: { ...textos, ...campos },
      // Lo que lee el cron. Sólo cuando TODAS las variables son campos del
      // contacto: con el mapping presente el cron ignora los params y
      // recalcula, así que un mapping a medias mandaría los valores corridos
      // de posición. Con textos fijos de por medio mandan los params, que ya
      // vienen resueltos acá.
      variable_mapping: Object.keys(textos).length === 0 && Object.keys(campos).length > 0
        ? campos
        : null,
      audience_filter: { type: 'segment', segmentId: String(args.segmento_id) },
      create_conversations: args.crear_conversaciones === true,
      scheduled_at: cuando,
      // Borrador: el cron sólo mira las 'scheduled'. Hasta que alguien la
      // lance, esta fila no le llega a nadie.
      status: 'draft',
      total_recipients: enviables.length,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    })
    .select('id, short_id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo crear la campaña.')
  const campana = data as { id: string; short_id: string | null }

  const filas = enviables.map((c) => ({
    broadcast_id: campana.id,
    contact_id: c.id,
    status: 'pending' as const,
    params: paramsDe(c, campos, textos, posiciones),
  }))

  for (let i = 0; i < filas.length; i += LOTE_INSERT) {
    const { error: errFilas } = await ctx.db
      .from('broadcast_recipients')
      .insert(filas.slice(i, i + LOTE_INSERT))
    if (errFilas) {
      // Media lista de destinatarios es peor que ninguna: la campaña quedaría
      // creada con un alcance que nadie pidió y se lanzaría igual. Se borra la
      // campaña (los destinatarios se van en cascada) y se avisa.
      await ctx.db
        .from('broadcasts')
        .delete()
        .eq('id', campana.id)
        .eq('workspace_id', ctx.workspaceId)
      throw new Error(`No se pudieron guardar los destinatarios: ${errFilas.message}`)
    }
  }

  return {
    id: campana.id,
    short_id: campana.short_id,
    nombre,
    plantilla: plantilla.name,
    segmento,
    destinatarios: enviables.length,
    sin_whatsapp,
    dados_de_baja,
    estado: 'borrador',
    programada_para: cuando,
    nota: 'Queda en borrador: no sale nada hasta que la lances con campanas.lanzar.',
  }
}

/** Fecha futura en ISO, o null. El pasado se trata como "cuanto antes". */
function leerFecha(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  const ts = Date.parse(String(raw))
  if (Number.isNaN(ts)) throw new Error(`No entiendo la fecha "${String(raw)}".`)
  return ts > Date.now() ? new Date(ts).toISOString() : null
}

async function pendientesDe(ctx: CapabilityContext, broadcastId: string): Promise<number> {
  const { count } = await ctx.db
    .from('broadcast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending')
  return count ?? 0
}

/**
 * Cuándo sale: lo que se pide ahora, si no la fecha con la que se armó.
 *
 * Sin el segundo caso, lanzar una campaña que se había programado para el
 * viernes la mandaba en el momento — que es exactamente lo contrario de lo que
 * pidió quien la armó.
 */
function cuandoSale(campana: Campana, args: Record<string, unknown>): string {
  const pedida = leerFecha(args.cuando)
  if (pedida) return pedida
  const programada = leerFecha(campana.scheduled_at)
  return programada ?? new Date().toISOString()
}

/** Estados desde los que todavía se puede lanzar, con el motivo del resto. */
function porQueNoSePuedeLanzar(estado: string): string | null {
  if (estado === 'draft' || estado === 'scheduled') return null
  if (estado === 'sending') return 'ya está saliendo'
  if (estado === 'sent') return 'ya salió'
  if (estado === 'failed') return 'falló; revisá el motivo antes de reintentar'
  return `está en "${estado}"`
}

async function lanzar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const campana = await buscarCampana(ctx, args.campana_id)

  const motivo = porQueNoSePuedeLanzar(campana.status)
  if (motivo) throw new Error(`«${campana.name}» no se puede lanzar: ${motivo}.`)

  const pendientes = await pendientesDe(ctx, campana.id)
  if (pendientes === 0) {
    throw new Error(`«${campana.name}» no tiene destinatarios pendientes: no hay nada que mandar.`)
  }

  // Una plantilla que Meta no aprobó falla destinatario por destinatario y deja
  // la campaña en 'failed' con la lista quemada. Se frena acá.
  const plantilla = await cargarPlantilla(ctx, campana.template_name)
  if (String(plantilla.status ?? '').toLowerCase() !== 'approved') {
    throw new Error(
      `La plantilla "${campana.template_name}" está en "${plantilla.status ?? 'sin estado'}": Meta no la va a entregar. Esperá la aprobación antes de lanzar.`,
    )
  }
  if (!(await hayWhatsApp(ctx, campana.user_id))) {
    throw new Error(
      'Esta cuenta no tiene WhatsApp conectado: la campaña fallaría entera. Conectá WhatsApp y volvé a intentar.',
    )
  }

  const cuando = cuandoSale(campana, args)
  const { data, error } = await ctx.db
    .from('broadcasts')
    .update({
      status: 'scheduled',
      scheduled_at: cuando,
      // De un intento anterior: si queda, la pantalla muestra un error viejo
      // sobre una campaña que se está por mandar de nuevo.
      error_message: null,
    })
    .eq('id', campana.id)
    .eq('workspace_id', ctx.workspaceId)
    .select('id, name, status, scheduled_at')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Esa campaña no existe en esta cuenta.')

  return {
    ...(data as Record<string, unknown>),
    destinatarios: pendientes,
    nota: 'Queda en cola. El envío empieza en el próximo minuto y sale de a lotes.',
  }
}

/** El cron busca las credenciales por user_id; sin esa fila no manda nada. */
async function hayWhatsApp(ctx: CapabilityContext, userId: string): Promise<boolean> {
  const { data } = await ctx.db
    .from('whatsapp_config')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

async function detalle(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.campana_id ?? '').trim()
  if (!id) throw new Error('Falta el id de la campaña.')

  const { data } = await ctx.db
    .from('broadcasts')
    .select(
      'id, short_id, name, template_name, template_language, status, scheduled_at, created_at, updated_at, error_message, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq(idColumn(id), id)
    .maybeSingle()
  if (!data) throw new Error('Esa campaña no existe en esta cuenta.')
  const c = data as Record<string, unknown> & { id: string }

  const [pendientes, bajas, fallidos] = await Promise.all([
    pendientesDe(ctx, c.id),
    ctx.db
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', c.id)
      .eq('status', 'skipped_opt_out'),
    ctx.db
      .from('broadcast_recipients')
      .select('error_message')
      .eq('broadcast_id', c.id)
      .eq('status', 'failed')
      .limit(200),
  ])

  // Los motivos agrupados y no la lista: cien destinatarios fallados casi
  // siempre son el mismo problema repetido, y esa es la línea que hay que leer.
  const porMotivo = new Map<string, number>()
  for (const f of (fallidos.data ?? []) as Array<{ error_message: string | null }>) {
    const m = f.error_message ?? 'sin motivo'
    porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1)
  }

  return {
    id: c.id,
    short_id: c.short_id,
    nombre: c.name,
    plantilla: c.template_name,
    idioma: c.template_language,
    estado: c.status,
    programada_para: c.scheduled_at,
    creada: c.created_at,
    actualizada: c.updated_at,
    error: c.error_message,
    destinatarios: c.total_recipients,
    sin_enviar: pendientes,
    enviados: c.sent_count,
    entregados: c.delivered_count,
    leidos: c.read_count,
    respondieron: c.replied_count,
    fallaron: c.failed_count,
    dados_de_baja: bajas.count ?? 0,
    motivos_de_falla: [...porMotivo.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOPE_MOTIVOS)
      .map(([motivo, cuantos]) => ({ motivo, cuantos })),
  }
}

// ---------------------------------------------------------------------------

const ESQUEMA_CREAR = {
  type: 'object' as const,
  properties: {
    nombre: { type: 'string', description: 'Cómo se va a llamar la campaña adentro de Riverz.' },
    plantilla: {
      type: 'string',
      description: 'Nombre exacto de una plantilla aprobada. Salen de plantillas.estado.',
    },
    segmento_id: {
      type: 'string',
      description:
        'A quién se le manda. Es un segmento guardado: si no existe el que hace falta, primero segmentos.calcular para ver el alcance y segmentos.crear para guardarlo.',
    },
    variables: {
      type: 'object',
      additionalProperties: { type: 'string', enum: [...BROADCAST_VARIABLE_FIELDS] },
      description: `Qué campo del contacto llena cada variable de la plantilla, por número: {"1":"first_name"}. Campos: ${BROADCAST_VARIABLE_FIELDS.join(', ')}.`,
    },
    textos_fijos: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Variables con un texto igual para todos: {"2":"20% OFF"}.',
    },
    programada_para: {
      type: 'string',
      description: 'Fecha y hora ISO. Opcional: se puede decidir al lanzar.',
    },
    crear_conversaciones: {
      type: 'boolean',
      description: 'Abre el hilo en la bandeja al salir, para poder seguir la charla. Por defecto no.',
    },
  },
  required: ['nombre', 'plantilla', 'segmento_id'],
}

/** La campaña como quedó guardada, con los destinatarios que de verdad tiene. */
export async function artefactoGuardadoDeCampana(
  ctx: CapabilityContext,
  broadcastId: string,
): Promise<Artefacto | null> {
  const { data } = await ctx.db
    .from('broadcasts')
    .select('id, name, template_name, scheduled_at, status')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', broadcastId)
    .maybeSingle()
  const fila = data as {
    id: string
    name: string
    template_name: string | null
    scheduled_at: string | null
    status: string | null
  } | null
  if (!fila) return null
  const { count } = await ctx.db
    .from('broadcast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', fila.id)
  return {
    kind: 'campana',
    nombre: fila.name,
    plantilla: fila.template_name ?? '',
    destinatarios: count ?? 0,
    cuando: fila.scheduled_at
      ? `programada para el ${new Date(fila.scheduled_at).toLocaleString('es', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}`
      : `${fila.status ?? 'borrador'}: sale cuando la lances`,
    base: { id: fila.id, nombre: fila.name },
  }
}

export const BROADCAST_CAPABILITIES: Capability[] = [
  {
    key: 'campanas.crear',
    description:
      'Arma una campaña de WhatsApp y la deja EN BORRADOR: guarda la plantilla, el público y el texto que le va a tocar a cada persona, y no manda nada. Valida que la plantilla exista y que todas sus variables tengan quién las llene. El público es un segmento guardado y quedan afuera los dados de baja y los que no tienen WhatsApp. Para que salga hay que lanzarla después.',
    descriptionEn:
      'Builds a WhatsApp campaign and leaves it as a DRAFT: it stores the template, the audience and the text each person will get, and sends nothing. It checks that the template exists and that every variable has someone filling it. The audience is a saved segment; opted-out contacts and those without WhatsApp are left out. It has to be launched afterwards to go out.',
    risk: 'reversible',
    // Borrador: guarda a quién y con qué, y no manda nada. Para que salga hay
    // que lanzarla, que es otra capacidad y sí pide un click.
    inerte: true,
    schema: ESQUEMA_CREAR,
    async preview(ctx, args) {
      const nombre = String(args.nombre ?? '(sin nombre)')
      try {
        const plantilla = await cargarPlantilla(ctx, String(args.plantilla ?? '').trim())
        leerVariables(plantilla, args)
        const { segmento, enviables, sin_whatsapp, dados_de_baja } =
          await publicoDeSegmento(ctx, args.segmento_id)
        const afuera = [
          dados_de_baja > 0 ? `${dados_de_baja} dados de baja` : '',
          sin_whatsapp > 0 ? `${sin_whatsapp} sin WhatsApp` : '',
        ].filter(Boolean)
        const sin = afuera.length > 0 ? ` (quedan afuera ${afuera.join(' y ')})` : ''
        return `Armaría la campaña «${nombre}» con la plantilla "${plantilla.name}" para ${enviables.length} ${
          enviables.length === 1 ? 'persona' : 'personas'
        } del segmento "${segmento}"${sin}. Queda en borrador: no manda nada.`
      } catch (e) {
        throw new Error(`No se puede armar «${nombre}»: ${(e as Error).message}`)
      }
    },
    // El tipo `campana` existía en la unión, viajaba y se podía dibujar, y no
    // lo producía NADIE: armar una campaña dejaba el banco vacío.
    //
    // Desde el resultado porque los argumentos traen el id del segmento y no
    // su nombre, ni a cuánta gente alcanza.
    artifact(_ctx, args, result) {
      const r = result as
        | { id?: string; nombre?: string; plantilla?: string; destinatarios?: number; programada_para?: string | null }
        | undefined
      if (!r?.nombre) return null
      return {
        kind: 'campana',
        nombre: r.nombre,
        plantilla: r.plantilla ?? String(args.plantilla ?? ''),
        destinatarios: r.destinatarios ?? 0,
        cuando: r.programada_para
          ? `programada para el ${new Date(r.programada_para).toLocaleString('es', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}`
          : 'sin fecha: sale cuando la lances',
        ...(r.id ? { base: { id: r.id, nombre: r.nombre } } : {}),
      }
    },
    run: crear,
  },

  {
    key: 'campanas.lanzar',
    description:
      'Pone a enviar una campaña que estaba en borrador. Le llega a TODOS sus destinatarios: es un envío real de WhatsApp, no se puede deshacer. Lo manda el sistema en el próximo minuto, de a lotes. Se puede dar una fecha para que salga más adelante.',
    descriptionEn:
      'Puts a draft campaign in the sending queue. It reaches ALL of its recipients: a real WhatsApp send that cannot be undone. The system dispatches it within the next minute, in batches. A date can be given to send it later.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        campana_id: { type: 'string', description: 'Id de la campaña, de campanas.crear o campanas.estado.' },
        cuando: {
          type: 'string',
          description: 'Fecha y hora ISO para que salga más adelante. Sin esto sale ya.',
        },
      },
      required: ['campana_id'],
    },
    async preview(ctx, args) {
      const campana = await buscarCampana(ctx, args.campana_id)
      const motivo = porQueNoSePuedeLanzar(campana.status)
      if (motivo) throw new Error(`«${campana.name}» no se puede lanzar: ${motivo}.`)

      const pendientes = await pendientesDe(ctx, campana.id)
      const cuando = cuandoSale(campana, args)
      const momento =
        Date.parse(cuando) > Date.now() + 60_000
          ? `el ${new Date(cuando).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}`
          : 'ahora mismo'

      // El estado de la plantilla se mira acá y no sólo al ejecutar: aprobar un
      // envío que Meta va a rechazar entero no es aprobar nada.
      const plantilla = await cargarPlantilla(ctx, campana.template_name).catch(() => null)
      const aviso =
        plantilla && String(plantilla.status ?? '').toLowerCase() !== 'approved'
          ? ` OJO: la plantilla está en "${plantilla.status}" y Meta no la entrega.`
          : ''

      return `Mandaría la campaña «${campana.name}» con la plantilla "${campana.template_name}" a ${pendientes} ${
        pendientes === 1 ? 'persona' : 'personas'
      }, ${momento}. Es un envío real de WhatsApp y no se puede deshacer.${aviso}`
    },
    run: lanzar,
  },

  {
    key: 'campanas.detalle',
    description:
      'Una campaña con sus números: a cuántos apuntaba, cuántos la recibieron, la leyeron y contestaron, cuántos quedan sin enviar, cuántos estaban dados de baja y los motivos de las fallas agrupados. Es lo que explica por qué una campaña rindió distinto de lo esperado.',
    descriptionEn:
      'One campaign with its numbers: how many it targeted, how many received, read and replied, how many are still unsent, how many had opted out, and the failure reasons grouped. It explains why a campaign performed differently than expected.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        campana_id: { type: 'string', description: 'Id completo o el corto de la URL.' },
      },
      required: ['campana_id'],
    },
    run: detalle,
  },
]

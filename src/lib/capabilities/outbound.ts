/**
 * Lo que sale hacia afuera: plantillas de WhatsApp y campañas.
 *
 * Son las dos cosas que explican la mayoría de los "no salió nada": una
 * plantilla rechazada no se puede usar en ninguna campaña ni automatización, y
 * una campaña que quedó trabada en "enviando" parece haber salido y no salió.
 *
 * Escribir una plantilla está partido en dos a propósito: el borrador se guarda
 * y no sale a ningún lado, y mandarlo a aprobación es otra decisión. Meta no
 * tiene "cancelar": una vez enviada, el nombre queda tomado en ese WABA aunque
 * la rechacen, y equivocarse quema el nombre para siempre.
 */
import { translate } from '@/lib/i18n/translate'
import { crearPlantilla, type ResultadoCrearPlantilla } from '@/lib/templates/create'
import {
  normalizeTemplateName,
  type TemplateButtonInput,
} from '@/lib/whatsapp/template-components'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import type { Artefacto } from '@/lib/operator/artifacts'
import { isStalledBroadcast, since, windowDays } from './predicates'
import type { Capability, CapabilityContext } from './types'

async function plantillas(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('message_templates')
    .select('name, category, language, status, rejected_reason, quality_score, updated_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('updated_at', { ascending: false })
    .limit(100)

  const filas = (data ?? []) as Array<{ status: string | null; name: string }>
  const estado = (s: string | null) => (s ?? '').toLowerCase()

  return {
    total: filas.length,
    // Se destacan porque son las accionables: una rechazada hay que corregirla
    // y una que lleva días en pendiente suele ser el WABA bloqueado por
    // facturación, no la plantilla.
    rechazadas: filas.filter((t) => estado(t.status) === 'rejected').length,
    pendientes: filas.filter((t) => estado(t.status) === 'pending').length,
    plantillas: filas,
  }
}

async function campanas(ctx: CapabilityContext, args: Record<string, unknown>) {
  const d = windowDays(args.dias, 30)
  const { data } = await ctx.db
    .from('broadcasts')
    .select(
      'id, name, template_name, status, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count, scheduled_at, error_message, created_at, updated_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .gte('created_at', since(d))
    .order('created_at', { ascending: false })
    .limit(50)

  const filas = (data ?? []) as Array<{ status: string; updated_at: string }>
  return {
    periodo_dias: d,
    trabadas: filas.filter(isStalledBroadcast).length,
    campanas: filas,
  }
}

// ---------------------------------------------------------------------------
// Plantillas: escribirlas y mandarlas a aprobación.
// ---------------------------------------------------------------------------

/** Cómo se llama la categoría en el catálogo local, que usa otro alfabeto. */
const CATEGORIA_LOCAL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
}

/**
 * Los botones llegan en castellano y salen en el dialecto de Meta.
 *
 * Se aceptan las dos formas: quien escribe desde el chat dice "respuesta_rapida"
 * y quien copia una plantilla existente trae "QUICK_REPLY". Rechazar la segunda
 * sería fallar por un sinónimo.
 */
const TIPOS_BOTON: Record<string, TemplateButtonInput['type']> = {
  respuesta_rapida: 'QUICK_REPLY',
  quick_reply: 'QUICK_REPLY',
  url: 'URL',
  enlace: 'URL',
  telefono: 'PHONE_NUMBER',
  phone_number: 'PHONE_NUMBER',
}

function leerBotones(valor: unknown): TemplateButtonInput[] {
  if (!Array.isArray(valor)) return []
  return valor.map((b) => {
    const boton = (b ?? {}) as Record<string, unknown>
    const crudo = String(boton.tipo ?? boton.type ?? 'respuesta_rapida').toLowerCase()
    const tipo = TIPOS_BOTON[crudo]
    if (!tipo) {
      throw new Error(
        `No entiendo el botón de tipo "${crudo}". Los que valen: respuesta_rapida, url, telefono.`,
      )
    }
    return {
      type: tipo,
      text: String(boton.texto ?? boton.text ?? '').trim(),
      url: typeof boton.url === 'string' ? boton.url : undefined,
      phone_number:
        typeof boton.telefono === 'string'
          ? boton.telefono
          : typeof boton.phone_number === 'string'
            ? boton.phone_number
            : undefined,
      // Un botón dinámico (carrito, seguimiento) se conserva tal cual: lo llena
      // el motor al enviar y Meta nunca ve el link real.
      url_variable: (boton.url_variable ?? undefined) as TemplateButtonInput['url_variable'],
    }
  })
}

interface FilaPlantilla {
  id: string
  user_id: string | null
  name: string
  language: string
  category: string | null
  status: string | null
  header_type: string | null
  header_content: string | null
  body_text: string
  footer_text: string | null
  buttons: Array<Record<string, unknown>> | null
  variable_samples: string[] | null
  variable_fields: Record<string, string> | null
  rejected_reason: string | null
  meta_template_id: string | null
  quality_score: string | null
  updated_at: string
}

const COLUMNAS_PLANTILLA =
  'id, user_id, name, language, category, status, header_type, header_content, body_text, footer_text, buttons, variable_samples, variable_fields, rejected_reason, meta_template_id, quality_score, updated_at'

/**
 * La plantilla se busca por su nombre YA normalizado.
 *
 * Quien pide escribe "Carrito abandonado" y en Meta se llama
 * "carrito_abandonado". Normalizar la búsqueda con la misma función que
 * normaliza al crear es lo que hace que las dos puntas coincidan; sin eso,
 * pedir la plantilla por el nombre con el que se la creó no la encontraba.
 */
async function buscarPorNombre(
  ctx: CapabilityContext,
  nombre: unknown,
  idioma?: unknown,
): Promise<FilaPlantilla | null> {
  const name = normalizeTemplateName(String(nombre ?? ''))
  if (!name) throw new Error('Falta el nombre de la plantilla.')
  let q = ctx.db
    .from('message_templates')
    .select(COLUMNAS_PLANTILLA)
    .eq('workspace_id', ctx.workspaceId)
    .eq('name', name)
  if (typeof idioma === 'string' && idioma.trim()) q = q.eq('language', idioma.trim())
  const { data } = await q.order('updated_at', { ascending: false }).limit(1)
  return ((data ?? [])[0] as unknown as FilaPlantilla | undefined) ?? null
}

/** El dueño de la fila local, con la misma regla que el resto de las capacidades. */
async function usuarioDe(ctx: CapabilityContext): Promise<string | null> {
  const id = ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? ctx.actor.id : null
  return id ?? (await resolveWorkspaceOwnerUserId(ctx.db, ctx.workspaceId))
}

/**
 * El fallo se devuelve legible o no se devuelve.
 *
 * `crearPlantilla` contesta con una clave de i18n porque del otro lado puede
 * haber una route con el idioma del pedido. Acá del otro lado hay un modelo:
 * se traduce al idioma del comercio y se tira, que es como el resto de las
 * capacidades avisa que algo no se pudo.
 */
function exigirOk(ctx: CapabilityContext, r: ResultadoCrearPlantilla) {
  if (r.ok) return r
  const texto =
    r.mensaje ?? translate(ctx.locale ?? 'es', `errWhatsapp.${r.claveI18n}`, r.params)
  throw new Error(texto)
}

function artefactoPlantilla(entrada: {
  nombre: string
  categoria: string
  idioma: string
  cuerpo: string
  encabezado?: string | null
  pie?: string | null
  botones?: Array<{ texto: string; tipo: string }>
  estado: 'borrador' | 'en_revision'
}): Artefacto | null {
  if (!entrada.nombre || !entrada.cuerpo.trim()) return null
  return {
    kind: 'plantilla',
    nombre: entrada.nombre,
    categoria: CATEGORIA_LOCAL[entrada.categoria.toUpperCase()] ?? entrada.categoria,
    idioma: entrada.idioma,
    cuerpo: entrada.cuerpo,
    encabezado: entrada.encabezado ?? undefined,
    pie: entrada.pie ?? undefined,
    botones: entrada.botones?.length ? entrada.botones : undefined,
    estado: entrada.estado,
  }
}

/** Los botones guardados, con el nombre en castellano que se dibuja. */
function botonesDe(fila: FilaPlantilla): Array<{ texto: string; tipo: string }> {
  return (fila.buttons ?? []).map((b) => {
    const tipo = String(b.type ?? '')
    return {
      texto: String(b.text ?? ''),
      tipo: tipo === 'URL' ? 'enlace' : tipo === 'PHONE_NUMBER' ? 'llamar' : 'respuesta rápida',
    }
  })
}

/** Cómo quedó guardada una plantilla, dibujable. Leída de la base, no de los argumentos. */
export async function artefactoGuardadoDePlantilla(
  ctx: CapabilityContext,
  templateId: string,
): Promise<Artefacto | null> {
  const { data } = await ctx.db
    .from('message_templates')
    .select(COLUMNAS_PLANTILLA)
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', templateId)
    .maybeSingle()
  const fila = data as unknown as FilaPlantilla | null
  if (!fila) return null
  const estado = (fila.status ?? '').toLowerCase() === 'draft' ? 'borrador' : 'en_revision'
  return artefactoPlantilla({
    nombre: fila.name,
    categoria: String(fila.category ?? 'MARKETING'),
    idioma: fila.language,
    cuerpo: fila.body_text ?? '',
    encabezado: fila.header_content,
    pie: fila.footer_text,
    botones: botonesDe(fila),
    estado,
  })
}

async function crearBorrador(ctx: CapabilityContext, args: Record<string, unknown>) {
  const idioma = typeof args.idioma === 'string' && args.idioma.trim() ? args.idioma.trim() : 'es'
  const previa = await buscarPorNombre(ctx, args.nombre, idioma)
  // Pisar un borrador es corregirlo; pisar una plantilla que ya viajó a Meta
  // sería dejarla como "Draft" en el catálogo mientras en Meta sigue viva, y
  // el nombre además ya está tomado allá: no hay forma de que ese borrador
  // llegue a nada.
  if (previa && (previa.status ?? '').toLowerCase() !== 'draft') {
    throw new Error(
      `Ya existe la plantilla "${previa.name}" (${previa.status}). En Meta el nombre no se puede reusar: elegí otro.`,
    )
  }

  const r = exigirOk(
    ctx,
    await crearPlantilla(ctx.db, {
      workspaceId: ctx.workspaceId,
      userId: previa?.user_id ?? (await usuarioDe(ctx)),
      nombre: String(args.nombre ?? ''),
      idioma,
      categoria: String(args.categoria ?? 'MARKETING').toUpperCase(),
      headerType: typeof args.encabezado === 'string' && args.encabezado.trim() ? 'text' : 'none',
      headerText: typeof args.encabezado === 'string' ? args.encabezado : undefined,
      bodyText: String(args.cuerpo ?? ''),
      footerText: typeof args.pie === 'string' ? args.pie : undefined,
      buttons: leerBotones(args.botones),
      bodySamples: Array.isArray(args.ejemplos) ? args.ejemplos.map((x) => String(x)) : undefined,
      // Sale a Meta en el mismo movimiento. Eran dos aprobaciones para una sola
      // cosa, y entre las dos quedaba una plantilla a medias en la lista del
      // comercio: no sirve para enviar, no está en revisión, y hay que
      // acordarse de volver.
      enviarAMeta: true,
      plantillaExistenteId: previa?.id ?? null,
    }),
  )

  return {
    id: r.id,
    nombre: r.name,
    idioma: r.language,
    categoria: r.category,
    estado: 'en_revision',
    nota: 'Quedó en revisión de Meta. Tarda horas; hasta que la aprueben no se le puede enviar a nadie.',
  }
}

async function enviarAMeta(ctx: CapabilityContext, args: Record<string, unknown>) {
  const fila = await buscarPorNombre(ctx, args.nombre, args.idioma)
  if (!fila) throw new Error('No hay ninguna plantilla con ese nombre en esta cuenta.')
  const estado = (fila.status ?? '').toLowerCase()
  if (estado !== 'draft' && estado !== 'rejected') {
    throw new Error(
      `"${fila.name}" ya está en Meta (${fila.status}). No hace falta mandarla de nuevo.`,
    )
  }

  const r = exigirOk(
    ctx,
    await crearPlantilla(ctx.db, {
      workspaceId: ctx.workspaceId,
      userId: fila.user_id ?? (await usuarioDe(ctx)),
      nombre: fila.name,
      idioma: fila.language,
      categoria: (fila.category ?? 'Marketing').toUpperCase(),
      // Un encabezado multimedia no se puede reenviar solo: Meta pide el
      // archivo de ejemplo subido y el catálogo no guarda ese handle. En ese
      // caso la validación de componentes corta y lo dice.
      headerType: (fila.header_type as 'text' | undefined) ?? 'none',
      headerText: fila.header_content ?? undefined,
      bodyText: fila.body_text,
      footerText: fila.footer_text ?? undefined,
      buttons: leerBotones(fila.buttons),
      bodySamples: fila.variable_samples ?? undefined,
      variableFields: fila.variable_fields,
      plantillaExistenteId: fila.id,
    }),
  )

  return {
    nombre: r.name,
    idioma: r.language,
    categoria: r.category,
    cuerpo: fila.body_text,
    encabezado: fila.header_content,
    pie: fila.footer_text,
    botones: botonesDe(fila),
    estado: 'en_revision',
    meta_template_id: r.metaTemplateId,
    nota: 'Meta la revisa sola y puede tardar horas. Hasta que quede aprobada no se puede enviar.',
  }
}

async function detallePlantilla(ctx: CapabilityContext, args: Record<string, unknown>) {
  const fila = await buscarPorNombre(ctx, args.nombre, args.idioma)
  if (!fila) return { encontrada: false, nombre: String(args.nombre ?? '') }
  return {
    encontrada: true,
    nombre: fila.name,
    idioma: fila.language,
    categoria: fila.category,
    estado: fila.status,
    motivo_rechazo: fila.rejected_reason,
    calidad: fila.quality_score,
    encabezado: fila.header_content,
    cuerpo: fila.body_text,
    pie: fila.footer_text,
    botones: botonesDe(fila),
    // Qué representa cada {{n}}: sin esto, quien arme una automatización con
    // esta plantilla no sabe con qué llenar las variables.
    variables: fila.variable_fields,
    ejemplos: fila.variable_samples,
    meta_template_id: fila.meta_template_id,
    actualizada: fila.updated_at,
  }
}

export const OUTBOUND_CAPABILITIES: Capability[] = [
  {
    key: 'plantillas.estado',
    description:
      'Las plantillas de WhatsApp con su estado en Meta y el motivo de rechazo cuando lo hay. Una rechazada no se puede usar en ninguna campaña ni automatización, así que suele ser la causa de que algo no salga.',
    descriptionEn:
      'The WhatsApp templates with their status at Meta and the rejection reason when there is one. A rejected template cannot be used in any campaign or automation, so it is often the reason something does not go out.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: plantillas,
  },

  {
    key: 'campanas.estado',
    description:
      'Las campañas y cómo terminaron: a cuántos salió, cuántos la recibieron, cuántos contestaron y cuántas fallaron. Incluye las que quedaron trabadas en "enviando".',
    descriptionEn:
      'The campaigns and how they ended: how many were targeted, how many received it, how many replied and how many failed. Includes the ones stuck in "sending".',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 30, máximo 90.' },
      },
    },
    run: campanas,
  },

  {
    key: 'plantillas.detalle',
    description:
      'Una plantilla concreta por su nombre: el cuerpo tal cual lo lee el cliente, el encabezado, el pie, los botones, qué representa cada variable y en qué estado está. Es lo que hay que mirar antes de usarla en una campaña o en una automatización.',
    descriptionEn:
      'One template by name: the body as the customer reads it, the header, the footer, the buttons, what each variable stands for and its status. What to check before using it in a campaign or an automation.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        nombre: {
          type: 'string',
          description: 'Nombre de la plantilla. Admite espacios y mayúsculas.',
        },
        idioma: { type: 'string', description: 'Sólo si hay varias versiones (es, en, es_MX).' },
      },
      required: ['nombre'],
    },
    run: detallePlantilla,
  },

  {
    key: 'plantillas.crear',
    description:
      'Escribe una plantilla de WhatsApp y la manda a aprobación de Meta. Es un camino de ida: no se cancela y el nombre queda tomado en ese WhatsApp aunque la rechacen. La revisión tarda horas; hasta que quede aprobada no se le puede enviar a nadie. La persona ve el mensaje entero antes de decidir.',
    descriptionEn:
      'Writes a WhatsApp template and submits it to Meta for approval. One way: it cannot be cancelled and the name stays taken on that WhatsApp account even if rejected. The person sees the whole message before deciding.',
    risk: 'irreversible',
    // Queda guardada y sin mandar a Meta: no la ve nadie fuera de la cuenta,
    // y no se puede usar en un envío hasta que Meta la apruebe.
    schema: {
      type: 'object',
      properties: {
        nombre: {
          type: 'string',
          description: 'Se normaliza a minúsculas con guiones bajos, como exige Meta.',
        },
        cuerpo: {
          type: 'string',
          description: 'El mensaje. Hasta 1024 caracteres. Admite {{1}}, {{2}}…',
        },
        categoria: {
          type: 'string',
          enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'],
          description:
            'MARKETING para promociones (Meta la entrega con menos prioridad); UTILITY para lo transaccional (pedido, envío, pago).',
        },
        idioma: { type: 'string', description: 'Código de Meta: es, en, es_MX. Por defecto es.' },
        encabezado: { type: 'string', description: 'Título de texto, hasta 60 caracteres.' },
        pie: { type: 'string', description: 'Línea al pie, hasta 60 caracteres.' },
        ejemplos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Un valor de muestra por variable, en orden. Meta los exige para aprobar.',
        },
        botones: {
          type: 'array',
          items: { type: 'object' },
          description:
            'Hasta 10. Cada uno: {texto, tipo}. tipo respuesta_rapida | url (además url) | telefono (además telefono en formato +54…).',
        },
      },
      required: ['nombre', 'cuerpo'],
    },
    // El texto se ve ANTES de que exista: el artefacto se dibuja desde los
    // argumentos, así que el banco muestra el mensaje en su teléfono mientras
    // esto todavía es una propuesta. Aprobar es aprobar lo que se leyó.
    async preview(_ctx, args) {
      const nombre = normalizeTemplateName(String(args.nombre ?? ''))
      return `Crearía «${nombre}» y la mandaría a aprobación de Meta. El nombre queda tomado aunque la rechacen.`
    },
    artifact: (_ctx, args) =>
      artefactoPlantilla({
        nombre: normalizeTemplateName(String(args.nombre ?? '')),
        categoria: String(args.categoria ?? 'MARKETING'),
        idioma: typeof args.idioma === 'string' && args.idioma.trim() ? args.idioma.trim() : 'es',
        cuerpo: String(args.cuerpo ?? ''),
        encabezado: typeof args.encabezado === 'string' ? args.encabezado : null,
        pie: typeof args.pie === 'string' ? args.pie : null,
        botones: (Array.isArray(args.botones) ? args.botones : []).map((b) => {
          const boton = (b ?? {}) as Record<string, unknown>
          return {
            texto: String(boton.texto ?? boton.text ?? ''),
            tipo: String(boton.tipo ?? boton.type ?? 'respuesta_rapida'),
          }
        }),
        estado: 'en_revision',
      }),
    run: crearBorrador,
  },

  {
    key: 'plantillas.enviar_a_meta',
    description:
      'Manda un borrador a aprobación de Meta. Es un camino de ida: no se cancela, y el nombre queda tomado en ese WhatsApp aunque la rechacen. La revisión tarda horas y hasta que quede aprobada la plantilla no se puede enviar a nadie.',
    descriptionEn:
      'Submits a draft to Meta for approval. One way: it cannot be cancelled and the name stays taken on that WhatsApp account even if rejected.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del borrador ya guardado.' },
        idioma: { type: 'string', description: 'Sólo si hay varias versiones.' },
      },
      required: ['nombre'],
    },
    async preview(ctx, args) {
      const fila = await buscarPorNombre(ctx, args.nombre, args.idioma)
      if (!fila) throw new Error('No hay ninguna plantilla con ese nombre en esta cuenta.')
      const cuerpo = fila.body_text.trim()
      return `Mandaría «${fila.name}» (${fila.category ?? 'Marketing'}, ${fila.language}) a aprobación de Meta: "${
        cuerpo.length > 200 ? `${cuerpo.slice(0, 200)}…` : cuerpo
      }". No se cancela y el nombre queda tomado aunque la rechacen.`
    },
    // Se dibuja desde el resultado y no desde los argumentos porque los
    // argumentos son sólo un nombre: el cuerpo, los botones y la categoría
    // están en la base, y `artifact` es síncrono y no la puede leer.
    artifact: (_ctx, _args, result) => {
      const r = result as
        | {
            nombre?: string
            categoria?: string
            idioma?: string
            cuerpo?: string
            encabezado?: string | null
            pie?: string | null
            botones?: Array<{ texto: string; tipo: string }>
          }
        | undefined
      if (!r?.nombre) return null
      return artefactoPlantilla({
        nombre: r.nombre,
        categoria: r.categoria ?? 'MARKETING',
        idioma: r.idioma ?? 'es',
        cuerpo: r.cuerpo ?? '',
        encabezado: r.encabezado,
        pie: r.pie,
        botones: r.botones,
        estado: 'en_revision',
      })
    },
    run: enviarAMeta,
  },
]

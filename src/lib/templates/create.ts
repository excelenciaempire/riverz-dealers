/**
 * Escribir una plantilla de WhatsApp: validarla, mandarla a Meta y espejarla.
 *
 * La secuencia entera vivía dentro del route handler de
 * `/api/whatsapp/templates/create`, y eso la dejaba fuera del alcance de todo
 * lo que no fuera el formulario: para crear una plantilla desde el Operator o
 * desde el MCP había que hacerse un POST a uno mismo con la cookie de sesión
 * puesta. Acá adentro es una función y la route quedó como lo que siempre fue,
 * un envoltorio de HTTP.
 *
 * Los errores NO se traducen acá. Se devuelven como clave de `errWhatsapp` y
 * quien llama decide en qué idioma se leen: la route con el locale del pedido,
 * una capacidad en castellano. Cuando el texto no lo pone Riverz —la validación
 * de componentes, el motivo real de Meta— viaja ya escrito en `mensaje`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  createMessageTemplate,
  MetaApiError,
  type MetaTemplateCategory,
} from '@/lib/whatsapp/meta-api'
import {
  buildTemplateComponents,
  normalizeTemplateName,
  type TemplateButtonInput,
  type TemplateFormInput,
  type TemplateHeaderType,
} from '@/lib/whatsapp/template-components'

const CATEGORIAS: readonly string[] = ['MARKETING', 'UTILITY', 'AUTHENTICATION']

/** La tabla local guarda la categoría capitalizada; Meta la quiere en mayúsculas. */
const DB_CATEGORY: Record<MetaTemplateCategory, 'Marketing' | 'Utility' | 'Authentication'> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
}

export interface EntradaCrearPlantilla {
  /**
   * Puede venir null a propósito: la route lo resuelve desde el usuario y ese
   * paso puede fallar. Se contesta acá adentro para que el orden de los errores
   * sea el mismo que tenía la route (nombre, categoría, componentes, cuenta).
   */
  workspaceId: string | null
  /** Dueño de la fila local. `message_templates.user_id` admite null. */
  userId: string | null
  /** Texto libre: se normaliza al snake_case que exige Meta. */
  nombre: string
  idioma?: string
  categoria?: string
  headerType?: TemplateHeaderType
  headerText?: string
  headerHandle?: string
  bodyText: string
  footerText?: string
  buttons?: TemplateButtonInput[]
  bodySamples?: string[]
  variableFields?: Record<string, string> | null
  /**
   * `false` guarda el borrador y no sale a Meta.
   *
   * Un borrador no necesita WhatsApp conectado: se puede escribir la plantilla
   * antes de tener número, y recién al mandarla a aprobación hace falta el WABA.
   */
  enviarAMeta?: boolean
  /**
   * Fila local a pisar, cuando quien llama ya sabe cuál es.
   *
   * Sin esto se empareja por (user_id, name, language), que es la llave que usa
   * el sync. Alcanza para el formulario —siempre es la misma persona— pero no
   * para un borrador que escribió alguien y manda otro: ahí el user_id difiere
   * y se insertaría una fila nueva en vez de actualizar la que ya está.
   */
  plantillaExistenteId?: string | null
}

export interface PlantillaCreada {
  ok: true
  /** Id de la fila local. Null si el espejo no devolvió la fila. */
  id: string | null
  /** El nombre YA normalizado, que es el que Meta conoce. */
  name: string
  language: string
  category: MetaTemplateCategory
  estado: 'Draft' | 'Pending'
  metaTemplateId: string | null
  /** El estado crudo de Meta ("PENDING"). Null cuando quedó en borrador. */
  estadoMeta: string | null
}

export interface PlantillaFallida {
  ok: false
  status: 400 | 500 | 502
  /** Clave dentro de `errWhatsapp`, para que la traduzca quien la muestra. */
  claveI18n?: string
  params?: Record<string, string>
  /** Texto ya escrito, cuando el motivo no lo redacta Riverz. */
  mensaje?: string
  /** La plantilla SÍ llegó a Meta y falló el espejo local: no se reintenta. */
  metaTemplateId?: string
}

export type ResultadoCrearPlantilla = PlantillaCreada | PlantillaFallida

/**
 * De dónde salen el WABA y el token.
 *
 * Los dos caminos existen porque hay dos historias: `whatsapp_config` es la
 * conexión vieja, por usuario, y un número conectado por Embedded Signup
 * escribe SÓLO `channel_connections`, por workspace. Si nos quedáramos con el
 * primero, un número conectado desde la bandeja daría "WhatsApp no conectado"
 * al crear una plantilla aunque esté funcionando.
 *
 * `channel_connections` se lee con la llave de servicio: los secretos no son
 * legibles con el cliente del usuario.
 */
export async function resolverWabaYToken(
  db: SupabaseClient,
  workspaceId: string,
  userId: string | null,
): Promise<{ wabaId: string | null; accessToken: string | null }> {
  if (userId) {
    const { data: config } = await db
      .from('whatsapp_config')
      .select('waba_id, access_token')
      .eq('user_id', userId)
      .maybeSingle()
    const fila = config as { waba_id?: string; access_token?: string } | null
    if (fila?.waba_id && fila.access_token) {
      return { wabaId: String(fila.waba_id), accessToken: decrypt(fila.access_token) }
    }
  }

  const { data: conn } = await supabaseAdmin()
    .from('channel_connections')
    .select('config, secrets')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp')
    .neq('status', 'disconnected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const cfg = (conn?.config ?? {}) as Record<string, unknown>
  const secrets = (conn?.secrets ?? {}) as Record<string, unknown>
  if (cfg.waba_id && secrets.access_token) {
    return {
      wabaId: String(cfg.waba_id),
      accessToken: decrypt(String(secrets.access_token)),
    }
  }
  return { wabaId: null, accessToken: null }
}

export async function crearPlantilla(
  db: SupabaseClient,
  entrada: EntradaCrearPlantilla,
): Promise<ResultadoCrearPlantilla> {
  const enviarAMeta = entrada.enviarAMeta !== false

  const name = normalizeTemplateName(entrada.nombre ?? '')
  if (!name) return { ok: false, status: 400, claveI18n: 'templateNameRequired' }

  const language = (entrada.idioma ?? 'es').trim()
  const category = (entrada.categoria ?? 'MARKETING') as MetaTemplateCategory
  if (!CATEGORIAS.includes(category)) {
    return { ok: false, status: 400, claveI18n: 'invalidCategory' }
  }

  const form: TemplateFormInput = {
    category,
    headerType: entrada.headerType ?? 'none',
    headerText: entrada.headerText,
    headerHandle: entrada.headerHandle,
    bodyText: entrada.bodyText ?? '',
    footerText: entrada.footerText,
    buttons: entrada.buttons,
    bodySamples: entrada.bodySamples,
  }

  const { components, error: buildError } = buildTemplateComponents(form)
  if (buildError) return { ok: false, status: 400, mensaje: buildError }

  // `message_templates.workspace_id` es NOT NULL: sin cuenta el espejo no entra
  // y la plantilla no aparecería nunca en el catálogo, que es de donde la leen
  // el selector, las campañas y las automatizaciones.
  const workspaceId = entrada.workspaceId
  if (!workspaceId) {
    return { ok: false, status: 400, claveI18n: 'workspaceResolveFailed' }
  }

  let metaResult: { id: string; status: string } | null = null
  let wabaDeLaFila: string | null = null
  if (enviarAMeta) {
    const { wabaId, accessToken } = await resolverWabaYToken(db, workspaceId, entrada.userId)
    wabaDeLaFila = wabaId
    if (!accessToken) {
      return { ok: false, status: 400, claveI18n: 'whatsappNotConnected' }
    }
    if (!wabaId) {
      return { ok: false, status: 400, claveI18n: 'missingWabaId' }
    }

    try {
      metaResult = await createMessageTemplate({
        wabaId,
        accessToken,
        name,
        language,
        category,
        components,
      })
    } catch (err) {
      // El motivo REAL de Meta viaja en `detail` (error_user_msg /
      // error_user_title); `message` suele ser "Invalid parameter", que no le
      // dice nada a nadie.
      const detail = err instanceof MetaApiError ? err.detail : undefined
      if (detail) return { ok: false, status: 502, mensaje: detail }
      if (err instanceof Error) return { ok: false, status: 502, mensaje: err.message }
      return { ok: false, status: 502, claveI18n: 'metaRejectedTemplate' }
    }
  }

  const headerComponent = components.find((c) => c.type === 'HEADER')
  const footerComponent = components.find((c) => c.type === 'FOOTER')
  const buttonsComponent = components.find((c) => c.type === 'BUTTONS')

  // Los botones que se guardan localmente mantienen la forma que Meta recibe,
  // PERO se les re-adjunta `url_variable` (que Meta no acepta): el motor de
  // automatizaciones lo lee al enviar para llenar el link dinámico por cliente.
  // El orden coincide porque los dos filtran botones por texto no vacío.
  const formButtons = (form.buttons ?? []).filter((b) => b.text?.trim())
  const dbButtons = (buttonsComponent?.buttons ?? []).map((mb, i) => {
    const fb = formButtons[i]
    return fb?.type === 'URL' && fb.url_variable ? { ...mb, url_variable: fb.url_variable } : mb
  })

  const estado: 'Draft' | 'Pending' = enviarAMeta ? 'Pending' : 'Draft'
  const row = {
    user_id: entrada.userId,
    workspace_id: workspaceId,
    name,
    category: DB_CATEGORY[category],
    language,
    header_type: form.headerType === 'none' ? null : form.headerType,
    header_content: headerComponent?.text ?? null,
    body_text: form.bodyText.trim(),
    footer_text: footerComponent?.text ?? null,
    buttons: dbButtons.length > 0 ? dbButtons : null,
    status: estado,
    meta_template_id: metaResult?.id ?? null,
    // Sin esto la fila quedaba sin cuenta de WhatsApp y el conciliador de
    // estados (`reconcile-template-status`, cada 15 min) —que filtra por
    // waba_id— nunca la tocaba: una plantilla enviada a Meta desde acá se
    // quedaba en "Pending" para siempre si el webhook de estado no llegaba.
    // Visto el 2026-09-18 con deuna_compra_pagada_producto_v1.
    waba_id: wabaDeLaFila,
    variable_samples: form.bodySamples ?? null,
    variable_fields:
      entrada.variableFields && Object.keys(entrada.variableFields).length > 0
        ? entrada.variableFields
        : null,
    rejected_reason: null,
    updated_at: new Date().toISOString(),
  }

  let existenteId = entrada.plantillaExistenteId ?? null
  if (!existenteId) {
    let q = db.from('message_templates').select('id').eq('name', name).eq('language', language)
    q = entrada.userId
      ? q.eq('user_id', entrada.userId)
      : q.eq('workspace_id', workspaceId)
    const { data: existing } = await q.maybeSingle()
    existenteId = (existing as { id?: string } | null)?.id ?? null
  }

  const { data: escrita, error: writeErr } = existenteId
    ? await db
        .from('message_templates')
        .update(row)
        .eq('id', existenteId)
        .select('id')
        .maybeSingle()
    : await db.from('message_templates').insert(row).select('id').maybeSingle()

  if (writeErr) {
    console.error('Template mirror failed:', writeErr)
    // Un borrador que no se guardó no se hizo, y punto. Cuando ya salió a Meta
    // es otra cosa: la plantilla ESTÁ en revisión y el catálogo no la tiene, así
    // que el mensaje tiene que decirlo en vez de parecer un fallo limpio.
    return metaResult
      ? {
          ok: false,
          status: 500,
          claveI18n: 'templateSentButMirrorFailed',
          params: { detail: writeErr.message },
          metaTemplateId: metaResult.id,
        }
      : { ok: false, status: 500, mensaje: writeErr.message }
  }

  return {
    ok: true,
    id: (escrita as { id?: string } | null)?.id ?? existenteId,
    name,
    language,
    category,
    estado,
    metaTemplateId: metaResult?.id ?? null,
    estadoMeta: metaResult?.status ?? null,
  }
}

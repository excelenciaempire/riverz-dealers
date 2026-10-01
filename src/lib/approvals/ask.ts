import type { SupabaseClient } from '@supabase/supabase-js'
import { isDeepStrictEqual } from 'node:util'
import { platformWhatsApp } from '@/lib/admin/platform-whatsapp'
import { sendTemplateMessage, sendTextMessage } from '@/lib/whatsapp/meta-api'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { httpApprovalPanelMessage, isProtectedHttpApproval } from './protected-http'

/**
 * El humano en el medio.
 *
 * La operación corre sola casi siempre, pero hay decisiones que no conviene
 * que tome nadie sin mirar: dar por cobrado un pedido con un comprobante que
 * no cierra, mandar una campaña, borrar algo. Para esas, en vez de frenar la
 * operación entera o de arriesgarse, se pregunta.
 *
 * La pregunta sale por el **WhatsApp de Riverz**, no por el del comercio, por
 * dos razones: el comercio ya vive en WhatsApp y ahí contesta en minutos, y
 * si el canal que se vigila fuera el mismo que avisa, el aviso que más
 * importa sería justo el que no llega.
 *
 * La respuesta vuelve por el mismo lado y ejecuta. Ver resolve.ts.
 */

/**
 * El estado de una solicitud que todavía espera.
 *
 * Es una constante y no un literal suelto porque ya se escribió mal una vez: el
 * dedupe de las cancelaciones buscaba `'pending'` —en inglés, como casi todo el
 * resto del esquema— contra una columna que guarda `'pendiente'`. No coincidía
 * nunca, así que el freno que evitaba dos solicitudes idénticas al comercio no
 * frenaba nada, y no fallaba: simplemente no encontraba.
 */
export const APROBACION_PENDIENTE = 'pendiente'

export interface AskInput {
  db: SupabaseClient
  workspaceId: string
  /** Qué se pregunta: 'pago_informado', y lo que venga después. */
  kind: string
  title: string
  body: string
  /** Lo que hace falta para ejecutar si dice que sí. */
  payload?: Record<string, unknown>
  /** Horas de vida de la pregunta. */
  expiresInHours?: number
  /**
   * Identifica una única decisión de negocio. Si vuelve a llegar evidencia del
   * mismo caso, se conserva la solicitud pendiente y se actualiza su detalle.
   */
  dedupeKey?: string
  locale?: 'es' | 'en'
}

export interface AskResult {
  ok: boolean
  approvalId?: string
  /**
   * ¿Le LLEGÓ al comercio?
   *
   * Separado de `ok` a propósito. `ok` dice que la pregunta quedó anotada y
   * espera en el panel; esto dice que además alguien se enteró. Quien mira sólo
   * `ok` le termina diciendo a la clienta "ya lo pasé, te confirman en breve"
   * mientras del otro lado no sonó nada — y eso, en una cancelación o un
   * reembolso, es una promesa que nadie va a cumplir.
   */
  notified: boolean
  /** Por qué no se pudo preguntar o avisar. La acción NO se ejecuta igual. */
  error?: string
}

/**
 * Una plantilla de WhatsApp no admite saltos de línea, tabulaciones ni corridas
 * largas de espacios en sus parámetros: Meta rechaza el envío entero.
 *
 * Los cuerpos de las aprobaciones se arman con `\n` —importe, motivo, qué pasa
 * si acepta—, así que con la plantilla configurada TODO aviso de cancelación y
 * de reembolso fallaba, siempre, en silencio: la fila quedaba esperando en el
 * panel, el comercio nunca se enteraba y a la clienta ya se le había dicho que
 * estaba pedido.
 */
function unaLinea(texto: string): string {
  return texto.replace(/\s*\n+\s*/g, ' · ').replace(/[\t ]{2,}/g, ' ').trim()
}

/**
 * Deja la pregunta anotada y se la manda al comercio.
 *
 * La fila se escribe SIEMPRE, aunque el aviso no salga: sin WhatsApp de
 * plataforma configurado la decisión sigue esperando en el panel, que es
 * mejor que perderla.
 */
export async function askForApproval(input: AskInput): Promise<AskResult> {
  const { db, workspaceId } = input
  const protectedHttp = isProtectedHttpApproval(input.payload)
  if (protectedHttp && (input.kind !== 'herramienta' || !input.dedupeKey || input.dedupeKey.length > 100)) {
    return { ok: false, notified: false, error: 'invalid_http_approval_proposal' }
  }
  const existingHttp = async (): Promise<AskResult | null> => {
    const existing = await db.from('approval_requests').select('id,title,body,payload,status,expires_at,notified_message_id')
      .eq('workspace_id', workspaceId).eq('kind', input.kind).contains('payload', { dedupe_key: input.dedupeKey })
      .limit(1).maybeSingle()
    if (existing.error) return { ok: false, notified: false, error: 'http_approval_unavailable' }
    if (!existing.data) return null
    const approval = existing.data
    const unavailable = (error: string): AskResult => ({ ok: false, approvalId: approval.id, notified: false, error })
    if (approval.title !== input.title || approval.body !== input.body
      || !isDeepStrictEqual(approval.payload, { ...(input.payload ?? {}), dedupe_key: input.dedupeKey })) return unavailable('http_approval_snapshot_changed')
    if (approval.status !== APROBACION_PENDIENTE) return unavailable('http_approval_already_decided')
    const expires = Date.parse(approval.expires_at)
    if (!Number.isFinite(expires) || expires <= Date.now()) return unavailable('http_approval_review_required')
    return { ok: true, approvalId: approval.id, notified: Boolean(approval.notified_message_id) }
  }
  if (protectedHttp) {
    const existing = await existingHttp()
    if (existing) return existing
  }

  if (input.dedupeKey && !protectedHttp) {
    const { data: existing, error } = await db
      .from('approval_requests')
      .select('id, notified_message_id')
      .eq('workspace_id', workspaceId)
      .eq('kind', input.kind)
      .eq('status', APROBACION_PENDIENTE)
      .contains('payload', { dedupe_key: input.dedupeKey })
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return { ok: false, notified: false, error: error.message }
    if (existing) {
      const approval = existing as { id: string; notified_message_id: string | null }
      const { error: updateError } = await db
        .from('approval_requests')
        .update({
          title: input.title,
          body: input.body,
          payload: { ...(input.payload ?? {}), dedupe_key: input.dedupeKey },
          expires_at: new Date(
            Date.now() + (input.expiresInHours ?? 72) * 3_600_000,
          ).toISOString(),
        })
        .eq('id', approval.id)
      if (updateError) return { ok: false, notified: false, error: updateError.message }
      return { ok: true, approvalId: approval.id, notified: Boolean(approval.notified_message_id) }
    }
  }

  const destino = await quienDecide(db, workspaceId)

  const { data, error } = await db
    .from('approval_requests')
    .insert({
      workspace_id: workspaceId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      payload: input.dedupeKey
        ? { ...(input.payload ?? {}), dedupe_key: input.dedupeKey }
        : input.payload ?? {},
      notified_phone: destino,
      expires_at: new Date(
        Date.now() + (input.expiresInHours ?? 72) * 3_600_000,
      ).toISOString(),
    })
    .select('id')
    .single()
  if (error) {
    if (protectedHttp && error.code === '23505') {
      return await existingHttp() ?? { ok: false, notified: false, error: 'http_approval_unavailable' }
    }
    return { ok: false, notified: false, error: protectedHttp ? 'http_approval_unavailable' : error.message }
  }
  const approvalId = (data as { id: string }).id

  if (!destino) {
    return {
      ok: true,
      approvalId,
      notified: false,
      error: 'nadie con teléfono a quién preguntarle',
    }
  }

  const enviado = await avisar(destino, input.title, input.body, approvalId, protectedHttp ? input.locale ?? 'es' : undefined)
  if (enviado.messageId) {
    await db
      .from('approval_requests')
      .update({ notified_message_id: enviado.messageId })
      .eq('id', approvalId)
  }
  return {
    ok: true,
    approvalId,
    notified: Boolean(enviado.messageId),
    error: enviado.error,
  }
}

/**
 * A quién se le pregunta: el dueño del workspace, o el primer administrador
 * con teléfono. Se busca en `profiles`, que es donde vive el teléfono de la
 * persona — no en `contacts`, que son los clientes del comercio.
 *
 * El emparejamiento va por `user_id` y NO por `id`: en `profiles` el `id` es un
 * uuid propio de la fila y el id de `auth.users` vive en `user_id` (migración
 * 001). Buscar por `id` con ids de auth no encuentra jamás a nadie, que es lo
 * que dejó mudas todas las aprobaciones hasta acá.
 */
export async function quienDecide(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data: ws } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle()
  const ownerId = (ws as { owner_id?: string } | null)?.owner_id

  const candidatos: string[] = []
  if (ownerId) candidatos.push(ownerId)

  const { data: miembros } = await db
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', workspaceId)
    .eq('role', 'admin')
  for (const m of (miembros ?? []) as { user_id: string }[]) {
    if (!candidatos.includes(m.user_id)) candidatos.push(m.user_id)
  }
  if (candidatos.length === 0) return null

  const { data: perfiles } = await db
    .from('profiles')
    .select('user_id, phone')
    .in('user_id', candidatos)
  const porId = new Map(
    ((perfiles ?? []) as { user_id: string; phone: string | null }[]).map((p) => [
      p.user_id,
      p.phone,
    ]),
  )
  // Se respeta el orden: primero el dueño.
  for (const id of candidatos) {
    const tel = porId.get(id)
    if (!tel) continue
    const limpio = sanitizePhoneForMeta(tel)
    if (isValidE164(limpio)) return limpio
  }
  return null
}

/**
 * Manda el aviso por el WhatsApp de Riverz.
 *
 * Con plantilla si hay una aprobada (es lo que Meta entrega fuera de la
 * ventana de 24 h); si el comercio nos escribió hace poco, alcanza el texto
 * libre, que además permite explicar el caso completo sin pelearse con los
 * límites de una plantilla.
 */
async function avisar(
  to: string,
  title: string,
  body: string,
  approvalId: string,
  panelLocale?: 'es' | 'en',
): Promise<{ messageId?: string; error?: string }> {
  const plataforma = await platformWhatsApp()
  if (!plataforma) {
    return { error: 'el WhatsApp de Riverz no está configurado' }
  }

  // El código corto es lo que la persona puede responder desde el teclado sin
  // depender de que le lleguen los botones.
  const codigo = approvalId.slice(0, 6)
  const instruction = panelLocale ? httpApprovalPanelMessage(panelLocale)
    : `Responde SI ${codigo} para aprobarlo o NO ${codigo} para rechazarlo.`
  const texto =
    `${title}\n\n${body}\n\n` +
    instruction

  try {
    if (plataforma.templateName) {
      const res = await sendTemplateMessage({
        phoneNumberId: plataforma.phoneNumberId,
        accessToken: plataforma.token,
        to,
        templateName: plataforma.templateName,
        language: plataforma.templateLanguage,
        params: [
          unaLinea(title),
          unaLinea(`${body} — ${panelLocale ? instruction : `responde SI ${codigo} o NO ${codigo}`}`),
        ],
      })
      return { messageId: res.messageId ?? undefined }
    }
    const res = await sendTextMessage({
      phoneNumberId: plataforma.phoneNumberId,
      accessToken: plataforma.token,
      to,
      text: texto,
    })
    return { messageId: res.messageId ?? undefined }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'no se pudo avisar' }
  }
}

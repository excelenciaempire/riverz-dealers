import type { SupabaseClient } from '@supabase/supabase-js'
import { platformWhatsApp } from '@/lib/admin/platform-whatsapp'
import { sendTemplateMessage, sendTextMessage } from '@/lib/whatsapp/meta-api'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

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
}

export interface AskResult {
  ok: boolean
  approvalId?: string
  /** Por qué no se pudo preguntar. La acción NO se ejecuta igual. */
  error?: string
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

  const destino = await quienDecide(db, workspaceId)

  const { data, error } = await db
    .from('approval_requests')
    .insert({
      workspace_id: workspaceId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      payload: input.payload ?? {},
      notified_phone: destino,
      expires_at: new Date(
        Date.now() + (input.expiresInHours ?? 72) * 3_600_000,
      ).toISOString(),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  const approvalId = (data as { id: string }).id

  if (!destino) {
    return { ok: true, approvalId, error: 'nadie con teléfono a quién preguntarle' }
  }

  const enviado = await avisar(destino, input.title, input.body, approvalId)
  if (enviado.messageId) {
    await db
      .from('approval_requests')
      .update({ notified_message_id: enviado.messageId })
      .eq('id', approvalId)
  }
  return { ok: true, approvalId, error: enviado.error }
}

/**
 * A quién se le pregunta: el dueño del workspace, o el primer administrador
 * con teléfono. Se busca en `profiles`, que es donde vive el teléfono de la
 * persona — no en `contacts`, que son los clientes del comercio.
 */
async function quienDecide(
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
    .select('id, phone')
    .in('id', candidatos)
  const porId = new Map(
    ((perfiles ?? []) as { id: string; phone: string | null }[]).map((p) => [p.id, p.phone]),
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
): Promise<{ messageId?: string; error?: string }> {
  const plataforma = await platformWhatsApp()
  if (!plataforma) {
    return { error: 'el WhatsApp de Riverz no está configurado' }
  }

  // El código corto es lo que la persona puede responder desde el teclado sin
  // depender de que le lleguen los botones.
  const codigo = approvalId.slice(0, 6)
  const texto =
    `${title}\n\n${body}\n\n` +
    `Responde SI ${codigo} para aprobarlo o NO ${codigo} para rechazarlo.`

  try {
    if (plataforma.templateName) {
      const res = await sendTemplateMessage({
        phoneNumberId: plataforma.phoneNumberId,
        accessToken: plataforma.token,
        to,
        templateName: plataforma.templateName,
        language: plataforma.templateLanguage,
        params: [title, `${body} — responde SI ${codigo} o NO ${codigo}`],
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

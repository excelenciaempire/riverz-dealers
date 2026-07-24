import {
  sendTextMessage,
  sendTemplateMessage,
  MetaApiError,
  type MetaSendResult,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  isUsPhone,
} from '@/lib/whatsapp/phone-utils'
import { US_MARKETING_BLOCKED_CODE } from '@/lib/whatsapp/delivery-errors'
import { resolveTemplateButtons } from '@/lib/whatsapp/template-buttons'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
// ------------------------------------------------------------

/** Reemplaza los {{1}}, {{2}}… del cuerpo de una plantilla por sus valores
 *  posicionales, para guardar/mostrar el texto real que recibió el cliente. */
function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const v = params[Number(n) - 1]
    return v != null && String(v).trim() ? String(v) : `{{${n}}}`
  })
}

interface SendTextArgs {
  workspaceId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  workspaceId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
  /** Token del short link que llena {{1}} de un botón URL dinámico. */
  buttonUrlParam?: string
  /** Índice del botón dinámico dentro del bloque BUTTONS (0-based). */
  buttonUrlIndex?: number
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact lookup to the automation's workspace. The engine uses
  // the service-role client (bypassing RLS), and the public
  // /api/automations/engine endpoint accepts contact_id from the request
  // body — without this filter, an authenticated user could fire their own
  // automations against another tenant's contact UUID and send to that
  // contact's phone.
  //
  // This used to scope by `contacts.user_id`, but that legacy column is left
  // null by every modern ingest path (inbox-writer, the channel adapters, CSV
  // import), so the lookup matched zero rows and every Shopify automation
  // died with "contact not found for this user". `workspace_id` is the real
  // tenant boundary and is always populated.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found in this workspace')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  // Gate: Meta NO entrega plantillas de MARKETING a números de EE.UU. (pausa
  // vigente desde 2025-04-01) — quedarían en 'sent' para siempre, sin error.
  // Lo registramos como fallido con motivo claro (el comercio ve por qué) en
  // vez de mandarlo al vacío. Solo aplica a plantillas de categoría Marketing.
  if (input.kind === 'template') {
    const { data: tplCat } = await db
      .from('message_templates')
      .select('category')
      .eq('workspace_id', input.workspaceId)
      .eq('name', input.templateName)
      .limit(1)
      .maybeSingle()
    const isMarketing =
      String((tplCat as { category?: string } | null)?.category ?? '').toLowerCase() ===
      'marketing'
    if (isMarketing && isUsPhone(sanitized)) {
      await db.from('messages').insert({
        conversation_id: input.conversationId,
        sender_type: 'bot',
        content_type: 'template',
        content_text: null,
        template_name: input.templateName,
        status: 'failed',
        error_code: US_MARKETING_BLOCKED_CODE,
      })
      // No es un fallo de sistema: no se envió nada a Meta. Devolvemos sin id.
      return { whatsapp_message_id: '' }
    }
  }

  // Credentials come from the workspace's WhatsApp connection — the same
  // store the inbox sends from. The legacy per-user `whatsapp_config` row is
  // only a mirror (see channels/whatsapp/connect.ts syncLegacyWhatsAppConfig)
  // and is missing entirely for any workspace the owner didn't personally
  // connect, so it can't be the source of truth.
  const { data: connection, error: connErr } = await db
    .from('channel_connections')
    .select('config, secrets, external_account_id')
    .eq('workspace_id', input.workspaceId)
    .eq('channel', 'whatsapp')
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const phoneNumberId = String(
    (connection?.config as Record<string, unknown> | null)?.phone_number_id ??
      connection?.external_account_id ??
      '',
  )
  const encryptedToken = String(
    (connection?.secrets as Record<string, unknown> | null)?.access_token ?? '',
  )
  if (connErr || !phoneNumberId || !encryptedToken) {
    throw new Error('WhatsApp not connected for this workspace')
  }

  const accessToken = decrypt(encryptedToken)

  const sendOnce = async (phone: string): Promise<MetaSendResult> => {
    if (input.kind === 'template') {
      return sendTemplateMessage({
        phoneNumberId,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        params: input.params,
        buttonUrlParam: input.buttonUrlParam,
        buttonUrlIndex: input.buttonUrlIndex,
      })
    }
    return sendTextMessage({
      phoneNumberId,
      accessToken,
      to: phone,
      text: input.text,
    })
  }

  // Retry ONLY on transient Meta failures (HTTP 429 / 5xx), where Meta
  // rejected the request before acting on it — so re-sending can't
  // duplicate the message. This is what makes order-confirmation /
  // fulfillment automations survive a Meta rate-limit blip instead of
  // recording status='failed' and silently never reaching the customer.
  // Permanent errors (bad template, invalid recipient) and network
  // timeouts (where the send may have landed) throw on the first try.
  const attempt = async (phone: string): Promise<MetaSendResult> => {
    const MAX = 3
    for (let i = 1; i <= MAX; i++) {
      try {
        return await sendOnce(phone)
      } catch (err) {
        const transient = err instanceof MetaApiError && err.isTransient
        if (!transient || i === MAX) throw err
        await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)))
      }
    }
    // Unreachable — the loop either returns or throws.
    throw new Error('unreachable')
  }

  // Same phone-variant retry as /api/whatsapp/send — Meta sandbox and
  // numbers registered with/without a trunk 0 both require this to
  // reliably land a message.
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let sendResult: MetaSendResult | null = null
  let lastError: unknown = null
  for (const v of variants) {
    try {
      sendResult = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError || !sendResult) throw lastError ?? new Error('send failed')
  const waMessageId = sendResult.messageId

  // Guardar el número que funcionó y el wa_id normalizado que devolvió Meta
  // (identidad real; el "+54 9" argentino resuelve al mismo wa_id con o sin
  // el 9, así que deduplicar por wa_id evita el split de contactos).
  const contactPatch: Record<string, unknown> = {}
  if (workingPhone !== sanitized) contactPatch.phone = workingPhone
  if (sendResult.waId) contactPatch.wa_id = sendResult.waId
  if (Object.keys(contactPatch).length > 0) {
    await db.from('contacts').update(contactPatch).eq('id', contact.id)
  }

  // Persist the sent message so it appears in the inbox with a real
  // Meta message id. sender_type='bot' distinguishes automation sends
  // from manual agent sends.
  //
  // Para plantillas guardamos el CUERPO RENDERIZADO (body con las variables
  // reemplazadas), no null: antes la bandeja mostraba una burbuja vacía porque
  // no había texto que renderizar. Reconstruimos el body desde message_templates
  // + los params posicionales que ya tenemos a mano.
  const content_type = input.kind === 'template' ? 'template' : 'text'
  const template_name = input.kind === 'template' ? input.templateName : null
  let content_text: string | null = input.kind === 'text' ? input.text : null
  // Botones resueltos de la plantilla, para que la bandeja los muestre con el
  // enlace real (no el placeholder {{1}}). Sin esto la burbuja mostraba el
  // cuerpo pero no el botón — el comercio no veía el link de "Terminar Pedido".
  let buttons: import('@/types').MessageButton[] | null = null
  if (input.kind === 'template') {
    const { data: tplRows } = await db
      .from('message_templates')
      .select('body_text, language, buttons')
      .eq('workspace_id', input.workspaceId)
      .eq('name', input.templateName)
    const rows = (tplRows ?? []) as {
      body_text?: string
      language?: string
      buttons?: Array<Record<string, unknown>> | null
    }[]
    const tpl = rows.find((r) => r.language === (input.language ?? 'es')) ?? rows[0]
    if (tpl?.body_text) {
      content_text = renderTemplateBody(tpl.body_text, input.params ?? [])
    }
    buttons = resolveTemplateButtons(tpl?.buttons ?? null, {
      buttonUrlParam: input.buttonUrlParam,
      buttonUrlIndex: input.buttonUrlIndex,
    })
  }

  const { data: inserted, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type,
      content_text,
      template_name,
      buttons,
      message_id: waMessageId,
      status: 'sent',
      // Retención por PACING (plantilla nueva / sin calidad GREEN): Meta acepta
      // pero no dispara 'sent' hasta liberar. La bandeja lo muestra como "en
      // revisión de calidad" en vez de un 'sent' mudo.
      held_for_quality: sendResult.messageStatus === 'held_for_quality_assessment',
    })
    .select('created_at')
    .single()
  if (msgErr) {
    // Meta already has the message; record the DB error but don't pretend
    // the send failed. The engine wraps this in a log line.
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  // `last_message_at` toma el created_at REAL de la fila insertada, no un
  // new Date() posterior: si queda por delante del mensaje, el trigger que
  // sincroniza el tick del preview descarta todo update de estado siguiente.
  // `last_sender_type` es obligatorio para que la lista dibuje el tick — sin
  // él la conversación queda como 'customer' y no muestra ninguno.
  const sentAt = (inserted?.created_at as string | undefined) ?? new Date().toISOString()
  await db
    .from('conversations')
    .update({
      // Preview de la lista: el cuerpo renderizado (o el nombre de la plantilla
      // si no se pudo reconstruir) en vez del crudo "[template:...]".
      last_message_text:
        input.kind === 'template'
          ? content_text ?? `[${input.templateName}]`
          : input.text,
      last_message_at: sentAt,
      last_sender_type: 'bot',
      updated_at: sentAt,
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}

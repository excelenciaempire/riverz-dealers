/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

import { withAppsecretProof } from '@/lib/channels/meta-graph'
import { TRANSIENT_META_CODES } from '@/lib/whatsapp/delivery-errors'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
  /**
   * `message_status` de la respuesta de envío de Meta: 'accepted' (procesado
   * normal) o 'held_for_quality_assessment' (retenido por PACING — plantilla
   * nueva / sin calidad GREEN). Un mensaje retenido NO dispara webhook 'sent'
   * hasta liberarse, así que sin capturar esto quedaba como un 'sent' mudo.
   */
  messageStatus?: string
  /** wa_id normalizado que Meta devolvió para el destinatario (la identidad
   *  real: el "+54 9" argentino resuelve al mismo wa_id con o sin el 9). */
  waId?: string
}

export interface MetaPhoneInfo {
  id: string
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
}

interface MetaErrorResponse {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
    type?: string
    error_data?: { details?: string; messaging_product?: string }
    error_user_title?: string
    error_user_msg?: string
    fbtrace_id?: string
  }
}

/**
 * Error thrown by every Meta call. Carries the HTTP `status` and Meta
 * `code` so callers can tell a transient failure (HTTP 429 / 5xx — Meta
 * did NOT accept the request) apart from a permanent one (bad template,
 * invalid recipient). Retrying is only safe on the transient kind; a
 * naive retry on a network timeout could double-send.
 *
 * Además del `code`, captura `subcode`, `detail` (error_data.details /
 * error_user_msg) y `fbtraceId` — Meta pone el motivo REAL en esos campos y
 * antes se descartaban, dejando solo un `message` genérico.
 */
export class MetaApiError extends Error {
  status: number
  code?: number
  subcode?: number
  detail?: string
  fbtraceId?: string
  constructor(
    message: string,
    status: number,
    code?: number,
    opts?: { subcode?: number; detail?: string; fbtraceId?: string },
  ) {
    super(message)
    this.name = 'MetaApiError'
    this.status = status
    this.code = code
    this.subcode = opts?.subcode
    this.detail = opts?.detail
    this.fbtraceId = opts?.fbtraceId
  }
  /** HTTP 429 (rate limit) or 5xx — Meta rejected the request before
   *  acting on it — OR a transient Meta code (throughput / service
   *  unavailable). Re-sending is safe in all these cases because Meta
   *  did not accept the request. */
  get isTransient(): boolean {
    if (this.status === 429 || this.status >= 500) return true
    return this.code != null && TRANSIENT_META_CODES.has(this.code)
  }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code: number | undefined
  let subcode: number | undefined
  let detail: string | undefined
  let fbtraceId: string | undefined
  try {
    const data = (await response.json()) as MetaErrorResponse
    const err = data.error
    if (err?.message) message = err.message
    code = err?.code
    subcode = err?.error_subcode
    // Meta pone la explicación accionable en error_data.details o
    // error_user_msg; preferimos esa al `message` genérico.
    // `error_user_title` es el titular en castellano de la consola de Meta
    // ("Content in This Language Already Exists"); sin él, `message` llega
    // como "Invalid parameter" y no se entiende nada.
    detail =
      err?.error_data?.details ||
      err?.error_user_msg ||
      err?.error_user_title ||
      undefined
    fbtraceId = err?.fbtrace_id
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new MetaApiError(message, response.status, code, { subcode, detail, fbtraceId })
}

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
  args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
  const { phoneNumberId, accessToken } = args
  const url = withAppsecretProof(
    `${META_API_BASE}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
    accessToken,
  )
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  /** Meta's message_id of the message being replied to. Adds a `context` field
   *  so WhatsApp renders the new message as a reply with a quote preview. */
  contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
  args: SendTextMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, text, contextMessageId } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return {
    messageId: data.messages[0].id,
    messageStatus: data.messages?.[0]?.message_status,
    waId: data.contacts?.[0]?.wa_id,
  }
}

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  params?: string[]
  headerImageUrl?: string
  /** Valor que llena la variable {{1}} de un botón URL DINÁMICO (el token del
   *  short link). Cuando está presente se emite el componente `button`. */
  buttonUrlParam?: string
  /** Índice del botón dinámico dentro del bloque BUTTONS (0-based). */
  buttonUrlIndex?: number
  buttonUrlParams?: Array<{ index: number; text: string }>
  /** Meta's message_id of the message being replied to. */
  contextMessageId?: string
}

/** Meta rejects template text parameters containing line breaks or tabs. */
export function sanitizeTemplateTextParameter(value: unknown): string {
  return String(value ?? '')
    .replace(/\s*\r?\n\s*/g, ' · ')
    .replace(/\t/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    templateName,
    language = 'en_US',
    params,
    buttonUrlParam,
    buttonUrlIndex = 0,
    buttonUrlParams,
    contextMessageId,
  } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  const components: Record<string, unknown>[] = []
  if (args.headerImageUrl) {
    components.push({ type: 'header', parameters: [{ type: 'image', image: { link: args.headerImageUrl } }] })
  }
  if (params && params.length > 0) {
    components.push({
      type: 'body',
      parameters: params.map((p) => ({
        type: 'text',
        text: sanitizeTemplateTextParameter(p),
      })),
    })
  }
  for (const button of buttonUrlParams ?? (buttonUrlParam ? [{ index: buttonUrlIndex, text: buttonUrlParam }] : [])) {
    // Botón URL dinámico: {{1}} se llena con el token del short link. `index`
    // es la posición del botón dentro del bloque BUTTONS de la plantilla.
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(button.index),
      parameters: [
        { type: 'text', text: sanitizeTemplateTextParameter(button.text) },
      ],
    })
  }
  if (components.length > 0) {
    template.components = components
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return {
    messageId: data.messages[0].id,
    messageStatus: data.messages?.[0]?.message_status,
    waId: data.contacts?.[0]?.wa_id,
  }
}

// ============================================================
// Message templates (official creation / deletion)
// ============================================================
//
// Unlike the read-only sync route (which only pulls Meta's approved
// templates into the local catalog), these helpers PUSH local → Meta:
// they submit a template for review and delete it. Submission returns
// immediately with status PENDING — Meta reviews asynchronously and the
// status later flips to APPROVED / REJECTED, which the sync route picks up.

export type MetaTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'

/**
 * A single component of a template as the Meta create-endpoint expects it.
 * Built by the caller (the create route) from the user's form. Kept as a
 * loose shape because Meta's component schema varies a lot by type
 * (text header vs media header vs buttons).
 */
export interface MetaTemplateComponentInput {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  text?: string
  /** e.g. { body_text: [["sample1","sample2"]] } or { header_text: ["sample"] } */
  example?: Record<string, unknown>
  buttons?: Array<Record<string, unknown>>
}

export interface CreateMessageTemplateArgs {
  wabaId: string
  accessToken: string
  /** Meta requires lowercase, snake_case, ≤ 512 chars. */
  name: string
  /** Exact Meta language code, e.g. en_US, es, es_MX. */
  language: string
  category: MetaTemplateCategory
  components: MetaTemplateComponentInput[]
}

export interface CreateMessageTemplateResult {
  id: string
  /** Usually "PENDING" right after submission. */
  status: string
  category?: string
}

/**
 * Submit a new message template to Meta for review.
 * POST /{waba-id}/message_templates
 */
export async function createMessageTemplate(
  args: CreateMessageTemplateArgs
): Promise<CreateMessageTemplateResult> {
  const { wabaId, accessToken, name, language, category, components } = args
  const url = withAppsecretProof(
    `${META_API_BASE}/${wabaId}/message_templates`,
    accessToken,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, language, category, components }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { id: data.id, status: data.status, category: data.category }
}

export interface DeleteMessageTemplateArgs {
  wabaId: string
  accessToken: string
  /** Without `hsmId`, deletes every language version registered under this name. */
  name: string
  /**
   * Meta's template id, to delete ONE language version.
   *
   * A local row is one language; deleting the name would take the Spanish and
   * the English copy with it when only one was asked for.
   */
  hsmId?: string
}

/**
 * Delete a template from Meta.
 * DELETE /{waba-id}/message_templates?name=...[&hsm_id=...]
 */
export async function deleteMessageTemplate(
  args: DeleteMessageTemplateArgs
): Promise<void> {
  const { wabaId, accessToken, name, hsmId } = args
  const url = withAppsecretProof(
    `${META_API_BASE}/${wabaId}/message_templates?name=${encodeURIComponent(name)}` +
      (hsmId ? `&hsm_id=${encodeURIComponent(hsmId)}` : ''),
    accessToken,
  )
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** Meta's message_id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction per Meta's spec.
 */
export async function sendReactionMessage(
  args: SendReactionMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
  const url = withAppsecretProof(
    `${META_API_BASE}/${phoneNumberId}/messages`,
    accessToken,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Interactive (button replies + list messages)
// ============================================================
//
// Meta's two flavours of interactive message — used by the Flows
// engine to drive scripted chatbot menus. Caller passes plain
// JS values; helpers shape the Meta payload and enforce Meta's
// limits BEFORE the network call so the failure mode is a
// developer-facing error rather than a customer-facing one.

/**
 * Meta limits for interactive messages, hard-coded so violations
 * fail at build/save time rather than as a 400 from the Meta API
 * mid-conversation. See:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 */
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
  /** Stable id sent back in the webhook when tapped (≤ 256 chars). */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface SendInteractiveButtonsArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** The body text — what the customer reads above the buttons. */
  bodyText: string
  /** Optional plain-text header (≤ 60 chars). */
  headerText?: string
  /** Optional grey footer line under the buttons (≤ 60 chars). */
  footerText?: string
  /** 1–3 buttons. Validated against Meta's limits before sending. */
  buttons: InteractiveButton[]
  /** Meta's message_id of the message being replied to (quote preview). */
  contextMessageId?: string
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and Meta delivers a webhook with
 * `messages[0].interactive.button_reply.id` set to the matching button.id.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, headerText, footerText, buttons, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
    throw new Error(
      `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`
    )
  }
  for (const btn of buttons) {
    if (!btn.id) throw new Error('Interactive button missing id.')
    if (!btn.title) throw new Error(`Interactive button "${btn.id}" missing title.`)
    if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      throw new Error(
        `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
      )
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = withAppsecretProof(
    `${META_API_BASE}/${phoneNumberId}/messages`,
    accessToken,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface InteractiveListRow {
  /** Stable id sent back in the webhook when tapped (≤ 200 chars). */
  id: string
  /** Visible row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line shown under the title (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface SendInteractiveListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string
  headerText?: string
  footerText?: string
  /**
   * 1–10 rows TOTAL across all sections. Meta caps the *total*, not
   * per-section. Validation enforces this before send.
   */
  sections: InteractiveListSection[]
  contextMessageId?: string
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit allows.
 * Webhook arrives with `messages[0].interactive.list_reply.id` set to
 * the matching row.id.
 */
export async function sendInteractiveList(
  args: SendInteractiveListArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, buttonLabel, headerText, footerText, sections, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (!buttonLabel) throw new Error('Interactive list requires a buttonLabel.')
  if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
    )
  }
  if (sections.length < 1 || sections.length > INTERACTIVE_LIMITS.maxListSections) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`
    )
  }
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0)
  if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`
    )
  }
  const seenIds = new Set<string>()
  for (const section of sections) {
    for (const row of section.rows) {
      if (!row.id) throw new Error('Interactive list row missing id.')
      if (seenIds.has(row.id)) {
        throw new Error(`Interactive list has duplicate row id "${row.id}".`)
      }
      seenIds.add(row.id)
      if (!row.title) throw new Error(`Interactive list row "${row.id}" missing title.`)
      if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
        throw new Error(
          `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`
        )
      }
      if (
        row.description &&
        row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
      ) {
        throw new Error(
          `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`
        )
      }
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: buttonLabel,
      sections: sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = withAppsecretProof(
    `${META_API_BASE}/${phoneNumberId}/messages`,
    accessToken,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

function validateInteractiveBody(bodyText: string): void {
  if (!bodyText) throw new Error('Interactive message requires bodyText.')
  if (bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`
    )
  }
}

function validateInteractiveHeaderFooter(
  headerText: string | undefined,
  footerText: string | undefined,
): void {
  if (headerText && headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    throw new Error(
      `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`
    )
  }
  if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
    throw new Error(
      `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`
    )
  }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
  mediaId: string
  accessToken: string
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 */
export async function getMediaUrl(
  args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = args
  // Validar el formato del mediaId antes de interpolarlo en la URL de Graph:
  // un valor como `me?fields=...` o `123/something` permitiría pivotear el
  // recurso/query del llamado a Graph (parameter injection). Los media IDs de
  // Meta son numéricos largos.
  if (!/^\d{5,}$/.test(mediaId)) {
    throw new Error('Invalid media id')
  }
  const response = await fetch(
    withAppsecretProof(`${META_API_BASE}/${encodeURIComponent(mediaId)}`, accessToken),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (!response.ok) {
    await throwMetaError(response, `Media fetch failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.url) throw new Error('Media URL not found in Meta response')
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' }
}

// ============================================================
// Media messages — image / video / document
// ============================================================
// Each takes a public https URL. Meta downloads the asset itself; we
// never proxy media bytes for outbound sends. Callers are responsible
// for keeping the URL reachable for at least a few minutes after the
// request returns (Meta sometimes lazy-fetches).

interface SendMediaArgs {
  voice?: boolean
  phoneNumberId: string
  accessToken: string
  to: string
  url: string
  caption?: string
  /** Document filename shown to the recipient. Document only. */
  filename?: string
  contextMessageId?: string
}

async function sendMedia(
  args: SendMediaArgs,
  kind: 'image' | 'video' | 'document' | 'audio',
): Promise<MetaSendResult> {
  const payload: Record<string, unknown> = { link: args.url }
  if (kind === 'audio' && args.voice) payload.voice = true
  // Audio messages (incl. voice notes) reject caption + filename per Meta.
  if (args.caption && kind !== 'audio') payload.caption = args.caption
  if (kind === 'document' && args.filename) payload.filename = args.filename

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: kind,
    [kind]: payload,
  }
  if (args.contextMessageId) body.context = { message_id: args.contextMessageId }

  const url = withAppsecretProof(
    `${META_API_BASE}/${args.phoneNumberId}/messages`,
    args.accessToken,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API ${kind} send failed: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export function sendImageMessage(args: SendMediaArgs): Promise<MetaSendResult> {
  return sendMedia(args, 'image')
}
export function sendVideoMessage(args: SendMediaArgs): Promise<MetaSendResult> {
  return sendMedia(args, 'video')
}
export function sendDocumentMessage(args: SendMediaArgs): Promise<MetaSendResult> {
  return sendMedia(args, 'document')
}
export function sendAudioMessage(args: SendMediaArgs): Promise<MetaSendResult> {
  return sendMedia(args, 'audio')
}

// ============================================================
// interactive.cta_url — one tap-to-open URL button
// ============================================================
// This is the only Meta "interactive" type that links out of WhatsApp.
// You can't mix reply buttons + URL buttons in a single message — Meta
// requires this dedicated payload shape.

export interface SendInteractiveCtaUrlArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  headerText?: string
  footerText?: string
  /** Visible button label (≤ 20 chars per Meta). */
  buttonTitle: string
  /** Destination URL — must be https. */
  url: string
  contextMessageId?: string
}

export async function sendInteractiveCtaUrl(
  args: SendInteractiveCtaUrlArgs,
): Promise<MetaSendResult> {
  validateInteractiveBody(args.bodyText)
  validateInteractiveHeaderFooter(args.headerText, args.footerText)
  if (!args.buttonTitle || args.buttonTitle.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `cta_url buttonTitle "${args.buttonTitle}" must be 1-${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`,
    )
  }
  if (!/^https:\/\//.test(args.url)) {
    throw new Error('cta_url URL must start with https://')
  }

  const interactive: Record<string, unknown> = {
    type: 'cta_url',
    body: { text: args.bodyText },
    action: {
      name: 'cta_url',
      parameters: { display_text: args.buttonTitle, url: args.url },
    },
  }
  if (args.headerText) interactive.header = { type: 'text', text: args.headerText }
  if (args.footerText) interactive.footer = { text: args.footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'interactive',
    interactive,
  }
  if (args.contextMessageId) body.context = { message_id: args.contextMessageId }

  const url = withAppsecretProof(
    `${META_API_BASE}/${args.phoneNumberId}/messages`,
    args.accessToken,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API cta_url send failed: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

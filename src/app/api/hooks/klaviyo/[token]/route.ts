import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyKlaviyoHookToken } from '@/lib/integrations/klaviyo'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { isOptedOut } from '@/lib/whatsapp/opt-out'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('hooks.klaviyo')

/**
 * POST /api/hooks/klaviyo/{token}
 *
 * Un paso de WhatsApp dentro de los flujos de Klaviyo. El comercio agrega la
 * acción "Webhook" a cualquiera de sus flujos, pega esta URL y arma el cuerpo
 * con las variables del perfil. Riverz recibe, resuelve el contacto y manda la
 * plantilla.
 *
 * Por qué así y no una audiencia más en Riverz: el editor de flujos de Klaviyo
 * ya lo sabe usar y tiene la lógica de esperas, ramas y condiciones montada
 * sobre SU data. Duplicar eso acá sería pedirle que mantenga dos motores.
 *
 * Cuerpo esperado (lo que el comercio escribe en la acción):
 *   {
 *     "phone": "{{ person.phone_number }}",
 *     "email": "{{ person.email }}",          // opcional, para encontrar al contacto
 *     "template": "carrito_abandonado_2",
 *     "language": "es",                        // opcional
 *     "variables": ["Juan", "3 unidades"]      // opcional, en orden
 *   }
 *
 * Autenticación: el token de la ruta es una firma HMAC del workspace. Klaviyo
 * no permite cabeceras propias en la acción de webhook, así que el secreto
 * viaja en la URL — que es exactamente el patrón que usan sus propios
 * destinos. Sin firma válida, 404: una URL de integración no confirma la
 * existencia de nada a quien la adivina.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  const workspaceId = verifyKlaviyoHookToken(token)
  if (!workspaceId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as {
    phone?: string
    email?: string
    template?: string
    language?: string
    variables?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const templateName = (body.template ?? '').trim()
  if (!templateName) {
    return NextResponse.json({ error: 'template requerido' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // La integración tiene que estar conectada: si el comercio la desconectó,
  // esta URL deja de mandar. Es la forma de cortar el paso desde Riverz sin
  // tener que entrar a editar sus flujos.
  const { data: integration } = await admin
    .from('workspace_integrations')
    .select('is_active')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'klaviyo')
    .maybeSingle()
  if (!(integration as { is_active?: boolean } | null)?.is_active) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const digits = sanitizePhoneForMeta(body.phone ?? '')
  const email = body.email?.trim().toLowerCase() || null
  if (!digits && !email) {
    return NextResponse.json({ error: 'phone o email requerido' }, { status: 400 })
  }

  // Buscar al contacto por teléfono y, si no aparece, por correo. No se crea
  // uno nuevo: mandarle una plantilla a alguien que Riverz no conoce es
  // exactamente el caso en que el número viene mal escrito desde el otro lado.
  type ContactRow = { id: string; phone: string | null }
  let contact: ContactRow | null = null
  if (digits) {
    const tail = digits.slice(-8)
    const { data } = await admin
      .from('contacts')
      .select('id, phone')
      .eq('workspace_id', workspaceId)
      .ilike('phone', `%${tail}`)
      .limit(1)
      .maybeSingle()
    contact = (data as ContactRow | null) ?? null
  }
  if (!contact && email) {
    const { data } = await admin
      .from('contacts')
      .select('id, phone')
      .eq('workspace_id', workspaceId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle()
    contact = (data as ContactRow | null) ?? null
  }
  if (!contact) {
    return NextResponse.json({ error: 'contacto no encontrado', sent: false }, { status: 404 })
  }

  const phone = sanitizePhoneForMeta(contact.phone ?? '')
  if (!isValidE164(phone)) {
    return NextResponse.json(
      { error: 'el contacto no tiene un teléfono válido', sent: false },
      { status: 400 },
    )
  }

  // La baja manda sobre cualquier flujo, venga de donde venga.
  if (await isOptedOut(admin, workspaceId, contact.id)) {
    return NextResponse.json({ sent: false, reason: 'opted_out' })
  }

  const conversationId = await resolveWhatsAppConversation(workspaceId, contact.id)

  try {
    const { whatsapp_message_id } = await engineSendTemplate({
      workspaceId,
      conversationId,
      contactId: contact.id,
      templateName,
      language: body.language,
      params: Array.isArray(body.variables)
        ? body.variables.map((v) => String(v ?? ''))
        : undefined,
      automationName: 'Klaviyo',
    })
    return NextResponse.json({ sent: true, message_id: whatsapp_message_id })
  } catch (err) {
    log.captureException(err, { workspaceId, contactId: contact.id, templateName })
    const message = err instanceof Error ? err.message : 'send failed'
    return NextResponse.json({ sent: false, error: message }, { status: 502 })
  }
}

/**
 * Hilo de WhatsApp del contacto, o uno nuevo. Mismo criterio que el motor de
 * automatizaciones: se filtra por canal para no colgar la plantilla de una
 * conversación de Instagram vieja, y se ignoran los hilos borrados de la
 * bandeja para que el mensaje no caiga en una fila invisible.
 */
async function resolveWhatsAppConversation(
  workspaceId: string,
  contactId: string,
): Promise<string> {
  const admin = supabaseAdmin()
  const { data } = await admin
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const existing = (data as { id?: string } | null)?.id
  if (existing) return existing

  const { data: created, error } = await admin
    .from('conversations')
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      channel: 'whatsapp',
      status: 'open',
    })
    .select('id')
    .single()
  if (error) throw new Error(`no se pudo abrir la conversación: ${error.message}`)
  return (created as { id: string }).id
}

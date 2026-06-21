import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { csrfGuard } from '@/lib/csrf'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * POST /api/broadcasts/test
 *
 * Renderiza una plantilla con los valores que pasa el merchant y la
 * dispara a UN número (típicamente el propio operador) para verificar
 * formato + variables antes de lanzar la campaña real.
 *
 * Body: { templateId: string, phone: string, variables: Record<string,string> }
 * Resp: { sent: true, messageId } | { sent: false, error }
 */

interface TestBody {
  templateId?: string
  phone?: string
  variables?: Record<string, string>
}

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { sent: false, error: translate(locale, 'errFlows.testNoSession') },
      { status: 401 },
    )
  }

  const limit = checkRateLimit(`broadcast-test:${user.id}`, RATE_LIMITS.send)
  if (!limit.success) return rateLimitResponse(limit)

  const body = (await request.json().catch(() => null)) as TestBody | null
  if (!body?.templateId || !body.phone) {
    return NextResponse.json(
      {
        sent: false,
        error: translate(locale, 'errFlows.testMissingTemplateOrPhone'),
      },
      { status: 400 },
    )
  }

  const sanitized = sanitizePhoneForMeta(body.phone)
  if (!isValidE164(sanitized)) {
    return NextResponse.json(
      { sent: false, error: translate(locale, 'errFlows.testInvalidPhone') },
      { status: 400 },
    )
  }

  const { data: template, error: tplErr } = await supabase
    .from('message_templates')
    .select('*')
    .eq('id', body.templateId)
    .maybeSingle()
  if (tplErr || !template) {
    return NextResponse.json(
      {
        sent: false,
        error: translate(locale, 'errFlows.testTemplateNotFound'),
      },
      { status: 404 },
    )
  }

  const { data: config, error: configErr } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', user.id)
    .single()
  if (configErr || !config) {
    return NextResponse.json(
      {
        sent: false,
        error: translate(locale, 'errFlows.testWhatsappNotConfigured'),
      },
      { status: 400 },
    )
  }

  const accessToken = decrypt(config.access_token as string)
  const phoneNumberId = config.phone_number_id as string
  const params = orderedParams(template.body_text as string | null, body.variables ?? {})

  let lastError: string | null = null
  for (const variant of phoneVariants(sanitized)) {
    try {
      const r = await sendTemplateMessage({
        phoneNumberId,
        accessToken,
        to: variant,
        templateName: template.name as string,
        language: (template.language as string | undefined) ?? 'es',
        params,
      })
      return NextResponse.json({ sent: true, messageId: r.messageId })
    } catch (err) {
      lastError =
        err instanceof Error
          ? err.message
          : translate(locale, 'errFlows.testUnknownError')
      if (!isRecipientNotAllowedError(lastError)) break
    }
  }

  return NextResponse.json(
    {
      sent: false,
      error: lastError ?? translate(locale, 'errFlows.testUnknownError'),
    },
    { status: 502 },
  )
}

/**
 * Convierte { "1": "Juan", "2": "..." } en el array ordenado que pide
 * Meta. Toma sólo las variables que la plantilla realmente declara, en
 * el orden numérico que aparecen en el cuerpo.
 */
function orderedParams(
  bodyText: string | null,
  values: Record<string, string>,
): string[] {
  if (!bodyText) return []
  const found = new Set<string>()
  const re = /\{\{(\d+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(bodyText)) !== null) found.add(m[1])
  return [...found]
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => values[k] ?? '')
}

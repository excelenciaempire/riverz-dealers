import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { crearPlantilla } from '@/lib/templates/create'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * Submit a NEW WhatsApp message template to Meta for approval, then mirror
 * it into the local message_templates catalog with status='Pending'.
 *
 * This is the "official" path the read-only sync route deliberately avoids:
 * the sync route pulls Meta → local, this route pushes local → Meta. After
 * Meta reviews (async), the status flips to Approved/Rejected and a later
 * sync picks that up.
 *
 * La secuencia entera vive en `@/lib/templates/create`: acá quedan la sesión,
 * el límite de tasa y la traducción de los errores, que es lo único propio de
 * HTTP. El Operator llama a la misma función sin pasar por acá.
 *
 * Body shape (TemplateFormInput + name/language):
 *   {
 *     name, language, category,
 *     headerType, headerText?, headerHandle?,
 *     bodyText, bodySamples?, footerText?, buttons?
 *   }
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const locale = await getLocale()
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.notAuthenticated') },
        { status: 401 },
      )
    }

    const limit = checkRateLimit(`template-create:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.invalidJson') },
        { status: 400 },
      )
    }

    const resultado = await crearPlantilla(supabase, {
      workspaceId: await resolveWorkspaceIdForUser(supabase, user.id),
      userId: user.id,
      nombre: body.name ?? '',
      idioma: body.language,
      categoria: body.category,
      headerType: body.headerType ?? 'none',
      headerText: body.headerText,
      headerHandle: body.headerHandle,
      bodyText: body.bodyText ?? '',
      footerText: body.footerText,
      buttons: body.buttons,
      bodySamples: body.bodySamples,
      variableFields: body.variableFields,
    })

    if (!resultado.ok) {
      const error =
        resultado.mensaje ??
        translate(locale, `errWhatsapp.${resultado.claveI18n}`, resultado.params)
      return NextResponse.json(
        resultado.metaTemplateId
          ? { error, meta_template_id: resultado.metaTemplateId }
          : { error },
        { status: resultado.status },
      )
    }

    return NextResponse.json({
      success: true,
      name: resultado.name,
      language: resultado.language,
      meta_template_id: resultado.metaTemplateId,
      status: resultado.estadoMeta,
    })
  } catch (error) {
    console.error('Error creating WhatsApp template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : translate(locale, 'errWhatsapp.createTemplateFailed'),
      },
      { status: 500 },
    )
  }
}

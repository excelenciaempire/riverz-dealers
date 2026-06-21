import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  createMessageTemplate,
  type MetaTemplateCategory,
} from '@/lib/whatsapp/meta-api'
import {
  buildTemplateComponents,
  normalizeTemplateName,
  type TemplateFormInput,
} from '@/lib/whatsapp/template-components'
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
 * Body shape (TemplateFormInput + name/language):
 *   {
 *     name, language, category,
 *     headerType, headerText?, headerHandle?,
 *     bodyText, bodySamples?, footerText?, buttons?
 *   }
 */

const DB_CATEGORY: Record<MetaTemplateCategory, 'Marketing' | 'Utility' | 'Authentication'> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
}

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
    const rawName: string = body.name ?? ''
    const language: string = (body.language ?? 'es').trim()
    const category: MetaTemplateCategory = body.category ?? 'MARKETING'

    const name = normalizeTemplateName(rawName)
    if (!name) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.templateNameRequired') },
        { status: 400 },
      )
    }
    if (!['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category)) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.invalidCategory') },
        { status: 400 },
      )
    }

    const form: TemplateFormInput = {
      category,
      headerType: body.headerType ?? 'none',
      headerText: body.headerText,
      headerHandle: body.headerHandle,
      bodyText: body.bodyText ?? '',
      footerText: body.footerText,
      buttons: body.buttons,
      bodySamples: body.bodySamples,
    }

    const { components, error: buildError } = buildTemplateComponents(form)
    if (buildError) {
      return NextResponse.json({ error: buildError }, { status: 400 })
    }

    // whatsapp_config holds waba_id + the encrypted access token.
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.whatsappNotConnected') },
        { status: 400 },
      )
    }
    if (!config.waba_id) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.missingWabaId') },
        { status: 400 },
      )
    }

    // message_templates.workspace_id is NOT NULL. Resolve it now so the
    // local mirror actually persists — without it the INSERT below fails
    // the not-null constraint and the template silently never appears in
    // the catalog (the picker, broadcasts and automations all read it).
    const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
    if (!workspaceId) {
      return NextResponse.json(
        { error: translate(locale, 'errWhatsapp.workspaceResolveFailed') },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    let metaResult
    try {
      metaResult = await createMessageTemplate({
        wabaId: config.waba_id,
        accessToken,
        name,
        language,
        category,
        components,
      })
    } catch (err) {
      // Surface Meta's reason (e.g. duplicate name, invalid variable) directly.
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : translate(locale, 'errWhatsapp.metaRejectedTemplate'),
        },
        { status: 502 },
      )
    }

    // Mirror into the local catalog. Upsert by (user_id, name, language)
    // matching the sync route's matching key.
    const headerComponent = components.find((c) => c.type === 'HEADER')
    const footerComponent = components.find((c) => c.type === 'FOOTER')
    const buttonsComponent = components.find((c) => c.type === 'BUTTONS')

    const row = {
      user_id: user.id,
      workspace_id: workspaceId,
      name,
      category: DB_CATEGORY[category],
      language,
      header_type:
        form.headerType === 'none' ? null : form.headerType,
      header_content: headerComponent?.text ?? null,
      body_text: form.bodyText.trim(),
      footer_text: footerComponent?.text ?? null,
      buttons: buttonsComponent?.buttons ?? null,
      status: 'Pending' as const,
      meta_template_id: metaResult.id,
      variable_samples: form.bodySamples ?? null,
      rejected_reason: null,
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabase
      .from('message_templates')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', name)
      .eq('language', language)
      .maybeSingle()

    const { error: writeErr } = existing?.id
      ? await supabase.from('message_templates').update(row).eq('id', existing.id)
      : await supabase.from('message_templates').insert(row)

    // The template DID reach Meta (it's queued for review), but if the
    // local mirror failed the catalog/picker won't show it. Surface it
    // instead of returning a false success.
    if (writeErr) {
      console.error('Template mirror failed:', writeErr)
      return NextResponse.json(
        {
          error: translate(locale, 'errWhatsapp.templateSentButMirrorFailed', {
            detail: writeErr.message,
          }),
          meta_template_id: metaResult.id,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      name,
      language,
      meta_template_id: metaResult.id,
      status: metaResult.status,
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

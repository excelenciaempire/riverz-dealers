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
import { acquire } from '@/lib/whatsapp/throttle'
import {
  assertWithinTierCap,
  resolveWhatsAppConnectionId,
} from '@/lib/whatsapp/tier-cap'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  params?: string[]
}

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    // Tope de tamaño: el fan-out itera el array completo en una request, así
    // que un array gigante mantendría el handler vivo consumiendo CPU/memoria
    // antes de que el throttle module la salida. Campañas más grandes deben
    // dividirse.
    const MAX_RECIPIENTS = 5000
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        {
          error: `Demasiados destinatarios (máx ${MAX_RECIPIENTS}). Dividí la campaña.`,
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Resolve the channel_connection for tier-cap enforcement. We use
    // the service-role client here because RLS on channel_connections
    // requires admin-role membership; the broadcast endpoint already
    // authenticates the user — we just want the connection id mapped
    // to *this* user's workspace. Connection-less (legacy-only)
    // workspaces fall through to `null` and skip the cap check.
    const admin = supabaseAdmin()
    const workspaceId = (config as { workspace_id?: string | null }).workspace_id ?? null
    const connectionId = workspaceId
      ? await resolveWhatsAppConnectionId(admin, workspaceId)
      : null

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0
    let deferredCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // WABA messaging-tier cap. Counted per individual recipient so
      // we surface a precise reason on the first denied row and stop —
      // the remaining recipients stay un-attempted in the response so
      // the caller (UI / bulk script) can re-queue them later.
      if (connectionId) {
        const decision = await assertWithinTierCap(admin, connectionId, 1)
        if (!decision.allowed) {
          deferredCount++
          results.push({
            phone: recipient.phone,
            status: 'failed',
            error: decision.reason ?? 'WABA tier cap reached',
          })
          // Every remaining recipient would hit the same cap; abort
          // the batch instead of burning N more failed rows.
          break
        }
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      // Pace against the per-WABA token bucket so a pasted 5,000-row
      // CSV doesn't hammer Meta's API as fast as it can answer.
      await acquire(user.id)

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || 'en_US',
            params: recipient.params ?? [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      // Recipients we never attempted because the WABA tier cap would
      // have been tripped. Caller should re-submit them later (cron
      // path or after the 24h rolling window slides).
      deferred: deferredCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}

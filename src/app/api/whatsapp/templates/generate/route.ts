import { getAnthropic } from '@/lib/ai/anthropic-client'
import { esfuerzo } from '@/lib/ai/esfuerzo'
import { resolveAnthropicKey } from '@/lib/ai/platform-key'
import { aiBudgetGuard } from '@/lib/ai/rate-limit'
import { csrfGuard } from '@/lib/csrf'
import { inboxSession } from '@/lib/inbox/server-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { OFICIO_PLANTILLA } from '@/lib/templates/oficio'
import { isDealerDeployment } from '@/lib/dealers/config'
import { DEALER_TEMPLATE_WRITING } from '@/lib/dealers/template-prompt'
import { TEMPLATE_DRAFT_CONTEXT_POLICY, validateTemplateDraft, templateDraftPriceMismatch } from '@/lib/templates/draft-context'
import { loadTemplateDraftContext } from '@/lib/templates/draft-context-server'
import { redactModelSecrets } from '@/lib/security/model-secrets'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  brief: z.string().trim().min(1).max(2000),
  language: z.string().regex(/^[a-z]{2,3}(?:[_-][A-Za-z]{2,4})?$/).default('es'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('MARKETING'),
  tone: z.string().trim().max(300).optional(),
  product_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  use_business_context: z.boolean().optional(),
}).strict().refine(input => input.use_business_context !== false || !input.agent_id)
const headers = { 'Cache-Control': 'private, no-store' }
const SYSTEM_PROMPT = `Eres un redactor experto en cuerpos de plantillas de WhatsApp Business.
Devuelve SOLO el cuerpo, sin encabezado, pie, comillas, markdown ni explicaciones.
Máximo 1024 caracteres, con variables correlativas {{1}}, {{2}} empezando en {{1}}, sin saltos.
Escribe dos o tres bloques separados por una línea en blanco. No incluyas URLs ni teléfonos: van en botones.
Respeta el idioma y categoría solicitados. La categoría UTILITY no admite promociones.
${TEMPLATE_DRAFT_CONTEXT_POLICY}
${OFICIO_PLANTILLA}`

/** Draft only: no template creation, Meta submission, campaign or customer send. */
export async function POST(request: Request) {
  const csrf = await csrfGuard(request)
  if (csrf) return csrf
  const locale = await getLocale()
  const fail = (key: string, status: number) => NextResponse.json({ error: translate(locale, key) }, { status, headers })
  try {
    const ctx = await inboxSession()
    if (ctx.response) return ctx.response
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return fail('templates.aiInvalidBrief', 400)
    const input = parsed.data
    const limit = checkRateLimit(`template-ai:${ctx.userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)
    const context = await loadTemplateDraftContext(ctx.db, ctx.workspaceId, input)
    const key = await resolveAnthropicKey(ctx.db, { workspaceId: ctx.workspaceId })
    if (!key) return fail('errWhatsapp.aiNotConfigured', 503)
    const budget = await aiBudgetGuard(ctx.workspaceId, 'standard')
    if (budget) return budget
    const client = getAnthropic(key.key, {
      db: ctx.db, workspaceId: ctx.workspaceId, concepto: 'ia_asistencia',
      detalle: { superficie: 'panel', para: 'plantilla' }, origenDeLaClave: key.source,
    })
    const response = await client.messages.create({
      model: 'claude-sonnet-5-5', max_tokens: 1024, ...esfuerzo('claude-sonnet-5-5'),
      system: [{ type: 'text', text: isDealerDeployment() ? DEALER_TEMPLATE_WRITING : SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify({
        language: input.language, category: input.category, requested_tone: redactModelSecrets(input.tone ?? ''),
        brief: redactModelSecrets(input.brief), business_context: context.text,
      }) }],
    }, { signal: request.signal })
    if (response.stop_reason !== 'end_turn') return fail('templates.aiFailed', 502)
    const text = response.content.filter(block => block.type === 'text').map(block => block.type === 'text' ? block.text : '').join('').trim()
    const draft = validateTemplateDraft(redactModelSecrets(text))
    if (context.pricePolicy && templateDraftPriceMismatch(draft, context.pricePolicy)) return fail('templates.aiPriceMismatch', 502)
    const fresh = await inboxSession()
    if (fresh.response) return fresh.response
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) return fail('templates.aiContextChanged', 409)
    const current = await loadTemplateDraftContext(fresh.db, fresh.workspaceId, input)
    if (current.fingerprint !== context.fingerprint) return fail('templates.aiContextChanged', 409)
    return NextResponse.json({ success: true, body_text: draft, sources: current.sources }, { headers })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'template_draft_context_large') return fail('templates.aiContextTooLarge', 400)
    if (code === 'template_draft_context_invalid') return fail('templates.aiContextUnavailable', 404)
    if (code === 'template_draft_output_invalid') return fail('templates.aiFailed', 502)
    console.warn('[templates] contextual draft unavailable')
    return fail('errWhatsapp.generateMessageFailed', 500)
  }
}

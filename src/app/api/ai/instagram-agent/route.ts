import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic } from '@/lib/ai/anthropic-client'
import { createClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace'
import { loadBrandContext, brandBrief } from '@/lib/instagram-agent/brand-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * POST /api/ai/instagram-agent
 *
 * El "Agente de Instagram": el usuario describe un objetivo de marketing en
 * lenguaje natural (p. ej. "vende el inventario de la oferta de junio,
 * enfócate en las pulseras, ofrece hasta 10% si dudan por precio") y Claude
 * devuelve un PLAN de campaña 1:1 por Instagram listo para revisar y lanzar:
 * de qué engagement nace la audiencia, copy del DM, oferta, follow-up,
 * respuesta sugerida a comentarios de alta intención y un embudo estimado.
 *
 * Reproduce el flujo "give any marketing goal" de Blueberry: convertir la
 * interacción social (comentarios en posts/ads, respuestas a historias, DMs)
 * en ventas atribuibles. NO envía nada automáticamente — el usuario revisa el
 * plan y decide activarlo.
 */

const SYSTEM_PROMPT = `Eres un estratega de marketing conversacional para marcas B2C que venden por Instagram.
A partir de un OBJETIVO en lenguaje natural y del contexto del negocio (catálogo de productos y tamaño de la audiencia), diseñas un plan de campaña 1:1 por Instagram: detectas a las personas que interactúan (comentarios en posts y ads, respuestas a historias, DMs, likes) y las conviertes en ventas con DMs personalizados.

Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin markdown, sin comillas triples, sin texto antes o después) con esta forma exacta:
{
  "campaign_name": string,            // nombre corto y accionable de la campaña
  "audience": {
    "description": string,            // a quién contactar y por qué, en una frase
    "source": string,                 // de qué engagement de Instagram nace (p. ej. "comentarios en el último reel de la oferta + respuestas a historias")
    "estimated_reach": number         // nº de personas a alcanzar (<= total de contactos disponibles)
  },
  "message": {
    "text": string,                   // el primer DM de Instagram. Personalízalo y usa {{nombre}} donde vaya el nombre de la persona. Cálido, breve (<= 500 chars), suena a un DM real (emojis con moderación), con una llamada a la acción clara
    "preview_name": string            // un nombre de ejemplo para previsualizar (p. ej. "María")
  },
  "offer": {                          // o null si el objetivo no requiere descuento
    "code": string,                   // código de descuento sugerido en MAYÚSCULAS
    "discount": string,               // p. ej. "10%" o "envío gratis"
    "conditions": string              // condiciones en una frase
  } | null,
  "follow_up": string,                // DM de seguimiento si no responden en 24-48h
  "comment_reply": string,            // respuesta PÚBLICA breve a comentarios de alta intención (p. ej. "te escribí por DM 💙") para moverlos a la conversación privada
  "recommended_products": string[],   // títulos exactos del catálogo a destacar (máx 4); [] si no hay catálogo
  "funnel": {                         // estimación realista del embudo
    "contacted": number,
    "replies": number,                // ~25-45% de contacted
    "conversions": number,            // ~5-15% de contacted
    "est_revenue": string             // ingresos estimados con la moneda del catálogo, p. ej. "$1,200 USD"
  },
  "next_steps": string[]              // 2-4 pasos concretos para activar la campaña
}

Reglas:
- Responde en el MISMO idioma del objetivo (por defecto español).
- No inventes productos que no estén en el catálogo. Si el catálogo está vacío, deja recommended_products en [] y haz el copy genérico.
- estimated_reach y funnel.contacted NUNCA pueden superar las personas de Instagram alcanzables indicadas en el contexto.
- El DM debe sonar a Instagram, no a email ni a plantilla rígida.
- Sé concreto y realista; nada de relleno. Solo el JSON.`

interface ProductRow {
  title: string
  product_type: string | null
  vendor: string | null
  tags: string[] | null
  price_min: number | null
  price_max: number | null
  currency: string | null
}

/** Extrae el primer objeto JSON de la respuesta del modelo de forma tolerante. */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('La IA no devolvió un JSON válido.')
  }
  return JSON.parse(raw.slice(start, end + 1))
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
        { error: translate(locale, 'errAi.notAuthenticated') },
        { status: 401 },
      )
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.agentNotConfigured') },
        { status: 503 },
      )
    }

    const limit = checkRateLimit(`instagram-agent:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const goal: string = (body.goal ?? '').toString().trim()
    if (!goal) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.describeGoal') },
        { status: 400 },
      )
    }
    if (goal.length > 2000) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.goalTooLong') },
        { status: 400 },
      )
    }

    // Datos reales del workspace para aterrizar el plan. La RLS scope por
    // workspace_member, así que la consulta autenticada ya devuelve solo
    // lo del workspace del usuario.
    const workspaceId = await resolveWorkspaceId(supabase, user.id)
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [
      { data: products },
      { count: reachableCount },
      { count: inWindowCount },
      brand,
    ] = await Promise.all([
      supabase
        .from('shopify_products')
        .select(
          'title, product_type, vendor, tags, price_min, price_max, currency',
        )
        .order('title', { ascending: true })
        .limit(40),
      // Instagram-reachable audience only: contacts sourced from an IG DM or
      // comment WITH a usable IG id. A WhatsApp-first store has thousands of
      // contacts the IG agent can never DM — grounding the plan on the total
      // would inflate estimated_reach + the funnel wildly.
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .in('channel', ['instagram', 'ig_comment'])
        .not('external_id', 'is', null),
      // Of those, how many are inside Meta's 24h messaging window right now.
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .in('channel', ['instagram', 'ig_comment'])
        .not('external_id', 'is', null)
        .gt('updated_at', windowStart),
      workspaceId ? loadBrandContext(supabase, workspaceId) : Promise.resolve(null),
    ])
    const brief = brandBrief(brand)

    const igReachable = reachableCount ?? 0
    const inWindow = inWindowCount ?? 0
    const rows = (products ?? []) as ProductRow[]
    const currency = rows.find((p) => p.currency)?.currency ?? 'USD'

    const catalog = rows.length
      ? rows
          .slice(0, 25)
          .map((p) => {
            const price =
              p.price_min != null
                ? p.price_max != null && p.price_max !== p.price_min
                  ? `${p.price_min}-${p.price_max} ${p.currency ?? currency}`
                  : `${p.price_min} ${p.currency ?? currency}`
                : 's/precio'
            const meta = [p.product_type, p.vendor].filter(Boolean).join(' · ')
            return `- ${p.title} (${price})${meta ? ` — ${meta}` : ''}`
          })
          .join('\n')
      : '(catálogo vacío — no hay productos sincronizados)'

    const userPrompt = [
      `OBJETIVO DE LA CAMPAÑA:\n${goal}`,
      '',
      brief ? `VOZ Y CONOCIMIENTO DE LA MARCA (usa este tono y estos datos, no inventes nada fuera de aquí):\n${brief}\n` : '',
      `CONTEXTO DEL NEGOCIO:`,
      `- Canal: Instagram (DMs + comentarios)`,
      `- Personas de Instagram alcanzables (comentarios + DM, con id válido): ${igReachable}`,
      `- De ellas, dentro de la ventana de 24h de Meta ahora mismo: ${inWindow}`,
      `- Moneda del catálogo: ${currency}`,
      `- Catálogo de productos:\n${catalog}`,
      '',
      'Diseña el plan de campaña de Instagram en el JSON especificado.',
      brief
        ? 'El campo message.text es el DM BASE de referencia; al enviarse se reescribe 1:1 por persona en la voz de la marca, así que hazlo on-brand y natural.'
        : '',
    ]
      .filter(Boolean)
      .join('\n')

    const client = getAnthropic(apiKey)
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      // Tarea de planificación estructurada: sin thinking, esfuerzo medio.
      // El system prompt prohíbe texto fuera del JSON.
      thinking: { type: 'disabled' },
      output_config: { effort: 'medium' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!text) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.noPlanReturned') },
        { status: 502 },
      )
    }

    let plan: unknown
    try {
      plan = parseJson(text)
    } catch {
      return NextResponse.json(
        { error: translate(locale, 'errAi.planParseFailed') },
        { status: 502 },
      )
    }

    return NextResponse.json({
      success: true,
      plan,
      context: {
        instagram_reachable: igReachable,
        in_window_24h: inWindow,
        currency,
        has_catalog: rows.length > 0,
      },
    })
  } catch (error) {
    console.error('Error generating instagram-agent plan:', error)
    const message =
      error instanceof Anthropic.APIError
        ? translate(locale, 'errAi.claudeApiError', {
            status: error.status ?? '',
            message: error.message,
          })
        : error instanceof Error
          ? error.message
          : translate(locale, 'errAi.generatePlanFailed')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

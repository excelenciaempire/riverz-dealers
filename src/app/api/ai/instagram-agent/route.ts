import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { completeText, hasLlm } from '@/lib/ai/llm-client'
import { createClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace'
import { loadBrandContext, brandBrief } from '@/lib/instagram-agent/brand-context'
import { loadAudienceStats } from '@/lib/instagram-agent/audience-stats'
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
- Si el OBJETIVO es CRECER LA LISTA (suscriptores, email, SMS, captar datos): el DM debe invitar a la persona a dejar su email o teléfono a cambio de valor (imán de leads, acceso anticipado, guía, sorteo) con opt-in claro; "offer" puede ser null (no fuerces un descuento); y next_steps debe incluir sincronizar los contactos capturados a tu lista/Klaviyo.
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

    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? null
    if (!hasLlm(anthropicKey)) {
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
    const [{ data: products }, audience, brand] = await Promise.all([
      supabase
        .from('shopify_products')
        .select(
          'title, product_type, vendor, tags, price_min, price_max, currency',
        )
        .order('title', { ascending: true })
        .limit(40),
      // Alcance REAL: solo quien puede recibir un mensaje ahora (DM abierto o
      // comentario de los últimos 7 días). Aterrizar el plan en el histórico
      // completo inflaba estimated_reach y todo el embudo.
      loadAudienceStats(supabase),
      workspaceId ? loadBrandContext(supabase, workspaceId) : Promise.resolve(null),
    ])
    const brief = brandBrief(brand)

    const igReachable = audience.reachable_now
    const inWindow = audience.dm_window_24h
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
      `- Personas contactables AHORA (ventanas de Meta abiertas): ${igReachable}`,
      `- De ellas, con DM libre (ventana de 24h): ${inWindow}`,
      `- Comentaristas de los últimos 7 días (respuesta privada): ${audience.comment_window_7d}`,
      `- Histórico total de contactos de Instagram: ${audience.instagram_total}`,
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

    // Tarea de planificación estructurada: sin thinking, esfuerzo medio.
    // El system prompt prohíbe texto fuera del JSON. Anthropic es el cerebro
    // primario; si está sin créditos/caído, completeText cae a un proveedor de
    // respaldo (Groq/OpenRouter/Gemini) para no quedar mudo.
    let text: string
    try {
      text = (
        await completeText({
          tier: 'premium',
          system: SYSTEM_PROMPT,
          user: userPrompt,
          maxTokens: 2048,
          anthropicKey,
          effort: 'medium',
        })
      ).trim()
    } catch (err) {
      console.error('instagram-agent plan generation failed:', err)
      return NextResponse.json(
        { error: translate(locale, 'errAi.noPlanReturned') },
        { status: 502 },
      )
    }

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
        instagram_reachable: audience.instagram_total,
        reachable_now: igReachable,
        in_window_24h: inWindow,
        comment_window_7d: audience.comment_window_7d,
        currency,
        has_catalog: rows.length > 0,
        product_count: rows.length,
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

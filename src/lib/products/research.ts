/**
 * Product research pipeline — the pure, model-agnostic pieces.
 *
 * Extracted from the /api/products/[id]/ai-research route so the same
 * prompt-building + response-parsing can be (a) unit-tested with a canned
 * model response, and (b) reused by connect-time auto-enrichment. The route
 * still owns the actual model call + DB writes; this module just turns a
 * product into a prompt and a model reply into the product-field update.
 *
 * The generated content follows the merchant's locale (bilingual rule): an
 * English merchant gets English FAQs/research, not Spanish.
 */
import { buildTrainingMaterial } from './training-material'
import { aiLangLabel, aiLangDirective } from '@/lib/i18n/ai-language'
import type { Locale } from '@/lib/i18n/config'

/** The product columns the research prompt + training material read. */
export interface ResearchProduct {
  title?: string | null
  description?: string | null
  product_type?: string | null
  vendor?: string | null
  tags?: unknown
  custom_notes?: string | null
  custom_faqs?: unknown
  structured_research?: unknown
  say_guidelines?: string | null
  never_say?: unknown
  escalation_triggers?: unknown
  price_min?: unknown
  price_max?: unknown
  bundle_app?: string | null
}

/** The Anthropic model + budget the research pass uses. */
export const RESEARCH_MODEL = 'claude-sonnet-5-5'
export const RESEARCH_MAX_TOKENS = 2000

/** Concatenate what we know about a product for the prompt. */
export function buildProductContext(
  product: ResearchProduct,
  scrapedContent: string | null,
): string {
  return [
    `Título: ${product.title ?? ''}`,
    product.product_type ? `Tipo: ${product.product_type}` : null,
    product.vendor ? `Marca: ${product.vendor}` : null,
    Array.isArray(product.tags) && product.tags.length
      ? `Tags: ${(product.tags as string[]).join(', ')}`
      : null,
    product.description ? `\nDescripción del catálogo:\n${product.description}` : null,
    product.custom_notes ? `\nNotas del merchant:\n${product.custom_notes}` : null,
    scrapedContent
      ? `\nContenido de la página del producto:\n${scrapedContent.slice(0, 8000)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Build the exact research prompt (localized output language). */
export function buildResearchPrompt(
  product: ResearchProduct,
  scrapedContent: string | null,
  locale: Locale,
): string {
  const productContext = buildProductContext(product, scrapedContent)
  const outLang = aiLangLabel(locale)
  return `Eres un asistente de servicio al cliente experto en e-commerce. Necesito que generes material de soporte para que otro asistente pueda responder dudas de clientes sobre este producto en WhatsApp.

${aiLangDirective(locale)}

PRODUCTO:
${productContext}

Devuélveme un JSON con esta forma exacta (sin markdown, sin texto adicional):
{
  "description": "descripción de venta clara de 2 a 4 frases: qué es, para qué sirve y su beneficio principal, en ${outLang}.",
  "faqs": [
    {"q": "pregunta concisa que un cliente real haría", "a": "respuesta breve, máximo 3 líneas, en ${outLang}"},
    ...
  ],
  "research": "un párrafo de máximo 4 oraciones que un asistente de WhatsApp debería tener en mente al hablar de este producto: para quién es, cuándo se compra típicamente, qué diferencia tiene vs alternativas, qué objeciones suelen aparecer.",
  "differentiators": ["beneficio o diferenciador concreto y vendedor, en una línea", "..."],
  "objections": [
    {"objection": "duda u objeción real del cliente (ej: 'es caro')", "rebuttal": "cómo responderla, breve y honesto"},
    ...
  ],
  "say_guidelines": "1 a 2 líneas: qué conviene enfatizar al venderlo (lo más persuasivo y honesto).",
  "never_say": ["afirmación riesgosa que el asistente NUNCA debe hacer (promesas médicas, garantías absolutas, datos inventados)"],
  "escalation": ["tema que debe pasar a un humano (reembolsos, quejas serias, reacciones adversas)"]
}

Genera entre 5 y 10 FAQs. Cubre temas típicos del producto: ingredientes/componentes, modo de uso, tallas/medidas/variantes, compatibilidad, devoluciones específicas del producto, mantenimiento. Genera entre 3 y 6 "differentiators" (por qué comprarlo) y entre 3 y 5 "objections" con su respuesta. Para "never_say" da entre 0 y 4 ítems (si no aplica, []). Para "escalation" da entre 0 y 4 ítems. NO repitas la descripción literal en las FAQs. NO inventes datos: si no sabes un detalle, no lo incluyas.`
}

export interface ParsedResearch {
  /** The shopify_products column update to persist. */
  update: Record<string, unknown>
  /** How many FAQs were kept. */
  faqsCount: number
}

const toLines = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .slice(0, max)
    : []

/**
 * Parse a model reply (which may be wrapped in prose) into the product-field
 * update. Mirrors the ai-research route 1:1 so the route can delegate here.
 * Throws when no JSON object is present so the caller marks the run failed.
 */
export function parseResearchResponse(
  text: string,
  product: ResearchProduct,
  scrapedContent: string | null,
  locale: Locale,
): ParsedResearch {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Respuesta del modelo sin JSON parseable')
  const parsed = JSON.parse(match[0]) as {
    description?: unknown
    faqs?: Array<{ q: string; a: string }>
    research?: unknown
    differentiators?: unknown
    objections?: unknown
    say_guidelines?: unknown
    never_say?: unknown
    escalation?: unknown
  }

  const genDescription =
    typeof parsed.description === 'string' ? parsed.description.trim() : ''
  const genSayGuidelines =
    typeof parsed.say_guidelines === 'string' ? parsed.say_guidelines.trim() : ''
  const genNeverSay = toLines(parsed.never_say, 6)
  const genEscalation = toLines(parsed.escalation, 6)

  const faqs = Array.isArray(parsed.faqs)
    ? parsed.faqs
        .filter(
          (f) =>
            typeof f?.q === 'string' &&
            typeof f?.a === 'string' &&
            f.q.trim() &&
            f.a.trim(),
        )
        .slice(0, 12)
    : []
  const research = typeof parsed.research === 'string' ? parsed.research.trim() : ''

  const differentiators = Array.isArray(parsed.differentiators)
    ? parsed.differentiators
        .map((d) => (typeof d === 'string' ? d.trim() : ''))
        .filter(Boolean)
        .slice(0, 6)
    : []
  const objections = Array.isArray(parsed.objections)
    ? parsed.objections
        .map((o) =>
          o && typeof o === 'object'
            ? {
                objection: String((o as Record<string, unknown>).objection ?? '').trim(),
                rebuttal: String((o as Record<string, unknown>).rebuttal ?? '').trim(),
              }
            : null,
        )
        .filter((o): o is { objection: string; rebuttal: string } => !!o && !!o.objection)
        .slice(0, 5)
    : []
  const prevSR =
    product.structured_research && typeof product.structured_research === 'object'
      ? (product.structured_research as Record<string, unknown>)
      : {}
  const structured_research = { ...prevSR, differentiators, objections }

  const update: Record<string, unknown> = {
    ai_generated_faqs: faqs,
    ai_research: research,
    structured_research,
    ai_research_generated_at: new Date().toISOString(),
    ai_research_status: 'done',
    ai_research_error: null,
  }

  // Fill only the text fields the merchant left empty — don't overwrite what
  // they wrote. The AI arrays (faqs/differentiators/objections) always refresh.
  const curDesc = ((product.description as string | null) ?? '').trim()
  if (!curDesc && genDescription) update.description = genDescription
  const curSay = ((product.say_guidelines as string | null) ?? '').trim()
  if (!curSay && genSayGuidelines) update.say_guidelines = genSayGuidelines
  const curNever = Array.isArray(product.never_say) ? product.never_say : []
  if (curNever.length === 0 && genNeverSay.length) update.never_say = genNeverSay
  const curEsc = Array.isArray(product.escalation_triggers) ? product.escalation_triggers : []
  if (curEsc.length === 0 && genEscalation.length) update.escalation_triggers = genEscalation

  update.training_material = buildTrainingMaterial(
    {
      ...product,
      description: (update.description as string | undefined) ?? product.description,
      scraped_content: scrapedContent,
      ai_generated_faqs: faqs,
      ai_research: research,
    },
    locale === 'en' ? 'en' : 'es',
  )

  return { update, faqsCount: faqs.length }
}

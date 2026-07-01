import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { buildTrainingMaterial } from '@/lib/products/training-material';
import { firecrawlScrape } from '@/lib/firecrawl/client';
import { detectOffersFromScrapedContent } from '@/lib/shopify/offer-learning';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { aiLangLabel, aiLangDirective } from '@/lib/i18n/ai-language';

/**
 * POST /api/products/[id]/ai-research
 *
 * Genera FAQs + una breve nota de investigación sobre el producto
 * usando Anthropic. Input: título, descripción, scraped_content si
 * existe. Output: ai_generated_faqs (array {q, a}) + ai_research
 * (texto breve sobre uso típico, audiencia, comparativas).
 *
 * Idempotente — corre múltiples veces; sobreescribe los campos ai_*.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(req);
  if (block) return block;
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locale = await getLocale();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.anthropicKeyMissing') },
      { status: 500 },
    );
  }

  const { data: product, error } = await supabase
    .from('shopify_products')
    .select(
      'id, title, description, scraped_content, product_type, vendor, tags, custom_notes, custom_faqs, structured_research, price_min, price_max, bundle_app, bundle_metadata, allowed_offers, offers_auto_detected, say_guidelines, never_say, escalation_triggers, websites, url',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return serverError(error);
  }
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await supabase
    .from('shopify_products')
    .update({ ai_research_status: 'running', ai_research_error: null })
    .eq('id', id);

  // Si hay URLs y todavía no leímos su contenido, las scrapeamos ahora para
  // que alimenten la investigación — así "las URLs llenan todo" sin que el
  // merchant tenga que pulsar "Re-leer" antes. Best-effort: si Firecrawl
  // falla, seguimos con lo que haya. Si ya hay scraped_content, lo reusamos.
  let scrapedContent = (product.scraped_content as string | null) ?? null;
  if (!scrapedContent?.trim()) {
    const sites = [
      ...(Array.isArray(product.websites) ? (product.websites as unknown[]) : []),
      product.url,
    ]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);
    const valid = [...new Set(sites)].filter((u) => isPublicHttpsUrl(u)).slice(0, 5);
    if (valid.length) {
      const perUrl = Math.max(2_000, Math.floor(14_000 / valid.length));
      const chunks: string[] = [];
      for (const site of valid) {
        try {
          const s = await firecrawlScrape(site, { maxChars: perUrl });
          if (s.markdown.trim()) {
            chunks.push(valid.length > 1 ? `## ${site}\n\n${s.markdown}` : s.markdown);
          }
        } catch {
          /* una URL que falla no hunde el resto */
        }
      }
      if (chunks.length) {
        scrapedContent = chunks.join('\n\n---\n\n');
        await supabase
          .from('shopify_products')
          .update({
            scraped_content: scrapedContent,
            scrape_status: 'done',
            scraped_at: new Date().toISOString(),
          })
          .eq('id', id);
        // Same page we just read also carries the offer tiers — detect them
        // into allowed_offers so "the URLs fill everything" includes offers.
        await detectOffersFromScrapedContent(
          supabase,
          product,
          scrapedContent,
          locale === 'en' ? 'en' : 'es',
        );
      }
    }
  }

  // Construimos el prompt con todo el material que tenemos sobre el
  // producto. Pedimos JSON estructurado así parseamos directo.
  const productContext = [
    `Título: ${product.title}`,
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
    .join('\n');

  // El contenido generado (descripción, FAQs, research…) debe salir en el
  // idioma del merchant (su locale de UI), no siempre en español: un
  // merchant de habla inglesa debe recibir su material en inglés.
  const outLang = aiLangLabel(locale);

  const userPrompt = `Eres un asistente de servicio al cliente experto en e-commerce. Necesito que generes material de soporte para que otro asistente pueda responder dudas de clientes sobre este producto en WhatsApp.

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

Genera entre 5 y 10 FAQs. Cubre temas típicos del producto: ingredientes/componentes, modo de uso, tallas/medidas/variantes, compatibilidad, devoluciones específicas del producto, mantenimiento. Genera entre 3 y 6 "differentiators" (por qué comprarlo) y entre 3 y 5 "objections" con su respuesta. Para "never_say" da entre 0 y 4 ítems (si no aplica, []). Para "escalation" da entre 0 y 4 ítems. NO repitas la descripción literal en las FAQs. NO inventes datos: si no sabes un detalle, no lo incluyas.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `Anthropic ${res.status}`);
    }
    const text = json?.content?.[0]?.text ?? '';
    // Anthropic a veces envuelve el JSON entre prosa — buscamos el primer { ... }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Respuesta de Anthropic sin JSON parseable');
    }
    const parsed = JSON.parse(match[0]) as {
      description?: unknown;
      faqs?: Array<{ q: string; a: string }>;
      research?: string;
      differentiators?: unknown;
      objections?: unknown;
      say_guidelines?: unknown;
      never_say?: unknown;
      escalation?: unknown;
    };

    const toLines = (v: unknown, max: number): string[] =>
      Array.isArray(v)
        ? v
            .map((s) => (typeof s === 'string' ? s.trim() : ''))
            .filter(Boolean)
            .slice(0, max)
        : [];
    const genDescription =
      typeof parsed.description === 'string' ? parsed.description.trim() : '';
    const genSayGuidelines =
      typeof parsed.say_guidelines === 'string' ? parsed.say_guidelines.trim() : '';
    const genNeverSay = toLines(parsed.never_say, 6);
    const genEscalation = toLines(parsed.escalation, 6);

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
      : [];
    const research = typeof parsed.research === 'string' ? parsed.research.trim() : '';

    // Estructurado: alimenta los campos editables (Beneficios / Objeciones)
    // que el runner inyecta para el producto detectado. El merchant después
    // los revisa/edita. Merge con lo que ya hubiera para no pisar otras keys.
    const differentiators = Array.isArray(parsed.differentiators)
      ? parsed.differentiators
          .map((d) => (typeof d === 'string' ? d.trim() : ''))
          .filter(Boolean)
          .slice(0, 6)
      : [];
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
      : [];
    const prevSR =
      product.structured_research && typeof product.structured_research === 'object'
        ? (product.structured_research as Record<string, unknown>)
        : {};
    const structured_research = { ...prevSR, differentiators, objections };

    const update: Record<string, unknown> = {
      ai_generated_faqs: faqs,
      ai_research: research,
      structured_research,
      ai_research_generated_at: new Date().toISOString(),
      ai_research_status: 'done',
      ai_research_error: null,
    };

    // Rellenamos los campos de texto que el merchant deja vacíos —sin pisar
    // lo que ya haya escrito— para que "la investigación llene todo". Los
    // arrays AI (differentiators/objections/faqs) sí se refrescan siempre.
    const curDesc = ((product.description as string | null) ?? '').trim();
    if (!curDesc && genDescription) update.description = genDescription;
    const curSay = ((product.say_guidelines as string | null) ?? '').trim();
    if (!curSay && genSayGuidelines) update.say_guidelines = genSayGuidelines;
    const curNever = Array.isArray(product.never_say) ? product.never_say : [];
    if (curNever.length === 0 && genNeverSay.length) update.never_say = genNeverSay;
    const curEsc = Array.isArray(product.escalation_triggers)
      ? product.escalation_triggers
      : [];
    if (curEsc.length === 0 && genEscalation.length) update.escalation_triggers = genEscalation;

    // training_material con la descripción final (la generada si la rellenamos)
    // y el contenido scrapeado, para que el runner lo inyecte completo.
    update.training_material = buildTrainingMaterial(
      {
        ...product,
        description: (update.description as string | undefined) ?? product.description,
        scraped_content: scrapedContent,
        ai_generated_faqs: faqs,
        ai_research: research,
      },
      locale,
    );

    await supabase.from('shopify_products').update(update).eq('id', id);

    return NextResponse.json({ ok: true, faqs_count: faqs.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('shopify_products')
      .update({
        ai_research_status: 'failed',
        ai_research_error: msg,
      })
      .eq('id', id);
    // 502: fallo del proveedor de IA (upstream). El detalle ya quedó en
    // ai_research_error; al cliente, mensaje genérico no-filtrante.
    return serverError(err, translate(locale, 'errProducts.researchFailed'), 502);
  }
}

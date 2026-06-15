import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY no configurada en el servidor' },
      { status: 500 },
    );
  }

  const { data: product, error } = await supabase
    .from('shopify_products')
    .select('id, title, description, scraped_content, product_type, vendor, tags, custom_notes')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await supabase
    .from('shopify_products')
    .update({ ai_research_status: 'running', ai_research_error: null })
    .eq('id', id)
    .eq('user_id', user.id);

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
    product.scraped_content
      ? `\nContenido de la página del producto:\n${(product.scraped_content as string).slice(0, 8000)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const userPrompt = `Eres un asistente de servicio al cliente experto en e-commerce. Necesito que generes material de soporte para que otro asistente pueda responder dudas de clientes sobre este producto en WhatsApp.

PRODUCTO:
${productContext}

Devuélveme un JSON con esta forma exacta (sin markdown, sin texto adicional):
{
  "faqs": [
    {"q": "pregunta concisa que un cliente real haría", "a": "respuesta breve, máximo 3 líneas, en español neutro sin voseo"},
    ...
  ],
  "research": "un párrafo de máximo 4 oraciones que un asistente de WhatsApp debería tener en mente al hablar de este producto: para quién es, cuándo se compra típicamente, qué diferencia tiene vs alternativas, qué objeciones suelen aparecer."
}

Genera entre 5 y 10 FAQs. Cubre temas típicos del producto: ingredientes/componentes, modo de uso, tallas/medidas/variantes, compatibilidad, devoluciones específicas del producto, mantenimiento. NO repitas la descripción literal. NO inventes datos: si no sabes un detalle, no lo incluyas.`;

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
      faqs?: Array<{ q: string; a: string }>;
      research?: string;
    };

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

    await supabase
      .from('shopify_products')
      .update({
        ai_generated_faqs: faqs,
        ai_research: research,
        ai_research_generated_at: new Date().toISOString(),
        ai_research_status: 'done',
        ai_research_error: null,
      })
      .eq('id', id)
      .eq('user_id', user.id);

    return NextResponse.json({ ok: true, faqs_count: faqs.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('shopify_products')
      .update({
        ai_research_status: 'failed',
        ai_research_error: msg,
      })
      .eq('id', id)
      .eq('user_id', user.id);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

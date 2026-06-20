import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from '@/lib/ai/anthropic-client';

/**
 * AI-enriched contact segment — Blueberry's CRM card ("Segment: Engaged
 * Shopper" + a few definition bullets). Synthesized from how the person
 * engages (their comments/DMs) plus optional Shopify purchase context.
 */
export interface ContactSegment {
  label: string;
  traits: string[];
  computed_at: string;
  up_to_message_id?: string | null;
}

const SEG_SYSTEM = `Eres un analista de CRM para marcas B2C. A partir de los mensajes que una persona escribió a la marca (comentarios/DMs) y datos opcionales de compra, defines su SEGMENTO.

Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin markdown, sin texto extra):
{
  "label": "string — 2 a 4 palabras, ej. 'Compradora fiel de skincare' o 'Curiosa sensible al precio'",
  "traits": ["2 a 4 viñetas cortas, concretas y accionables, en español, sobre su comportamiento, intereses o intención de compra"]
}

Reglas: básate solo en la evidencia; si hay poca información sé conservador (label genérico, 2 traits). Nada de relleno.`;

function parseSegment(text: string): { label: string; traits: string[] } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as {
      label?: unknown;
      traits?: unknown;
    };
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 60) : '';
    const traits = Array.isArray(o.traits)
      ? o.traits.map((t) => String(t).trim()).filter(Boolean).slice(0, 4)
      : [];
    if (!label && traits.length === 0) return null;
    return { label: label || 'Cliente', traits };
  } catch {
    return null;
  }
}

/**
 * Generate a segment from the person's messages + optional purchase summary.
 * Uses Haiku (cheap, this runs per-contact on demand). Returns null on any
 * failure so the caller can degrade gracefully.
 */
export async function generateContactSegment(
  apiKey: string,
  input: { name?: string | null; messages: string[]; purchaseSummary?: string | null },
): Promise<{ label: string; traits: string[] } | null> {
  const msgs = input.messages
    .map((m) => m.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (msgs.length === 0 && !input.purchaseSummary) return null;

  const userPrompt = [
    input.name ? `Persona: ${input.name}` : '',
    input.purchaseSummary ? `Compras / datos: ${input.purchaseSummary}` : '',
    'Mensajes que escribió (más recientes primero):',
    ...msgs.map((m, i) => `${i + 1}. ${m.slice(0, 300)}`),
    '',
    'Define su segmento en el JSON especificado.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const client = getAnthropic(apiKey);
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SEG_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return parseSegment(text);
  } catch {
    return null;
  }
}

/** A cached segment is fresh enough to skip recompute for ~14 days. */
export function isSegmentFresh(seg: ContactSegment | null | undefined): boolean {
  if (!seg?.computed_at) return false;
  const age = Date.now() - new Date(seg.computed_at).getTime();
  return Number.isFinite(age) && age < 14 * 24 * 60 * 60 * 1000;
}

import { completeText, hasLlm } from '@/lib/ai/llm-client';
import { brandBrief, type BrandContext } from './brand-context';

/**
 * Replace the name token in a base message with the contact's first name
 * (or a neutral greeting). The simple, no-LLM personalization — also the
 * fallback when the model isn't available.
 */
export function personalize(template: string, name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] || 'hola';
  return template.replace(/\{\{\s*(nombre|name|1)\s*\}\}/gi, first);
}

const DM_SYSTEM = `Eres el redactor de DMs de Instagram de una marca B2C. Escribes UN solo DM dirigido a una persona concreta, que suena a un humano real escribiendo por Instagram, NO a una plantilla.

Reglas (estrictas):
- Máximo 480 caracteres.
- Responde de forma natural a la interacción que tuvo la persona (su comentario/historia/DM). Engánchate a lo que dijo.
- Usa la VOZ DE MARCA y el tono dados. Nunca suenes a chatbot ni admitas ser IA.
- Emojis con moderación (0 a 2).
- UNA sola llamada a la acción clara.
- Si hay un código de descuento, inclúyelo tal cual.
- No inventes productos, precios ni promesas que no estén en el contexto.
- NUNCA digas ni insinúes que revisaste su perfil, sus fotos o sus datos; suena a vigilancia. Usa cualquier pista solo para calibrar el tono, no la menciones.
- Adapta tono y oferta al SEGMENTO indicado (no todos reciben lo mismo).
- Devuelve SOLO el texto del DM: sin comillas, sin etiquetas, sin explicaciones.`;

export interface CraftDMInput {
  apiKey: string | null;
  /** plan.message.text — referencia de intención y tono. */
  base: string;
  brand: BrandContext | null;
  goal?: string | null;
  offer?: { code: string; discount: string } | null;
  products?: string[];
  name: string | null;
  /** Lo que la persona escribió (comentario/DM de origen). */
  engagement: string | null;
  /** Pista de interés no sensible derivada de su foto de perfil (o null). */
  personaHint?: string | null;
  /** Relación de audiencia propia: ¿ya te sigue? */
  followsBusiness?: boolean | null;
  /** ¿Cuenta verificada / figura pública? */
  isVerified?: boolean | null;
  /** Clase de público (tono + oferta por segmento). */
  segment?: { label: string; toneHint: string; offerHint: string } | null;
}

/**
 * Write a 1:1 Instagram DM for one person, grounded in the brand voice and
 * in what they actually said — this is the Blueberry-style personalization,
 * replacing the one-copy-with-{{nombre}} approach.
 *
 * Robust by design: with no API key, no signal to personalize on, or any
 * model error, it falls back to the plain name-merge so sending never breaks.
 */
export async function craftPersonalizedDM(input: CraftDMInput): Promise<string> {
  const fallback = () => {
    let t = personalize(input.base, input.name);
    // Make sure the discount code rides along even in the fallback.
    if (input.offer?.code && !t.toUpperCase().includes(input.offer.code.toUpperCase())) {
      t += `\n\n🎁 ${input.offer.code}${input.offer.discount ? ` — ${input.offer.discount}` : ''}`;
    }
    return t.trim();
  };

  const brief = brandBrief(input.brand);
  // Nothing to personalize on (no brand voice, no engagement, no persona hint)
  // → the LLM would add little over the name-merge; skip the call and the cost.
  // Also skip when no provider at all is configured (Anthropic or a fallback).
  if (
    !hasLlm(input.apiKey) ||
    (!brief && !input.engagement && !input.personaHint)
  )
    return fallback();

  const first = (input.name ?? '').trim().split(/\s+/)[0] || null;
  const userPrompt = [
    brief,
    input.goal ? `OBJETIVO DE LA CAMPAÑA:\n${input.goal}` : '',
    `MENSAJE BASE (referencia de intención y tono, NO lo copies literal):\n${input.base}`,
    input.products?.length ? `PRODUCTOS A DESTACAR: ${input.products.join(', ')}` : '',
    input.offer?.code
      ? `OFERTA: código ${input.offer.code}${input.offer.discount ? ` (${input.offer.discount})` : ''}`
      : 'OFERTA: ninguna',
    input.segment
      ? `SEGMENTO: ${input.segment.label} → tono: ${input.segment.toneHint}; oferta: ${input.segment.offerHint}`
      : '',
    'PERSONA:',
    `- Nombre: ${first ?? '(desconocido)'}`,
    input.followsBusiness != null
      ? `- Relación: ${input.followsBusiness ? 'ya te sigue' : 'aún no te sigue'}`
      : '',
    input.isVerified ? '- Cuenta verificada / figura pública' : '',
    `- Su interacción reciente (respóndele a esto de forma personal): ${
      input.engagement ? `"${input.engagement.slice(0, 400).replace(/\s+/g, ' ').trim()}"` : '(sin texto, sé cálido y genérico)'
    }`,
    input.personaHint
      ? `- Pista de perfil (SOLO para calibrar el tono; NO afirmes hechos sobre su vida ni digas que viste su perfil): ${input.personaHint}`
      : '',
    '',
    'Escribe el DM para ESTA persona.',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    let text = await completeText({
      tier: 'triage',
      system: DM_SYSTEM,
      user: userPrompt,
      maxTokens: 400,
      anthropicKey: input.apiKey,
      effort: 'low',
    });
    // Strip wrapping quotes the model sometimes adds, and any stray token.
    text = text.replace(/^["'“”]|["'“”]$/g, '').trim();
    text = personalize(text, input.name); // resolve any {{nombre}} it echoed
    if (!text) return fallback();
    // IG DM hard limit is 1000 chars; keep margin.
    return text.slice(0, 950);
  } catch {
    return fallback();
  }
}

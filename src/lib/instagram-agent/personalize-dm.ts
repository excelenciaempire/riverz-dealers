import { completeText, hasLlm } from '@/lib/ai/llm-client';
import { ESTILO_HUMANO, humanizarTexto } from '@/lib/ai/estilo-humano';
import { brandBrief, type BrandContext } from './brand-context';
import { linksBrief, type StoreLinks } from './store-links';
import { enforceKnownUrls } from '@/lib/ai/url-integrity';

/**
 * Replace the name token in a base message with the contact's first name
 * (or a neutral greeting). The simple, no-LLM personalization — also the
 * fallback when the model isn't available.
 */
export function personalize(template: string, name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] || 'hola';
  return template.replace(/\{\{\s*(nombre|name|1)\s*\}\}/gi, first);
}

const DM_SYSTEM = `Eres el redactor de DMs de Instagram de una marca B2C. Escribes UN solo DM a una persona concreta.

Lo primero: NO estás vendiendo en frío, estás INICIANDO UNA CONVERSACIÓN. Escribe como le escribirías a alguien que te cae bien: primero la persona, después (y solo si encaja) la marca. Un DM que abre vendiendo se ignora; uno que abre por algo suyo, se responde.

Reglas (estrictas):
- Máximo 480 caracteres.
- SI HAY HILO: no es el primer mensaje. Continúa la conversación donde quedó, sin saludar de cero ni repetir lo que ya dijiste.
- ABRE por algo de ELLA: lo que comentó, o el GANCHO de su perfil si te lo damos ("acaba de volver de la playa" → "¿qué tal la playa?"). Natural, como quien comenta entre conocidos.
- Nunca digas de dónde sacaste el gancho, ni "vi tu perfil/tus fotos/tus posts". Se menciona como se menciona algo que uno vio pasar, sin explicarlo.
- El gancho es una suposición, no un hecho: pregunta ("¿te fuiste de viaje?"), no afirmes ("como estuviste en Cancún…"). Si no encaja con naturalidad, ignóralo y abre por lo que dijo.
- La marca entra DESPUÉS del gancho, en una sola frase, y solo si viene a cuento. Si no viene a cuento, cierra con una pregunta y ya: la venta es la siguiente conversación, no esta.
- Responde de forma natural a la interacción que tuvo la persona (su comentario/historia/DM). Engánchate a lo que dijo.
- Usa la VOZ DE MARCA y el tono dados. Nunca suenes a chatbot ni admitas ser IA.
- Emojis con moderación (0 a 2).
- UNA sola llamada a la acción clara.
- Si hay un código de descuento, inclúyelo tal cual.
- No inventes productos, precios ni promesas que no estén en el contexto. Si te damos el PRODUCTO DEL QUE HABLA, sus datos y sus barreras mandan sobre todo lo demás: no contradigas su "NUNCA afirmes" ni ofrezcas precios u ofertas fuera de las suyas.
- DATOS QUE NO TIENES: si preguntan por registros o aprobaciones sanitarias (ANMAT, INVIMA, FDA…), contraindicaciones, ingredientes, plazos de envío o garantías que NO estén literalmente en el contexto, NO lo afirmes ni lo niegues. Di que lo confirmas y ofrece la respuesta por aquí. Inventar un dato regulatorio o de salud es la peor falta posible.
- ENLACES: si compartes un link, copia EXACTAMENTE uno de los ENLACES REALES del contexto. Está PROHIBIDO escribir marcadores como "[enlace]", "[link de la tienda]", "(link aquí)" o URLs inventadas. Si no hay ningún enlace en el contexto, no menciones ninguno: invita a responder por aquí y listo.
- SI YA ES CLIENTA: no le vendas como si no te conociera. Pregúntale cómo le fue con lo que se llevó y, si encaja, sugiere lo que va después. Nunca le ofrezcas de nuevo lo que ya tiene.
- SI TE PREGUNTA POR UN PEDIDO SUYO (dónde está, cuándo llega, un cambio): eso NO es una venta. Responde que lo revisas y sigue por aquí; no metas oferta ni producto.
- SUS INTERESES sí puedes usarlos, y deberías: son lo que hace que el mensaje suene a alguien que la conoce y no a un envío masivo. Úsalos como los usa un amigo, para conectar con lo que le gusta, de pasada y en una frase, nunca listándolos ni describiéndoselos ("veo que te gusta el gym, viajar y cocinar" es exactamente lo que NO se hace).
- Lo que NUNCA se cita: datos suyos (seguidores, si te sigue, ubicación), ni nada que delate que se miró su perfil.
- Adapta tono y oferta al SEGMENTO indicado (no todos reciben lo mismo).
- Devuelve SOLO el texto del DM: sin comillas, sin etiquetas, sin explicaciones.
- ${ESTILO_HUMANO}`;

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
  /** Gancho concreto y reciente de su perfil público con el que ABRIR. */
  openerHint?: string | null;
  /** Relación de audiencia propia: ¿ya te sigue? */
  followsBusiness?: boolean | null;
  /** ¿Cuenta verificada / figura pública? */
  isVerified?: boolean | null;
  /** Clase de público (tono + oferta por segmento). */
  segment?: { label: string; toneHint: string; offerHint: string } | null;
  /** Enlaces reales de la tienda (evita los "[enlace de la tienda]"). */
  links?: StoreLinks | null;
  /** Qué sabemos de ella como clienta (ya compró, qué se llevó). */
  customer?: string | null;
  /** Lo que ya se dijeron en este hilo de comentarios. */
  thread?: string | null;
  /** El cerebro del producto del que habla: conocimiento + sus barreras. */
  product?: string | null;
}

/**
 * Menciones de un código de descuento: "código CARG15", "cupón ABC10", o el
 * código suelto en mayúsculas. El grupo 2 es el código.
 */
const CODE_MENTION =
  /(c[óo]digo|cup[óo]n|promo)\b([^.!?\n]{0,40}?)\b([A-Z][A-Z0-9]{3,15})\b/g;

/**
 * Ninguna oferta que el comercio no haya creado.
 *
 * Los modelos de respaldo (los que entran cuando Anthropic no responde) se
 * inventan códigos con el nombre de la persona — "tengo un código para ti:
 * CARG15" — y ese código no existe: el cliente lo intenta, falla, y la marca
 * queda mal. Si la campaña no tiene oferta, la mención se elimina; si la tiene,
 * cualquier código distinto se reemplaza por el real.
 */
export function enforceOffer(
  text: string,
  offer: { code: string; discount: string } | null | undefined,
): string {
  CODE_MENTION.lastIndex = 0;
  if (!CODE_MENTION.test(text)) return text;
  CODE_MENTION.lastIndex = 0;

  if (offer?.code) {
    return text.replace(
      CODE_MENTION,
      (_m, label: string, middle: string) => `${label}${middle}${offer.code}`,
    );
  }
  // Sin oferta: fuera la frase entera que la menciona.
  return text
    .split(/(?<=[.!?¡¿\n])\s+/)
    .filter((sentence) => {
      CODE_MENTION.lastIndex = 0;
      return !CODE_MENTION.test(sentence);
    })
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Marcador de enlace: "[enlace de la tienda]", "(link aquí)", "[url]"… */
const LINK_PLACEHOLDER =
  /[[(]\s*(?:el\s+|tu\s+|su\s+)?(?:enlace|link|url|sitio|tienda)\b[^\])]*[\])]/gi;

/**
 * Última red: si el modelo igual dejó un marcador de enlace, lo cambiamos por
 * el enlace real; si no hay ninguno, lo quitamos y la frase queda limpia en vez
 * de llegarle al cliente un "[enlace de la tienda web]".
 */
export function stripLinkPlaceholders(
  text: string,
  links: StoreLinks | null,
): string {
  const real = links?.products[0]?.url ?? links?.storeUrl ?? null;
  if (!LINK_PLACEHOLDER.test(text)) {
    LINK_PLACEHOLDER.lastIndex = 0;
    return text;
  }
  LINK_PLACEHOLDER.lastIndex = 0;
  const replaced = real
    ? text.replace(LINK_PLACEHOLDER, real)
    : text
        .replace(LINK_PLACEHOLDER, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,!?])/g, '$1');
  return replaced.trim();
}

/** Sólo deja los enlaces que Riverz cargó desde la tienda o su catálogo. */
export function enforceKnownStoreLinks(
  text: string,
  links: StoreLinks | null,
): string {
  return enforceKnownUrls(text, [
    ...(links?.products.map((product) => product.url) ?? []),
    ...(links?.storeUrl ? [links.storeUrl] : []),
  ]);
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
      t += `\n\n🎁 ${input.offer.code}${input.offer.discount ? `, ${input.offer.discount}` : ''}`;
    }
    return enforceKnownStoreLinks(t.trim(), input.links ?? null);
  };

  const brief = brandBrief(input.brand);
  // Nothing to personalize on (no brand voice, no engagement, no persona hint)
  // → the LLM would add little over the name-merge; skip the call and the cost.
  // Also skip when no provider at all is configured (Anthropic or a fallback).
  if (
    !hasLlm(input.apiKey) ||
    (!brief && !input.engagement && !input.personaHint && !input.openerHint)
  )
    return fallback();

  const first = (input.name ?? '').trim().split(/\s+/)[0] || null;
  const userPrompt = [
    brief,
    input.goal ? `OBJETIVO DE LA CAMPAÑA:\n${input.goal}` : '',
    `MENSAJE BASE (referencia de intención y tono, NO lo copies literal):\n${input.base}`,
    input.products?.length ? `PRODUCTOS A DESTACAR: ${input.products.join(', ')}` : '',
    linksBrief(input.links ?? null),
    input.customer ?? '',
    input.thread ?? '',
    input.product ?? '',
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
    input.openerHint
      ? `- GANCHO PARA ABRIR (algo suyo, público y reciente): ${input.openerHint}. Ábrele por aquí de forma natural y en tono de pregunta; si no encaja, ignóralo.`
      : '',
    input.personaHint
      ? `- Le interesa: ${input.personaHint}. Puedes conectar con esto de pasada, como lo haría un amigo; nunca lo enumeres ni se lo describas.`
      : '',
    '',
    'Escribe el DM para ESTA persona.',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    let text = await completeText({
      // Este mensaje ES el producto y va a un cliente real con el nombre de la
      // marca encima: el modelo de triage se inventaba códigos y datos. Vale el
      // costo del modelo bueno.
      tier: 'premium',
      system: DM_SYSTEM,
      user: userPrompt,
      maxTokens: 400,
      anthropicKey: input.apiKey,
      effort: 'low',
    });
    // Strip wrapping quotes the model sometimes adds, and any stray token.
    text = humanizarTexto(text.replace(/^["'“”]|["'“”]$/g, ''));
    text = personalize(text, input.name); // resolve any {{nombre}} it echoed
    text = stripLinkPlaceholders(text, input.links ?? null);
    text = enforceKnownStoreLinks(text, input.links ?? null);
    text = enforceOffer(text, input.offer ?? null);
    if (!text) return fallback();
    // IG DM hard limit is 1000 chars; keep margin.
    return text.slice(0, 950);
  } catch {
    return fallback();
  }
}

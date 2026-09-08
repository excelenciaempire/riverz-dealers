import { completeText, hasLlm } from '@/lib/ai/llm-client';
import type { BillingContext } from '@/lib/wallet/operacion';

/**
 * ¿Este comentario merece además un DM?
 *
 * Contestar en público es barato y no molesta a nadie; abrir el privado sí:
 * consume la ÚNICA respuesta privada que Meta permite por comentario, gasta
 * tope diario y, si no había nada que vender ni que resolver, se lee como un
 * bot persiguiendo gente. Por eso el modo `public_smart` contesta siempre en el
 * post y sólo abre el DM cuando hay una razón concreta:
 *
 *   compra   — quiere comprar, pregunta precio/talla/stock/envío.
 *   pedido   — pregunta por un pedido suyo (datos personales: van en privado).
 *   reclamo  — algo salió mal; en público escala, en privado se resuelve.
 *   privado  — la respuesta lleva precio, código de descuento o un enlace de
 *              compra, que no conviene publicar bajo la foto.
 *   ninguna  — halago, emoji, curiosidad general: se contesta y ya está.
 *
 * Decide el modelo de triage (rápido y barato). Si no hay modelo o falla, manda
 * la heurística de abajo, que es pura y testeable: nunca se deja de contestar
 * por culpa de esta decisión.
 */

export type DmReason = 'compra' | 'pedido' | 'reclamo' | 'privado' | 'ninguna';

export interface DmDecision {
  dm: boolean;
  reason: DmReason;
}

/** Lo que el comercio eligió en Comentarios (migración 177). */
export type CommentReplyMode = 'dm' | 'public_dm' | 'public_smart' | 'public';

const VALID_REASONS: DmReason[] = [
  'compra',
  'pedido',
  'reclamo',
  'privado',
  'ninguna',
];

/* ── Heurística (sin modelo) ─────────────────────────────────────────────── */

const BUY_WORDS = [
  'precio',
  'cuanto',
  'cuánto',
  'vale',
  'cuesta',
  'comprar',
  'compro',
  'quiero',
  'lo llevo',
  'stock',
  'talla',
  'talle',
  'color',
  'envio',
  'envío',
  'envian',
  'envían',
  'pagar',
  'pago',
  'cuotas',
  'descuento',
  'cupon',
  'cupón',
  'link',
  'enlace',
  'donde consigo',
  'dónde consigo',
  'disponible',
  'price',
  'how much',
  'cost',
  'buy',
  'order it',
  'want it',
  'in stock',
  'size',
  'shipping',
  'ship to',
  'discount',
  'coupon',
  'available',
  'checkout',
];

const ORDER_WORDS = [
  'mi pedido',
  'mi orden',
  'mi compra',
  'no me llego',
  'no me llegó',
  'no llego',
  'no ha llegado',
  'seguimiento',
  'rastreo',
  'guia',
  'guía',
  'my order',
  'my package',
  'tracking',
  "hasn't arrived",
  'not arrived',
  'where is my',
];

const COMPLAINT_WORDS = [
  'reclamo',
  'queja',
  'estafa',
  'devolucion',
  'devolución',
  'reembolso',
  'roto',
  'defectuoso',
  'malo',
  'pesimo',
  'pésimo',
  'no funciona',
  'error',
  'refund',
  'broken',
  'damaged',
  'scam',
  'complaint',
  'terrible',
];

/** Un código de descuento tipo VERANO20 / RIVERZ10 dentro de la respuesta. */
const CODE_RE = /\b[A-Z][A-Z0-9]{3,15}\d{1,3}\b/;
const URL_RE = /https?:\/\/\S+/i;
const PRICE_RE = /(\$|€|usd|cop|ars|mxn|eur)\s?\d/i;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

/**
 * La decisión sin modelo. También es el suelo cuando el modelo dice que no:
 * un "cuánto cuesta" jamás se queda sin privado por una respuesta rara del
 * clasificador.
 */
export function heuristicDmDecision(
  comment: string,
  reply: string
): DmDecision {
  const c = norm(comment);
  if (hasAny(c, ORDER_WORDS)) return { dm: true, reason: 'pedido' };
  if (hasAny(c, COMPLAINT_WORDS)) return { dm: true, reason: 'reclamo' };
  if (hasAny(c, BUY_WORDS)) return { dm: true, reason: 'compra' };
  // La respuesta que lleva precio, enlace de compra o código no se publica
  // bajo la foto: eso va al privado.
  if (URL_RE.test(reply) || PRICE_RE.test(reply) || CODE_RE.test(reply)) {
    return { dm: true, reason: 'privado' };
  }
  return { dm: false, reason: 'ninguna' };
}

/* ── Clasificador ────────────────────────────────────────────────────────── */

const SYSTEM = `Decides si un comentario de Instagram/Facebook merece además un mensaje privado (DM) de la marca, o si alcanza con la respuesta pública.

Responde EXCLUSIVAMENTE un objeto JSON, sin markdown:
{"dm": true|false, "reason": "compra"|"pedido"|"reclamo"|"privado"|"ninguna"}

dm=true cuando:
- compra: quiere comprar o pregunta precio, talla, stock, envío, formas de pago.
- pedido: pregunta por un pedido suyo (datos personales).
- reclamo: se queja, algo salió mal, pide devolución.
- privado: la respuesta que vamos a dar lleva precio, enlace de compra o código de descuento.

dm=false (reason "ninguna") cuando es un halago, un emoji, una etiqueta a un amigo, una curiosidad general o cualquier cosa que la respuesta pública ya resuelve. Ante la duda, false: el DM privado se usa una sola vez por comentario.
Solo el JSON.`;

export function parseDmDecision(text: string): DmDecision | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.dm !== 'boolean') return null;
  const reason = VALID_REASONS.includes(o.reason as DmReason)
    ? (o.reason as DmReason)
    : o.dm
      ? 'compra'
      : 'ninguna';
  return { dm: o.dm, reason };
}

/**
 * La decisión final para un comentario, ya con el modo del comercio aplicado.
 *
 * `public_smart` es el único que pregunta: los otros tres modos ya son una
 * respuesta y no gastan una llamada al modelo.
 */
export async function decideCommentDm(input: {
  billing?: BillingContext;
  mode: CommentReplyMode;
  apiKey: string | null;
  comment: string;
  /** La respuesta que la IA ya redactó: si lleva precio o enlace, va privado. */
  reply: string;
  /** El contacto pregunta por un pedido real (ya resuelto contra la tienda). */
  hasOrderQuestion?: boolean;
}): Promise<DmDecision> {
  if (input.mode === 'dm' || input.mode === 'public_dm') {
    return { dm: true, reason: 'compra' };
  }
  if (input.mode === 'public') return { dm: false, reason: 'ninguna' };

  // Una duda sobre un pedido lleva datos personales: no se discute en público
  // ni se le pregunta al modelo.
  if (input.hasOrderQuestion) return { dm: true, reason: 'pedido' };

  const floor = heuristicDmDecision(input.comment, input.reply);
  if (floor.dm) return floor;
  if (!hasLlm(input.apiKey)) return floor;

  try {
    const out = await completeText({
      billing: input.billing!,
      tier: 'triage',
      system: SYSTEM,
      user: [
        `COMENTARIO: ${input.comment.slice(0, 400).replace(/\s+/g, ' ')}`,
        `RESPUESTA QUE VAMOS A DAR: ${input.reply.slice(0, 400).replace(/\s+/g, ' ')}`,
      ].join('\n'),
      maxTokens: 100,
      anthropicKey: input.apiKey,
      effort: 'low',
    });
    return parseDmDecision(out) ?? floor;
  } catch {
    return floor;
  }
}

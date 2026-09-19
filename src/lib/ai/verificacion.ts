import type { SupabaseClient } from '@supabase/supabase-js';
import { hayJev, preguntarJev, type Pregunta, type RespuestaNoul } from './jev';

/**
 * LA RESPUESTA SE REVISA ANTES DE SALIR.
 *
 * El comercio le dice al asistente qué no puede afirmar de cada producto
 * (`never_say`: "elimina arrugas permanentemente", "reemplaza un tratamiento
 * médico") y qué ofertas existen (`allowed_offers`). Eso viaja en el prompt, y
 * el modelo lo respeta casi siempre. Casi: el 2026-09-17 una FAQ que decía
 * "es este mismo número" hizo que la asesora diera el teléfono DEL CLIENTE como
 * contacto del comercio. Un prompt es una petición; esto es un control.
 *
 * Cómo: con la respuesta ya escrita, se le pregunta a Jev, una por una, si
 * afirma alguna de las cosas prohibidas o si ofrece algo que no está en la
 * lista de ofertas. Son preguntas literales sobre un texto corto, que es lo
 * que Jev hace bien. Si algo da que sí con claridad, el runner pide una
 * reescritura sin eso; si la reescritura sigue mal, la respuesta no sale y la
 * conversación pasa a una persona, igual que cuando un precio no cierra.
 *
 * Sin Jev (sin llave, caído) no se verifica y la respuesta sale como salía
 * siempre: esto suma un control, nunca quita una respuesta por su cuenta.
 */

export interface ReglasDeSalida {
  /** Lo que el asistente no puede afirmar ni prometer, tal como lo escribió el comercio. */
  prohibido: string[];
  /** Las ofertas y precios válidos, en texto, si el comercio los cargó. */
  ofertas: string[];
}

/** Con más que esto la pregunta se vuelve un listado y el estado, ruido. */
const MAX_PROHIBIDO = 12;

/**
 * Por encima de esto una prohibición se da por violada. Alto a propósito: una
 * respuesta buena frenada por un control es peor que una dudosa que sale, y
 * el prompt ya hizo la mayor parte del trabajo.
 */
const UMBRAL = 0.85;

/** Las preguntas: un sí/no por prohibición y uno por las ofertas. */
export function preguntasDeVerificacion(reglas: ReglasDeSalida): Record<string, Pregunta> {
  const q: Record<string, Pregunta> = {};
  reglas.prohibido.slice(0, MAX_PROHIBIDO).forEach((_, i) => {
    q[`prohibido_${i}`] = {
      type: 'noul',
      instructions: {
        question: `¿\`respuesta\` afirma, promete o da a entender lo que dice \`prohibido[${i}]\`?`,
        inspect: ['`respuesta`', `\`prohibido[${i}]\``],
        focus:
          'Solo cuenta lo que la respuesta AFIRMA. Negarlo, aclararlo, decir que no lo hace o que no se puede prometer, NO cuenta.',
      },
      criteria: {
        true: 'La respuesta lo afirma o lo promete como si fuera cierto, con esas palabras o con otras que dicen lo mismo.',
        false: 'La respuesta no lo menciona, lo niega, lo relativiza, o dice que no puede prometerlo.',
      },
    };
  });
  if (reglas.ofertas.length) {
    // Sólo PROMOCIONES. Los precios de lista ya los controla `price_integrity`
    // contra todo el catálogo; acá una respuesta que cotiza otro producto de la
    // tienda daba "oferta no autorizada" porque ese precio no estaba en la
    // lista de ESTE producto (visto en la validación del 2026-09-19).
    q.oferta_no_autorizada = {
      type: 'noul',
      instructions: {
        question:
          '¿`respuesta` ofrece un descuento, una promoción, un regalo, envío gratis, cuotas o una condición de pago especial que NO está en `ofertas_validas`?',
        inspect: ['`respuesta`', '`ofertas_validas`'],
        focus:
          'Compara cada promoción que la respuesta ofrece con la lista. Lo que está en la lista, aunque esté dicho con otras palabras, es válido. Decir el precio normal de un producto NO es una oferta.',
      },
      criteria: {
        true: 'Ofrece un descuento, un 2x1, un regalo, envío gratis, cuotas sin interés o un precio rebajado que no figura en la lista.',
        false: 'Solo ofrece promociones de la lista, o no ofrece ninguna promoción (cotizar el precio normal de un producto no cuenta).',
      },
    };
  }
  return q;
}

export interface Veredicto {
  ok: boolean;
  /** Las reglas que la respuesta rompe, en las palabras del comercio. */
  motivos: string[];
  /** La probabilidad más alta entre las preguntas. Para el registro. */
  maximo: number;
}

/** Pura: de las respuestas de Jev al veredicto, con el umbral de arriba. */
export function veredictoDesde(
  answers: Record<string, RespuestaNoul | undefined>,
  reglas: ReglasDeSalida,
  umbral = UMBRAL
): Veredicto {
  const motivos: string[] = [];
  let maximo = 0;
  reglas.prohibido.slice(0, MAX_PROHIBIDO).forEach((texto, i) => {
    const p = answers[`prohibido_${i}`]?.noul ?? 0;
    maximo = Math.max(maximo, p);
    if (p >= umbral) motivos.push(texto);
  });
  const oferta = answers.oferta_no_autorizada?.noul ?? 0;
  maximo = Math.max(maximo, oferta);
  if (reglas.ofertas.length && oferta >= umbral) {
    motivos.push(`una promoción que no está entre las válidas (${reglas.ofertas.join(' · ')})`);
  }
  return { ok: motivos.length === 0, motivos, maximo };
}

/** ¿Hay algo contra qué verificar? Sin reglas no se gasta una llamada. */
export function hayReglasDeSalida(reglas: ReglasDeSalida): boolean {
  return reglas.prohibido.length > 0 || reglas.ofertas.length > 0;
}

/**
 * La verificación. `null` = no se pudo verificar (sin Jev, sin saldo, caído):
 * la respuesta sale como siempre. Nunca lanza.
 */
export async function verificarRespuesta(args: {
  db: SupabaseClient;
  workspaceId: string;
  respuesta: string;
  /** Lo último que dijo la persona: para que "no, no cura" se lea como negación. */
  ultimoMensaje: string | null;
  reglas: ReglasDeSalida;
  detalle?: Record<string, unknown>;
}): Promise<Veredicto | null> {
  if (!hayJev() || !hayReglasDeSalida(args.reglas)) return null;
  const reglas: ReglasDeSalida = {
    prohibido: args.reglas.prohibido.slice(0, MAX_PROHIBIDO),
    ofertas: args.reglas.ofertas,
  };
  try {
    const resultado = await preguntarJev({
      db: args.db,
      workspaceId: args.workspaceId,
      concepto: 'ia_clasificacion',
      detalle: { ...args.detalle, para: 'verificar_respuesta' },
      state: {
        respuesta: args.respuesta.slice(0, 2000),
        ultimo_mensaje_del_cliente: (args.ultimoMensaje ?? '').slice(0, 400) || null,
        prohibido: reglas.prohibido,
        ...(reglas.ofertas.length ? { ofertas_validas: reglas.ofertas } : {}),
      },
      questions: preguntasDeVerificacion(reglas),
    });
    if (!resultado) return null;
    return veredictoDesde(resultado.answers as Record<string, RespuestaNoul>, reglas);
  } catch {
    return null;
  }
}

/**
 * Las reglas de salida de este turno, sacadas de lo mismo que fue al prompt:
 * el producto detectado y los primeros del catálogo (los "featured" de
 * `buildSystemPrompt`), más las reglas de la casa que el comercio marcó como
 * "lo que nunca decimos". Verificar contra reglas que el modelo no vio sería
 * frenarlo por algo que nadie le pidió.
 */
export function reglasDeSalidaPara(
  products: Array<{ id?: string; never_say?: unknown; allowed_offers?: unknown }>,
  matchId: string | null,
  reglasDeLaCasa: Array<{ clave?: string | null; hacer: string }>
): ReglasDeSalida {
  const featured: typeof products = [];
  const match = matchId ? products.find((p) => p.id && p.id === matchId) : null;
  if (match) featured.push(match);
  for (const p of products) {
    if (featured.length >= 3) break;
    if (!featured.some((f) => f.id === p.id)) featured.push(p);
  }
  const prohibido = new Set<string>();
  const ofertas = new Set<string>();
  for (const p of featured) {
    for (const s of comoTextos(p.never_say)) prohibido.add(s);
    for (const o of ofertasComoTexto(p.allowed_offers)) ofertas.add(o);
  }
  for (const r of reglasDeLaCasa) {
    if (r.clave !== 'nunca') continue;
    // `sembrarReglasDelPliego` las guarda como "Nunca digas ni prometas esto: X".
    const texto = r.hacer.replace(/^nunca digas ni prometas esto:\s*/i, '').trim();
    if (texto) prohibido.add(texto);
  }
  return { prohibido: [...prohibido], ofertas: [...ofertas] };
}

function comoTextos(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** Mismo formato que la línea de ofertas del prompt (`pinnedProductExtras`). */
function ofertasComoTexto(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o) => {
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        const label = typeof r.label === 'string' ? r.label : '';
        const total = r.total != null ? `: ${r.total}` : '';
        const cond =
          typeof r.conditions === 'string' && r.conditions ? ` (${r.conditions})` : '';
        return label ? `${label}${total}${cond}` : '';
      }
      return typeof o === 'string' ? o : '';
    })
    .filter(Boolean);
}

import { rateFor } from '@/lib/admin/cost';
import { redactModelSecrets } from '@/lib/security/model-secrets';
import { cancelar, liquidar, reservar } from '@/lib/wallet/operacion';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * JEV: EL QUE DECIDE, NO EL QUE ESCRIBE.
 *
 * Jev (TypeSafe, modelo "System One") no genera texto. Recibe un estado —el
 * mensaje, el hilo, el pedido— y preguntas con respuesta cerrada: sí o no con
 * probabilidad (`noul`), una opción entre varias (`choice`), un nivel en una
 * escala (`score`). Contesta en unos cientos de milisegundos y cobra sólo la
 * entrada, a $0,042 por millón de tokens: una clasificación sale ~$0,00004,
 * contra ~$0,001 de Haiku haciendo lo mismo con un JSON que además hay que
 * parsear y a veces viene roto.
 *
 * Acá van TODAS las decisiones cerradas que hasta ahora pagaban un modelo
 * generativo: si una conversación necesita una persona, qué intención tiene una
 * respuesta en un flujo, si un comentario es spam o quiere comprar, si un
 * comentario merece además un privado. Lo que hay que REDACTAR —una respuesta,
 * un resumen, un segmento— sigue en Anthropic, porque Jev no escribe.
 *
 * Cómo se usa bien (docs.typesafe.ai):
 *   - Muchas preguntas chicas en UNA llamada, no una pregunta grande. Las
 *     preguntas de un mismo pedido corren en paralelo y no se ven entre sí.
 *   - Cada pregunta literal: Jev contesta lo que está escrito, no lo que se
 *     quiso decir. Las condiciones y los casos borde van en `criteria`.
 *   - Estado chico: sólo lo que la pregunta necesita. El contexto de más
 *     baja la precisión.
 *   - La cuenta la hace el código: umbrales, pesos, fechas, números.
 *   - Es texto nada más: sin imágenes. Y su idioma principal es el inglés;
 *     en español funciona (probado el 2026-09-19 con casos reales de
 *     escalada), pero los umbrales se validan sobre nuestros datos.
 *
 * Sin `TYPESAFE_API_KEY` no existe: cada superficie que lo usa conserva su
 * camino de antes (Haiku o la heurística), así que apagar Jev es borrar la
 * llave y nada deja de funcionar.
 *
 * Y SI SE CAE, TAMPOCO. Hay un fusible: un timeout, un 5xx, un 401 o un error
 * de red lo abren durante `FUSIBLE_MS`, y en ese rato `hayJev()` dice que no,
 * así que cada superficie va derecho a Haiku sin esperar un timeout por
 * mensaje. Pasado el rato se prueba de nuevo con una sola llamada; si vuelve a
 * fallar, otro rato. Una caída de TypeSafe le cuesta a Riverz una llamada
 * lenta cada dos minutos, no una por mensaje.
 *
 * Se cobra como todo lo demás: pasa por la puerta (`puedeUsarIa`), reserva un
 * centavo —el mínimo de la billetera— y liquida el costo exacto con los tokens
 * que devolvió. Siempre con la llave de Riverz: no hay BYOK de TypeSafe.
 */

const URL_BASE = 'https://api.typesafe.ai/v1';
const PROVEEDOR = 'typesafe';
/** Jev contesta en ~250 ms; a los 8 s ya no va a contestar. */
const TIMEOUT_MS = 8_000;
/** Cuánto se lo da por caído después de un fallo. */
const FUSIBLE_MS = 2 * 60_000;

let caidoHasta = 0;

function abrirFusible(motivo: string): void {
  caidoHasta = Date.now() + FUSIBLE_MS;
  console.warn(`[jev] caído (${motivo}); Haiku toma las decisiones durante ${FUSIBLE_MS / 1000} s`);
}

/** Para las pruebas: cierra el fusible a mano. */
export function reiniciarFusibleJev(): void {
  caidoHasta = 0;
}

/** Un `noul`: ¿esto es verdad? Devuelve la probabilidad de que sí. */
export interface PreguntaNoul {
  type: 'noul';
  instructions: Instrucciones;
  criteria?: { true?: Instrucciones; false?: Instrucciones };
}

/** Un `choice`: una opción entre varias. `null` = sin descripción. */
export interface PreguntaChoice<O extends string = string> {
  type: 'choice';
  instructions: Instrucciones;
  criteria: Record<O, Instrucciones | null>;
}

/** Un `score`: un nivel en una escala ordenada (dos como mínimo). */
export interface PreguntaScore {
  type: 'score';
  instructions: Instrucciones;
  criteria: Instrucciones[];
}

/**
 * Las instrucciones aceptan texto o estructura (`{ question, focus, examples }`):
 * la estructura separa lo que en una frase larga se mezcla.
 */
export type Instrucciones = string | Record<string, unknown> | unknown[];

export type Pregunta = PreguntaNoul | PreguntaChoice | PreguntaScore;

export interface RespuestaNoul {
  type: 'noul';
  noul: number;
}

export interface RespuestaChoice<O extends string = string> {
  type: 'choice';
  choice: O;
  probabilities: Record<O, number>;
  /** Qué tan concentrada está la distribución. No es "qué tan correcta". */
  confidence: number;
}

export interface RespuestaScore {
  type: 'score';
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

/** El tipo de la respuesta sale del tipo de la pregunta. */
export type RespuestaDe<P> = P extends PreguntaNoul
  ? RespuestaNoul
  : P extends PreguntaChoice<infer O>
    ? RespuestaChoice<O>
    : P extends PreguntaScore
      ? RespuestaScore
      : never;

export type RespuestasDe<Q extends Record<string, Pregunta>> = {
  [K in keyof Q]: RespuestaDe<Q[K]>;
};

export interface ResultadoJev<Q extends Record<string, Pregunta>> {
  answers: RespuestasDe<Q>;
  /** El id versionado que contestó (`jev-1.13.0`), para poder fijar umbrales. */
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** El modelo se puede fijar por entorno para no mover umbrales sin querer. */
function modelo(): string {
  return process.env.TYPESAFE_MODEL?.trim() || 'jev-latest';
}

/**
 * ¿Está Jev disponible AHORA? Sin llave, o con el fusible abierto por una
 * caída reciente, cada superficie sigue por su camino viejo.
 */
export function hayJev(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim()) && Date.now() >= caidoHasta;
}

export interface OpcionesJev<Q extends Record<string, Pregunta>> {
  db: SupabaseClient;
  workspaceId: string;
  /** Qué concepto de la billetera paga esto. */
  concepto: 'ia_clasificacion';
  detalle?: Record<string, unknown>;
  /** Lo que se evalúa: texto, objeto o lista. Sólo lo que hace falta. */
  state: unknown;
  questions: Q;
}

/**
 * Una llamada a Jev, cobrada. Devuelve `null` en vez de lanzar —sin llave, sin
 * saldo, timeout, 5xx— porque todo el que la usa tiene un camino de respaldo
 * y no puede romperse por esto.
 */
export async function preguntarJev<Q extends Record<string, Pregunta>>(
  o: OpcionesJev<Q>
): Promise<ResultadoJev<Q> | null> {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key || !hayJev()) return null;
  if (!(await puedeUsarIa(o.db, o.workspaceId))) return null;

  const model = modelo();
  const rate = rateFor(model);
  const body = JSON.stringify({
    model,
    state: sinSecretos(o.state),
    questions: o.questions,
  });
  const billing = {
    db: o.db,
    workspaceId: o.workspaceId,
    concepto: o.concepto,
    detalle: { ...o.detalle, proveedor: PROVEEDOR },
  };

  // Un token son ~3 bytes de español; se reserva el doble por si acaso. La
  // billetera redondea a un centavo, que es diez veces más que cualquier
  // llamada real: la reserva es formal, la liquidación es exacta.
  let reservaId: string;
  try {
    reservaId = await reservar(
      billing,
      PROVEEDOR,
      ((Buffer.byteLength(body, 'utf8') / 3) * 2 * rate.input) / 1e6,
      { modelo: model }
    );
  } catch {
    return null;
  }

  let res: Response;
  try {
    res = await pedirConReintento(key, body);
  } catch (err) {
    // Un error de red deja la reserva: el proveedor pudo haberla procesado.
    // Es un centavo y `wallet_operaciones_pending` la limpia.
    abrirFusible(err instanceof Error ? err.name : 'red');
    return null;
  }

  if (!res.ok) {
    if ([400, 401, 403, 404, 413, 422, 429].includes(res.status)) {
      await cancelar(billing, reservaId).catch(() => undefined);
    }
    const detalle = await res.text().catch(() => '');
    console.warn(`[jev] ${res.status}: ${detalle.slice(0, 200)}`);
    // Un 4xx de ESTA pregunta (422: una pregunta mal armada) es un bug del
    // llamador, no una caída: no se le cierra la puerta a los demás. Todo lo
    // otro —llave inválida, tope de ritmo que no cedió, 5xx, saturado— sí.
    if (res.status !== 400 && res.status !== 422) abrirFusible(`HTTP ${res.status}`);
    return null;
  }

  let json: ResultadoJev<Q>;
  try {
    json = (await res.json()) as ResultadoJev<Q>;
  } catch {
    abrirFusible('cuerpo ilegible');
    return null;
  }
  const tokens = json.usage?.input_tokens;
  if (!Number.isFinite(tokens) || tokens < 0 || !json.answers) {
    console.warn('[jev] respuesta sin usage o sin answers');
    abrirFusible('respuesta incompleta');
    return null;
  }
  try {
    await liquidar(billing, reservaId, PROVEEDOR, (tokens * rate.input) / 1e6, {
      modelo: json.model ?? model,
      usage: json.usage,
      preguntas: Object.keys(o.questions).length,
    });
  } catch {
    // Ya se contestó: no se tira la respuesta por un fallo de caja. Queda en
    // el log de `liquidar` para conciliar.
  }
  return json;
}

/**
 * Hasta dos intentos: el segundo sólo por 429 (tope de ritmo) o 529 (saturado),
 * que son los que TypeSafe pide reintentar. Se respeta `retry-after` cuando
 * viene; si no, un segundo.
 */
async function pedirConReintento(key: string, body: string): Promise<Response> {
  const res = await pedir(key, body);
  if (res.status !== 429 && res.status !== 529) return res;
  const espera = Number(res.headers.get('retry-after'));
  await new Promise((r) =>
    setTimeout(r, Number.isFinite(espera) && espera > 0 ? Math.min(espera, 5) * 1000 : 1000)
  );
  return pedir(key, body);
}

function pedir(key: string, body: string): Promise<Response> {
  return fetch(`${URL_BASE}/systemone`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Lo mismo que se le hace al prompt de Anthropic: ninguna clave viaja. Se
 * recorre el objeto y se limpia cada texto por separado; pasar el JSON
 * serializado por el filtro rompía las comillas escapadas.
 */
function sinSecretos(state: unknown): unknown {
  if (typeof state === 'string') return redactModelSecrets(state);
  if (Array.isArray(state)) return state.map(sinSecretos);
  if (state === null || typeof state !== 'object') return state;
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state as Record<string, unknown>)) {
    limpio[k] = sinSecretos(v);
  }
  return limpio;
}

/**
 * La sonda del panel de proveedores: ¿la llave sirve? `GET /models` no cobra.
 */
export async function sondaJev(key: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${URL_BASE}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  return { ok: res.status === 200, status: res.status };
}

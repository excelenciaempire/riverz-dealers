/**
 * Costo estimado de la IA a partir de los tokens.
 *
 * `ai_replies` guarda `prompt_tokens` y `completion_tokens` en cada despacho
 * desde la migración 024 — y hasta ahora nadie los leyó nunca. Con eso y la
 * tarifa del modelo sale el costo real por comercio.
 *
 * Es una ESTIMACIÓN: son los precios de lista de la API de Anthropic, sin
 * descuentos por caché de prompts (que abarata las lecturas ~10x) ni por lote.
 * Sirve para comparar comercios entre sí y ver la tendencia, no para facturar.
 */

/** USD por millón de tokens, por modelo. */
interface Rate {
  input: number;
  output: number;
}

/**
 * Lo que cuesta la caché, en proporción al token de entrada.
 *
 * Leer de la caché sale una décima parte; escribirla, un 25% más. Son los
 * multiplicadores de Anthropic para la caché de 5 minutos, que es la que usa el
 * agente (`cache_control: { type: 'ephemeral' }`).
 */
const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;

const RATES: Record<string, Rate> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },

  // ── Los proveedores de RESPALDO ──────────────────────────────────────────
  //
  // `completeText` cae a Groq, OpenRouter o Gemini cuando Anthropic no
  // responde. Sin sus precios acá, `rateFor` devolvía la tarifa de Haiku para
  // todos: al comercio se le cobraba entre 2 y 13 veces lo que la llamada
  // costó de verdad. Cobrar de más es tan malo como cobrar de menos cuando lo
  // que se prometió es pasar el costo tal cual.
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'google/gemini-2.0-flash-001': { input: 0.1, output: 0.4 },
};

/** El modelo por defecto de los agentes (migración 024). */
const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * Los ids llevan sufijo de fecha (`claude-haiku-4-5-20251001`); la tarifa está
 * indexada por el alias. Se recorta el sufijo antes de buscar.
 */
function rateFor(model: string | null | undefined): Rate {
  const id = (model ?? DEFAULT_MODEL).trim();
  if (RATES[id]) return RATES[id];
  const withoutDate = id.replace(/-\d{8}$/, '');
  return RATES[withoutDate] ?? RATES[DEFAULT_MODEL];
}

export function costForModel(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
  /**
   * Los tokens de caché, que NO vienen dentro de `promptTokens`.
   *
   * Omitirlos devuelve el número de antes, que es un PISO y no el costo: el
   * prompt del sistema va cacheado, así que en una conversación con historia la
   * lectura de caché es la mayor parte de lo que se paga. Se dejan opcionales
   * porque las filas anteriores a la migración 215 no los tienen y no se pueden
   * inventar.
   */
  cache?: { read?: number; write?: number },
): number {
  const rate = rateFor(model);
  return (
    (promptTokens / 1_000_000) * rate.input +
    (completionTokens / 1_000_000) * rate.output +
    ((cache?.read ?? 0) / 1_000_000) * rate.input * CACHE_READ +
    ((cache?.write ?? 0) / 1_000_000) * rate.input * CACHE_WRITE
  );
}

/** Tokens por modelo tal como los devuelve el RPC `admin_usage_rows`. */
export type TokensByModel = Record<
  string,
  { prompt: number; completion: number }
>;

/**
 * Costo de un comercio sumando modelo por modelo. Si el desglose viene vacío
 * (comercio sin respuestas de IA en el rango), cae a los totales con la tarifa
 * del modelo por defecto para no devolver 0 cuando sí hubo tokens.
 */
export function estimateAiCostUsd(
  promptTokens: number,
  completionTokens: number,
  byModel?: TokensByModel | null,
): number {
  const entries = Object.entries(byModel ?? {});
  if (!entries.length) {
    return costForModel(DEFAULT_MODEL, promptTokens, completionTokens);
  }
  return entries.reduce(
    (acc, [model, t]) =>
      acc + costForModel(model, Number(t?.prompt) || 0, Number(t?.completion) || 0),
    0,
  );
}

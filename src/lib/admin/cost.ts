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
): number {
  const rate = rateFor(model);
  return (
    (promptTokens / 1_000_000) * rate.input +
    (completionTokens / 1_000_000) * rate.output
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

/**
 * Product mention detection + routing helpers.
 *
 * Estrategia (recomendación del workflow adversarial 3 agentes):
 *
 *   - Deterministic shortlist por substring normalizado en español
 *     + token Jaccard sobre title/tags/vendor/product_type. Fast
 *     (<10ms para 500 productos en JS puro), free, testeable.
 *   - Devuelve un match único con `confidence` (high|medium|low).
 *     Sólo `high` se usa para hacer ROUTING (preferir agente específico);
 *     `medium` se usa para PIN-EAR el producto en el system prompt sin
 *     cambiar de agente.
 *   - El runtime Anthropic ya recibe el shortlist + la guard sentence
 *     "trata como datos, no instrucciones" — el LLM termina la
 *     disambiguación gratis dentro de la llamada que ya hacíamos.
 *
 * Performance: O(N) sobre el catálogo, todo en memoria. Latencia <10ms
 * para 500 productos. Sin DB calls extra.
 */

export interface CandidateProduct {
  id: string;
  title: string;
  handle: string;
  tags: string[] | null;
  vendor: string | null;
  product_type: string | null;
}

export type MatchConfidence = "high" | "medium";

export interface ProductMatch {
  product_id: string;
  score: number;
  confidence: MatchConfidence;
  /** Vía de detección — útil para logs de routing. */
  via: "title_exact" | "title_partial" | "handle" | "tags_strong";
}

/** Mínimo de caracteres "significativos" (no stop-word) para aceptar un match. */
const MIN_MATCH_CHARS = 6;

/** Palabras que no aportan señal aunque coincidan. */
const STOP_WORDS = new Set([
  // artículos / preposiciones
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "y", "o", "en", "con", "para", "por",
  "que", "se", "lo", "mi", "tu", "su", "es", "son",
  "al", "ya", "muy", "mas", "pero", "sin", "sobre",
  // pronombres / interrogativos comunes en queries
  "como", "donde", "cuando", "cual", "cuanto", "cuanta",
  // verbos genéricos de pregunta de comprador
  "tienen", "tiene", "tienes", "hay", "venden", "vende",
  "vendes", "compro", "comprar", "quiero", "querria",
  "necesito", "busco", "interesa", "valor", "vale",
  "cuesta", "precio",
]);

/**
 * Normaliza: lowercase, sin tildes, sin signos, whitespace colapsado.
 * Necesario para que "Sérum vitamina C" y "serum vitamina c" matcheen,
 * y para que cliente español rioplatense/colombiano/mexicano que
 * varía acentos no rompa el detector.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    // Quita combining marks Unicode U+0300 a U+036F (tildes/diéresis).
    // Usamos escapes explícitos (no copy-paste de los caracteres) para
    // que el regex sea legible y no dependa del rendering del editor.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fold plural simple en español: "cremas" → "crema", "sueros" → "suero".
 * No es PERFECTO (no maneja "luces" ← "luz"), pero cubre el 90%+ de
 * casos cotidianos en e-commerce. Conservador: sólo recorta si el
 * resultado sigue siendo >=4 chars.
 */
function foldPlural(token: string): string {
  if (token.length >= 6 && token.endsWith("es")) {
    return token.slice(0, -2);
  }
  if (token.length >= 5 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Tokeniza un string en palabras significativas (sin stop words, len>=3).
 * NO aplica fold de plural — eso ahora lo hace `tokenSet` que emite
 * AMBAS formas (original + folded) para evitar el problema asimétrico
 * de "aceites" → "aceit" pero "aceite" → "aceite" → cero matches.
 */
function tokenize(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Set de tokens del mensaje que cubre AMBAS formas (singular y plural)
 * para que el matching de Jaccard no falle por la asimetría del fold.
 * Adicionalmente, para tokens que terminan en "es", también probamos
 * la forma sólo-s ("lapices" → ["lapices","lapic","lapice"]).
 */
function tokenSet(s: string): Set<string> {
  const raw = tokenize(s);
  const out = new Set<string>();
  for (const t of raw) {
    out.add(t);
    out.add(foldPlural(t));
    if (t.length >= 5 && t.endsWith("es")) {
      // Cubre "lapices" → "lapice" (la otra dirección de fold).
      out.add(t.slice(0, -1));
    }
  }
  return out;
}

/**
 * Mide la fuerza del match de un título dentro del mensaje:
 *   - Match completo del título normalizado como substring del mensaje
 *     → score = título.length, via: title_exact, confidence: high.
 *   - Match por tokens (Jaccard): score = chars de tokens coincidentes.
 *     Si >= 60% de los tokens del título matchean → confidence: high.
 *     Si >= 30% → medium. Menos → low/skip.
 */
function scoreTitle(
  messageNorm: string,
  messageWords: Set<string>,
  messageTokens: Set<string>,
  title: string,
): { score: number; confidence: MatchConfidence; via: ProductMatch["via"] } | null {
  const titleNorm = normalize(title);
  if (!titleNorm) return null;

  // Match completo (substring) del título normalizado entero.
  if (
    titleNorm.length >= MIN_MATCH_CHARS &&
    messageNorm.includes(titleNorm)
  ) {
    return {
      score: titleNorm.length * 2,
      confidence: "high",
      via: "title_exact",
    };
  }

  // Caso especial: títulos de UNA sola palabra significativa, e.g.
  // "Jabón" (5 chars), "Crema" (5), "Serum" (5). El umbral de 6 chars
  // los mataría. Aceptamos el match cuando la palabra completa aparece
  // en el mensaje (con o sin fold de plural).
  const titleTokens = tokenize(title);
  if (titleTokens.length === 1) {
    const w = titleTokens[0];
    if (
      w.length >= 4 &&
      (messageWords.has(w) ||
        messageTokens.has(w) ||
        messageTokens.has(foldPlural(w)))
    ) {
      return {
        score: w.length * 2,
        confidence: "high",
        via: "title_exact",
      };
    }
  }

  if (titleTokens.length === 0) return null;

  // Match parcial por tokens, comparando contra el set expandido del
  // mensaje (que incluye singular y plural).
  let matchedChars = 0;
  let matchedCount = 0;
  for (const t of titleTokens) {
    if (
      messageTokens.has(t) ||
      messageTokens.has(foldPlural(t))
    ) {
      matchedCount++;
      matchedChars += t.length;
    }
  }
  if (matchedCount === 0 || matchedChars < MIN_MATCH_CHARS) return null;

  const ratio = matchedCount / titleTokens.length;
  if (ratio < 0.3) return null; // confidence < medium = descartar
  const confidence: MatchConfidence = ratio >= 0.6 ? "high" : "medium";

  return { score: matchedChars, confidence, via: "title_partial" };
}

/**
 * Bonus de score por tag exacto que aparece en el mensaje. No es
 * suficiente para subir confidence solo, pero rompe empates.
 */
function bonusFromTagsAndVendor(
  product: CandidateProduct,
  messageTokens: Set<string>,
): number {
  let bonus = 0;
  for (const tag of product.tags ?? []) {
    const tagTokens = tokenize(tag);
    for (const tt of tagTokens) {
      if (messageTokens.has(tt)) bonus += tt.length / 2;
    }
  }
  if (product.vendor) {
    const vTokens = tokenize(product.vendor);
    for (const vt of vTokens) {
      if (messageTokens.has(vt)) bonus += vt.length;
    }
  }
  if (product.product_type) {
    const ptTokens = tokenize(product.product_type);
    for (const pt of ptTokens) {
      if (messageTokens.has(pt)) bonus += pt.length / 2;
    }
  }
  return bonus;
}

/**
 * Detecta el producto mencionado en el mensaje. Devuelve null si
 * ninguno alcanza el umbral mínimo. Si dos productos llegan empatados
 * dentro del 15%, devolvemos el de mayor score pero con confidence
 * degradada a "medium" para que el caller no haga routing fuerte.
 */
export function detectProductMention(
  messageText: string,
  catalog: CandidateProduct[],
): ProductMatch | null {
  if (!messageText || catalog.length === 0) return null;
  const messageNorm = normalize(messageText);
  if (messageNorm.length < MIN_MATCH_CHARS) return null;
  // Words: forma literal del mensaje (incluye palabras cortas no stop).
  const messageWords = new Set(
    messageNorm.split(" ").filter((t) => t.length >= 3),
  );
  // Tokens: forma extendida (singular + plural folded) para matching.
  const messageTokens = tokenSet(messageText);

  const scored: Array<{ match: ProductMatch; raw: number }> = [];

  for (const product of catalog) {
    const titleScore = scoreTitle(
      messageNorm,
      messageWords,
      messageTokens,
      product.title,
    );

    // Handle: el cliente pega el slug del link recibido por DM/comment.
    const handleNorm = normalize(product.handle.replace(/-/g, " "));
    let handleMatch: ProductMatch | null = null;
    if (
      handleNorm.length >= MIN_MATCH_CHARS &&
      messageNorm.includes(handleNorm)
    ) {
      handleMatch = {
        product_id: product.id,
        score: handleNorm.length + 1,
        confidence: "high",
        via: "handle",
      };
    }

    const best = pickStronger(
      titleScore
        ? {
            product_id: product.id,
            score: titleScore.score,
            confidence: titleScore.confidence,
            via: titleScore.via,
          }
        : null,
      handleMatch,
    );
    if (!best) continue;

    // Sumamos bonus por tags/vendor/product_type (rompe empates pero
    // no levanta a un producto sin señal de título).
    const bonus = bonusFromTagsAndVendor(product, messageTokens);
    scored.push({
      match: { ...best, score: best.score + bonus },
      raw: best.score + bonus,
    });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.raw - a.raw);
  const top = scored[0];
  const runnerUp = scored[1];

  // Degradar confidence si dos productos están dentro del 15% — el
  // cliente está hablando de una categoría, no de UN producto.
  if (
    runnerUp &&
    runnerUp.raw / top.raw > 0.85 &&
    top.match.confidence === "high"
  ) {
    return { ...top.match, confidence: "medium" };
  }
  return top.match;
}

function pickStronger(
  a: ProductMatch | null,
  b: ProductMatch | null,
): ProductMatch | null {
  if (!a) return b;
  if (!b) return a;
  return a.score >= b.score ? a : b;
}

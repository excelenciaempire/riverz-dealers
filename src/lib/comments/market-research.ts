export type CommentChannel = 'fb_comment' | 'ig_comment' | 'tiktok_comment';
export type CommentSentiment = 'positive' | 'neutral' | 'negative';
export type CommentSignalKey =
  | 'price'
  | 'purchase'
  | 'where_to_buy'
  | 'information'
  | 'availability'
  | 'product_use'
  | 'complaint';
export type CommentCategory =
  | 'all'
  | CommentSentiment
  | CommentSignalKey;

export const COMMENT_CATEGORIES: readonly CommentCategory[] = [
  'all',
  'positive',
  'neutral',
  'negative',
  'price',
  'purchase',
  'where_to_buy',
  'information',
  'availability',
  'product_use',
  'complaint',
] as const;

export interface ResearchComment {
  id?: string;
  channel: CommentChannel;
  text: string;
  createdAt: string;
}

export interface MarketMetrics {
  total: number;
  byChannel: Record<CommentChannel, number>;
  sentiment: Record<CommentSentiment, number>;
  signals: Array<{
    key: CommentSignalKey;
    count: number;
  }>;
  terms: Array<{ term: string; count: number }>;
}

export interface MarketResearchReport {
  total: number;
  analyzedSample: number;
  metrics: MarketMetrics;
  summary: string;
  findings: Array<{ title: string; detail: string }>;
  opportunities: string[];
  risks: string[];
  actions: string[];
  generatedWithAi: boolean;
}

const STOP_WORDS = new Set([
  'a',
  'al',
  'algo',
  'and',
  'as',
  'at',
  'arg',
  'con',
  'como',
  'de',
  'del',
  'dias',
  'dia',
  'donde',
  'el',
  'en',
  'deleted',
  'es',
  'esta',
  'este',
  'for',
  'favor',
  'gracias',
  'hola',
  'i',
  'info',
  'informacion',
  'la',
  'las',
  'lo',
  'los',
  'me',
  'mi',
  'mas',
  'muy',
  'no',
  'of',
  'o',
  'para',
  'pero',
  'pilar',
  'pilaroficial',
  'puedo',
  'producto',
  'por',
  'que',
  'quiero',
  'se',
  'si',
  'son',
  'the',
  'to',
  'tiene',
  'un',
  'una',
  'cuanto',
  'cuesta',
  'comprar',
  'compra',
  'consigo',
  'y',
  'ya',
  'you',
  'your',
]);

const POSITIVE =
  /\b(me encanta|excelente|incre[ií]ble|recomiendo|me funcion[oó]|me sirvi[oó]|perfect[ao]|gracias|love|great)\b/i;
const NEGATIVE =
  /\b(car[oi]|decepci[oó]n|estafa|feo|horrible|malo|mentira|no funciona|no sirve|problema|queja|reclamo|tarde|terrible|wrong|bad|scam)\b/i;

const SIGNALS: Array<{
  key: CommentSignalKey;
  pattern: RegExp;
}> = [
  {
    key: 'price',
    pattern: /\b(cu[aá]nto|cuesta|precio|valor|sale|cost[oa])\b/i,
  },
  {
    key: 'purchase',
    pattern:
      /\b(me interesa|lo quiero|quiero comprar|voy a comprar|quiero pedir|hacer (el )?pedido)\b/i,
  },
  {
    key: 'where_to_buy',
    pattern:
      /\b(d[oó]nde (lo )?(compro|consigo|encuentro)|c[oó]mo (lo )?compro|link|enlace|p[aá]gina para comprar)\b/i,
  },
  {
    key: 'information',
    pattern:
      /\b(info(?:rmaci[oó]n)?|m[aá]s detalles|quiero saber|me das (m[aá]s )?informaci[oó]n)\b/i,
  },
  {
    key: 'availability',
    pattern: /\b(disponible|env[ií]o|entrega|llega|stock|talla|color)\b/i,
  },
  {
    key: 'product_use',
    pattern: /\b(c[oó]mo se usa|c[oó]mo usar|se aplica|aplicar|cu[aá]ntas veces|para qu[eé] sirve|funciona para)\b/i,
  },
  { key: 'complaint', pattern: NEGATIVE },
];

export function analyzeCommentMetrics(
  comments: readonly ResearchComment[]
): MarketMetrics {
  const byChannel: Record<CommentChannel, number> = {
    fb_comment: 0,
    ig_comment: 0,
    tiktok_comment: 0,
  };
  const sentiment: Record<CommentSentiment, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  const signals = SIGNALS.map((signal) => ({ key: signal.key, count: 0 }));
  const words = new Map<string, number>();

  for (const comment of comments) {
    byChannel[comment.channel]++;
    const text = comment.text.trim();
    sentiment[classifyCommentSentiment(text)]++;

    SIGNALS.forEach((signal, index) => {
      if (signal.pattern.test(text)) signals[index].count++;
    });
    for (const word of text
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]{3,}/g) ?? []) {
      if (!STOP_WORDS.has(word)) words.set(word, (words.get(word) ?? 0) + 1);
    }
  }

  return {
    total: comments.length,
    byChannel,
    sentiment,
    signals,
    terms: [...words.entries()]
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
      .slice(0, 12),
  };
}

/** Clasificación determinista usada igual en el total, los filtros y el detalle. */
export function classifyCommentSentiment(text: string): CommentSentiment {
  if (NEGATIVE.test(text)) return 'negative';
  if (POSITIVE.test(text)) return 'positive';
  return 'neutral';
}

/** Un filtro siempre responde a la misma regla que produjo la métrica visible. */
export function commentMatchesCategory(
  comment: ResearchComment,
  category: CommentCategory
): boolean {
  if (category === 'all') return true;
  if (category === 'positive' || category === 'neutral' || category === 'negative')
    return classifyCommentSentiment(comment.text) === category;
  const signal = SIGNALS.find((item) => item.key === category);
  return Boolean(signal?.pattern.test(comment.text));
}

export function filterCommentsByCategory(
  comments: readonly ResearchComment[],
  category: CommentCategory
): ResearchComment[] {
  return comments.filter((comment) => commentMatchesCategory(comment, category));
}

/** Evita enviar datos de contacto accidentales junto con el texto de research. */
export function redactComment(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[teléfono]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMarketResearchPrompt(args: {
  locale: 'es' | 'en';
  metrics: MarketMetrics;
  comments: readonly ResearchComment[];
}): string {
  const language = args.locale === 'en' ? 'English' : 'Spanish';
  const sample = args.comments
    .map(
      (comment, index) =>
        `${index + 1}. [${comment.channel}] ${redactComment(comment.text).slice(0, 300)}`
    )
    .join('\n');
  return `You are a senior customer-insight analyst for an ecommerce brand. Write the result in ${language} using natural, precise language.
Use only the comments and exact metrics below. Do not invent products, claims, demographics, sales, causes, or outcomes.
The counts are rule-based detections, not proof of intent or satisfaction. State them faithfully: say "X comments mention..." rather than claiming that X people will buy or that the market has a confirmed problem.
Write a concise but useful narrative: explain the strongest recurring questions, what needs to be clarified in the ad or reply, and what is still uncertain. Avoid labels such as "friction", "interest", "opportunity", or "sentiment" unless you immediately explain them in everyday language.
Every finding must name the observable pattern and why it matters. Do not create a finding from one isolated comment. Do not use generic advice, motivational language, or unsupported numbers.
Return ONLY valid JSON with this schema:
{
  "summary":"one natural evidence-based paragraph that distinguishes strong signals from uncertainty",
  "findings":[{"title":"plain-language finding","detail":"what people actually ask or say, the count when available, and the practical implication"}],
  "opportunities":["specific evidence-based opportunity or empty array"],
  "risks":["specific evidence-based risk or empty array"],
  "actions":["specific action with owner, place to change, and the evidence behind it"]
}
Use 3-5 findings, up to 5 items in each other list. Do not quote personal data. If the evidence is insufficient, say so plainly.

Exact metrics from the full corpus:
${JSON.stringify(args.metrics)}

Representative comment sample (${args.comments.length} comments):
${sample}`;
}

export function fallbackResearch(
  metrics: MarketMetrics,
  locale: 'es' | 'en'
): Omit<
  MarketResearchReport,
  'total' | 'analyzedSample' | 'metrics' | 'generatedWithAi'
> {
  const price =
    metrics.signals.find((signal) => signal.key === 'price')?.count ?? 0;
  const complaint =
    metrics.signals.find((signal) => signal.key === 'complaint')?.count ?? 0;
  const whereToBuy =
    metrics.signals.find((signal) => signal.key === 'where_to_buy')?.count ?? 0;
  const information =
    metrics.signals.find((signal) => signal.key === 'information')?.count ?? 0;
  const popular = metrics.terms
    .slice(0, 4)
    .map((term) => term.term)
    .join(', ');
  const es = locale === 'es';
  return {
    summary: es
      ? `${metrics.total} comentarios analizados. Las señales más repetidas son ${popular || 'aún insuficientes para identificar temas claros'}.`
      : `${metrics.total} comments analyzed. The most frequent signals are ${popular || 'not yet enough to identify clear themes'}.`,
    findings: [
      {
        title: es ? 'Preguntas concretas por precio' : 'Direct price questions',
        detail: es
          ? `${price} comentarios mencionan precio o costo. Conviene que el anuncio y la respuesta inicial indiquen el precio y cómo continuar, sin asumir que cada pregunta termina en compra.`
          : `${price} comments mention price or cost. The ad and first reply should state the price and how to continue, without assuming every question becomes a purchase.`,
      },
      {
        title: es ? 'Comentarios con posible problema' : 'Comments with a possible problem',
        detail: es
          ? `${complaint} comentarios contienen palabras asociadas a una queja o resultado negativo. Revísalos uno por uno antes de cambiar el mensaje o escalar el anuncio.`
          : `${complaint} comments contain words associated with a complaint or negative result. Review them one by one before changing the message or scaling the ad.`,
      },
      ...(whereToBuy > 0
        ? [
            {
              title: es ? 'Dónde comprar' : 'Where to buy',
              detail: es
                ? `${whereToBuy} comentarios preguntan dónde o cómo comprar. Es una señal de navegación: el enlace y el siguiente paso deben estar visibles.`
                : `${whereToBuy} comments ask where or how to buy. This is a navigation signal: the link and next step should be visible.`,
            },
          ]
        : []),
      ...(information > 0
        ? [
            {
              title: es ? 'Información antes de decidir' : 'Information before deciding',
              detail: es
                ? `${information} comentarios piden información. Conviene responder con la misma ficha breve y verificable, no con respuestas distintas cada vez.`
                : `${information} comments ask for information. Reply with the same short, verifiable product card rather than a different answer each time.`,
            },
          ]
        : []),
    ],
    opportunities:
      price > 0
        ? [
            es
              ? 'Hacer visible el precio y el siguiente paso de compra en cada pieza.'
              : 'Make the price and next buying step visible in every piece.',
          ]
        : [],
    risks:
      complaint > 0
        ? [
            es
              ? 'Revisar los comentarios negativos antes de amplificar el contenido.'
              : 'Review negative comments before amplifying the content.',
          ]
        : [],
    actions: buildEvidenceActions(metrics, locale),
  };
}

/**
 * Pasos operativos que siempre apuntan a una señal contada en el corpus entero.
 * No dependen de que la síntesis de IA devuelva una recomendación bonita pero
 * imposible de comprobar.
 */
export function buildEvidenceActions(
  metrics: MarketMetrics,
  locale: 'es' | 'en'
): string[] {
  const es = locale === 'es';
  const count = (key: MarketMetrics['signals'][number]['key']) =>
    metrics.signals.find((signal) => signal.key === key)?.count ?? 0;
  const actions: string[] = [];
  const price = count('price');
  const purchase = count('purchase');
  const whereToBuy = count('where_to_buy');
  const information = count('information');
  const availability = count('availability');
  const productUse = count('product_use');
  const complaint = count('complaint');
  const esComments = (n: number) => `${n} ${n === 1 ? 'comentario' : 'comentarios'}`;
  const enComments = (n: number) => `${n} ${n === 1 ? 'comment' : 'comments'}`;
  const esVerb = (n: number, singular: string, plural: string) =>
    n === 1 ? singular : plural;
  if (price)
    actions.push(
      es
        ? `Actualiza la pieza y la respuesta guardada con precio, moneda y CTA. Evidencia: ${esComments(price)} ${esVerb(price, 'pregunta', 'preguntan')} por precio.`
        : `Update the asset and saved reply with price, currency, and a CTA. Evidence: ${enComments(price)} ask about price.`
    );
  if (whereToBuy)
    actions.push(
      es
        ? `Pon un enlace de compra visible en el anuncio y una respuesta guardada que lleve a la página exacta. Evidencia: ${esComments(whereToBuy)} ${esVerb(whereToBuy, 'pregunta', 'preguntan')} dónde comprar.`
        : `Put a visible purchase link in the ad and a saved reply that leads to the exact page. Evidence: ${enComments(whereToBuy)} ask where to buy.`
    );
  if (information)
    actions.push(
      es
        ? `Responde con una ficha breve: beneficio principal, precio, forma de uso y enlace. Evidencia: ${esComments(information)} ${esVerb(information, 'pide', 'piden')} información.`
        : `Reply with a short product card: main benefit, price, usage, and link. Evidence: ${enComments(information)} ask for information.`
    );
  if (availability)
    actions.push(
      es
        ? `Aclara disponibilidad, entrega y cobertura antes de pedir la compra. Evidencia: ${esComments(availability)} ${esVerb(availability, 'pregunta', 'preguntan')} por entrega o stock.`
        : `Clarify availability, delivery, and coverage before asking for the purchase. Evidence: ${enComments(availability)} ask about delivery or stock.`
    );
  if (complaint)
    actions.push(
      es
        ? `Revisa y etiqueta ${esComments(complaint)} con posible fricción antes de reutilizar el anuncio; corrige sólo el problema que se repite.`
        : `Review and tag the ${enComments(complaint)} with possible friction before reusing the ad; fix only the problem that repeats.`
    );
  if (purchase)
    actions.push(
      es
        ? `Prioriza una respuesta rápida con enlace o siguiente paso de compra. Evidencia: ${esComments(purchase)} ${esVerb(purchase, 'muestra', 'muestran')} intención de compra.`
        : `Prioritize a fast reply with a link or next purchase step. Evidence: ${enComments(purchase)} show purchase intent.`
    );
  if (productUse)
    actions.push(
      es
        ? `Añade la forma de uso al creativo y a la respuesta inicial. Evidencia: ${esComments(productUse)} ${esVerb(productUse, 'pregunta', 'preguntan')} cómo usar el producto.`
        : `Add usage instructions to the creative and the first reply. Evidence: ${enComments(productUse)} ask how to use the product.`
    );
  if (!actions.length)
    actions.push(
      es
        ? 'Aún no hay una señal repetida suficiente para cambiar el anuncio. Importa más comentarios y vuelve a revisar las categorías.'
        : 'There is not yet a repeated signal strong enough to change the ad. Import more comments and review the categories again.'
    );
  return actions.slice(0, 6);
}

export function parseMarketResearchResponse(
  text: string
): Pick<
  MarketResearchReport,
  'summary' | 'findings' | 'opportunities' | 'risks' | 'actions'
> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const words = (input: unknown, max: number) =>
      Array.isArray(input)
        ? input
            .filter(
              (item): item is string =>
                typeof item === 'string' && item.trim().length > 0
            )
            .map((item) => item.trim())
            .slice(0, max)
        : [];
    const findings = Array.isArray(value.findings)
      ? value.findings
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === 'object'
          )
          .map((item) => ({
            title: String(item.title ?? '').trim(),
            detail: String(item.detail ?? '').trim(),
          }))
          .filter((item) => item.title && item.detail)
          .slice(0, 5)
      : [];
    const summary =
      typeof value.summary === 'string' ? value.summary.trim() : '';
    if (!summary || findings.length === 0) return null;
    return {
      summary,
      findings,
      opportunities: words(value.opportunities, 5),
      risks: words(value.risks, 5),
      actions: words(value.actions, 5),
    };
  } catch {
    return null;
  }
}

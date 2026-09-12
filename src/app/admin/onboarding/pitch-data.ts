import { auditCases, scenarios, type Brand } from './data';
import { originals, type OriginalTemplate } from './original-templates';

export type PaymentModel = 'prepaid' | 'hybrid' | 'cod';
export type Feature = 'cart' | 'discount' | 'comments' | 'aftercare' | 'voice';
export interface PitchDraft {
  version: 1;
  brand: Brand;
  name: string;
  site: string;
  product: string;
  customer: string;
  amount: string;
  order: string;
  model: PaymentModel;
  features: Record<Feature, boolean>;
  discount: number;
  excluded: string[];
  edits: Record<string, string>;
  answers: Record<string, string>;
  monthly: string;
  launch: string;
  owner: string;
  reviewed: boolean;
}
export interface PitchCase {
  id: string;
  title: string;
  group: number;
  path: string[];
  question?: string;
  source: 'active' | 'draft' | 'blocked' | 'proposal' | 'aiExample' | 'control';
  templateNames: string[];
  example: string | null;
  ai: boolean;
}
export const features: Feature[] = [
  'cart',
  'discount',
  'comments',
  'aftercare',
  'voice',
];
export const models: PaymentModel[] = ['prepaid', 'hybrid', 'cod'];
export const defaults = {
  pilar: {
    name: 'Pilar',
    site: 'https://pilarargentina.store',
    product: 'pitch.skin',
    model: 'prepaid',
  },
  rasmiaw: {
    name: 'Rasmiaw',
    site: 'https://www.rasmiaw.shop',
    product: 'pitch.scratcher',
    model: 'hybrid',
  },
  contraentrega: {
    name: '',
    site: '',
    product: 'pitch.genericProduct',
    model: 'cod',
  },
} as const;

const templateMap: Record<string, Record<number, string[]>> = {
  pilar: {
    6: ['carrito_abandonado_2'],
    8: ['pago_rechazado_recuperacion'],
    10: ['pago_rechazado_recuperacion'],
    12: ['nuevo_pedido'],
    13: ['nuevo_pedido'],
    14: ['nuevo_pedido'],
    21: ['tracking_envio'],
    34: [
      'carrito_abandonado_pilar_v3',
      'carrito_abandonado_pilar_intento_2',
      'carrito_abandonado_pilar_intento_3',
      'pago_pendiente_1',
      'pago_pendiente_2',
      'pago_pendiente_3',
    ],
  },
  rasmiaw: {
    6: ['rasmiaw_carrito_abandonado_1', 'rasmiaw_carrito_abandonado_2'],
    8: ['rasmiaw_pago_rechazado'],
    10: ['rasmiaw_pago_rechazado'],
    12: ['rasmiaw_preparando_pedido'],
    13: [
      'rasmiaw_preparando_pedido',
      'rasmiaw_beneficio_contraentrega_v2',
      'rasmiaw_recordatorio_contraentrega_v2',
      'rasmiaw_ultima_oportunidad_contraentrega_v2',
    ],
    19: [
      'rasmiaw_recordatorio_contraentrega_v2',
      'rasmiaw_ultima_oportunidad_contraentrega_v2',
    ],
    20: [
      'rasmiaw_recordatorio_contraentrega_v2',
      'rasmiaw_ultima_oportunidad_contraentrega_v2',
    ],
    21: ['rasmiaw_envio_tracking'],
  },
};
const auditExamples: Record<number, string> = {
  0: 'catalog',
  1: 'checkout',
  2: 'comments',
  4: 'privacy',
  5: 'health',
  9: 'catalog',
  15: 'confirm',
  16: 'benefit',
  17: 'benefit',
  18: 'benefit',
  22: 'tracking',
  23: 'incident',
  24: 'receipt',
  25: 'returns',
  26: 'pickup',
  29: 'voice',
  30: 'handoff',
};
const aiIndices = new Set([
  0, 1, 2, 3, 4, 5, 9, 15, 16, 17, 18, 22, 23, 24, 25, 26, 30,
]);

export function currentCases(brand: Brand): PitchCase[] {
  if (brand === 'contraentrega') return [];
  return auditCases.map((c, i) => {
    const names = templateMap[brand]?.[i] ?? [];
    let source: PitchCase['source'] = names.length
      ? 'active'
      : aiIndices.has(i)
        ? 'aiExample'
        : 'control';
    if (brand === 'rasmiaw' && [8, 10].includes(i)) source = 'blocked';
    if (brand === 'pilar' && [29, 34].includes(i)) source = 'draft';
    // No automated follow-up runs in these outcomes, even if a previous template exists.
    const silent =
      [3, 7, 11, 27, 28, 31, 32, 33].includes(i) ||
      (brand === 'rasmiaw' && [14, 34].includes(i)) ||
      (brand === 'pilar' && [15, 16, 17, 18, 19, 20].includes(i));
    return {
      id: c.id,
      title: c.title,
      group: c.group,
      path: c[brand],
      source,
      templateNames: silent ? [] : names,
      example: silent ? null : (auditExamples[i] ?? null),
      ai: aiIndices.has(i),
    };
  });
}

export function proposedCases(draft: PitchDraft): PitchCase[] {
  const applicable = scenarios
    .filter((s) => {
      if (s.id === 'codpayment') return draft.model === 'cod';
      if (['confirm', 'address', 'refusal', 'collection'].includes(s.id))
        return draft.model !== 'prepaid';
      if (['rejected', 'pending', 'benefit'].includes(s.id))
        return (
          draft.model !== 'cod' &&
          (s.id !== 'benefit' || draft.model === 'hybrid')
        );
      return true;
    })
    .filter((s) => {
      if (s.id === 'cart') return draft.features.cart;
      if (s.id === 'comments') return draft.features.comments;
      if (['care', 'satisfaction', 'repeat'].includes(s.id))
        return draft.features.aftercare;
      if (s.id === 'benefit') return draft.features.discount;
      return true;
    })
    .map((s) => ({
      id: 'design-' + s.id,
      title: s.title,
      group: s.group,
      path: [s.trigger, s.action, s.exception],
      question: s.question,
      source: 'proposal' as const,
      templateNames: [],
      example: s.id,
      ai: s.group === 0 || s.id === 'handoff',
    }));
  for (const [feature, group] of [
    ['discount', 1],
    ['voice', 2],
  ] as const) {
    if (!draft.features[feature]) continue;
    const id = feature === 'discount' ? 'offer' : 'voice';
    applicable.push({
      id: 'design-' + id,
      title: `pitch.${id}Title`,
      group,
      path: [`pitch.${id}Trigger`, `pitch.${id}Action`, `pitch.${id}Exception`],
      question: `pitch.${id}Question`,
      source: 'proposal',
      templateNames: [],
      example: id,
      ai: id === 'voice',
    });
  }
  return applicable;
}

export function templatesForCase(
  brand: Brand,
  item: PitchCase
): OriginalTemplate[] {
  return item.templateNames.flatMap((name) => {
    const variants = (originals[brand] ?? []).filter((t) => t.name === name);
    const preferred =
      variants.find((t) => t.buttons.some((b) => b.urlVariable)) ?? variants[0];
    return preferred ? [preferred] : [];
  });
}

export function isCaseEnabled(item: PitchCase, draft: PitchDraft): boolean {
  if (['audit-7', 'audit-8', 'audit-10', 'design-cart'].includes(item.id))
    return draft.features.cart;
  if (['audit-3', 'audit-4', 'audit-5', 'design-comments'].includes(item.id))
    return draft.features.comments;
  if (['design-offer', 'design-benefit'].includes(item.id))
    return draft.features.discount;
  if (['audit-30', 'design-voice'].includes(item.id))
    return draft.features.voice;
  if (
    item.group === 3 ||
    [
      'audit-29',
      'design-care',
      'design-satisfaction',
      'design-repeat',
    ].includes(item.id)
  )
    return draft.features.aftercare;
  return true;
}

export function proposedButtons(example: string | null): string[] {
  if (example === 'cart' || example === 'offer') return ['pitch.buttonResume'];
  if (example === 'confirm')
    return ['pitch.buttonConfirm', 'pitch.buttonCorrect'];
  if (example === 'benefit')
    return ['pitch.buttonConfirm', 'pitch.buttonBenefit'];
  if (example === 'refusal')
    return ['pitch.buttonReattempt', 'pitch.buttonCancel'];
  return [];
}

/** Replace named variables only. Numeric original placeholders stay intact unless explicitly supplied. */
export function bindTemplateValues(
  bindings: Record<string, string>,
  values: Record<string, string>,
  draft: PitchDraft
): Record<string, string> {
  const bound = { ...values };
  for (const [key, binding] of Object.entries(bindings)) {
    bound[key] = /tracking_number/.test(binding)
      ? (values.trackingNumber ?? 'DEMO-1042')
      : /tracking/.test(binding)
        ? values.tracking
        : /checkout/.test(binding)
          ? values.checkout
          : /order_name/.test(binding)
            ? draft.order
            : /total_price/.test(binding)
              ? draft.amount
              : /name/.test(binding)
                ? draft.customer
                : binding;
  }
  return bound;
}

export function renderMessage(
  body: string,
  values: Record<string, string>
): string {
  return body.replace(/\{\{([\w]+)\}\}/g, (match, key) => values[key] ?? match);
}

export function safeWebsite(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseDraft(text: string, brand: Brand): PitchDraft {
  if (text.length > 500_000) throw new Error('invalid_draft');
  const d = JSON.parse(text)?.draft;
  if (!d || d.version !== 1 || d.brand !== brand || !models.includes(d.model))
    throw new Error('invalid_draft');
  for (const field of [
    'name',
    'site',
    'product',
    'customer',
    'amount',
    'order',
    'monthly',
    'launch',
    'owner',
  ])
    if (typeof d[field] !== 'string' || d[field].length > 5000)
      throw new Error('invalid_draft');
  if (
    !features.every((f) => typeof d.features?.[f] === 'boolean') ||
    !Number.isFinite(d.discount) ||
    d.discount < 0 ||
    d.discount > 100 ||
    typeof d.reviewed !== 'boolean'
  )
    throw new Error('invalid_draft');
  if (
    !Array.isArray(d.excluded) ||
    !d.excluded.every((v: unknown) => typeof v === 'string')
  )
    throw new Error('invalid_draft');
  for (const field of ['edits', 'answers'])
    if (
      !d[field] ||
      Array.isArray(d[field]) ||
      typeof d[field] !== 'object' ||
      !Object.values(d[field]).every(
        (v) => typeof v === 'string' && v.length <= 10000
      )
    )
      throw new Error('invalid_draft');
  return d as PitchDraft;
}

import { parseMoney } from '@/lib/shopify/detect-offers';
import type { DealerQuoteEvidence } from './quote-evidence';
const amount = String.raw`\d+(?:[.,]\d+|[ \u00a0\u202f]\d{3}(?!\d))*`;
const currency = String.raw`(?:AR\$|US\$|\$|ARS|USD|COP|CLP|MXN|BRL|PEN|EUR|GBP|CAD|AUD|pesos?|d[oó]lares?|dollars?|euros?)`;
/** Mask only non-price facts before the shared monetary guard. Never authorize
 * a vehicle price merely because the buyer mentioned that amount. */
export function dealerQuoteText(
  text: string,
  inbound: string,
  evidence: readonly DealerQuoteEvidence[]
) {
  const budgetSource = new RegExp(
    String.raw`\b(?:presupuesto|budget|hasta|up\s+to|maximum|max|l[ií]mite)(?:\s+(?:es|de|of|is|a|hasta|up|to|m[aá]ximo))*\s*:?\s*(?:${currency}\s*)?(${amount})`,
    'gi'
  );
  const budgets = new Set(
    [...inbound.matchAll(budgetSource)]
      .map((m) => parseMoney(m[1]))
      .filter((n) => n != null)
  );
  const budgetQuote = new RegExp(
    String.raw`\b(?:presupuesto|budget|l[ií]mite)(?:\s+(?:es|de|of|is|a|hasta|up|to|m[aá]ximo))*\s*:?\s*(?:${currency}\s*)?(${amount})(?:\s*${currency}\b)?`,
    'gi'
  );
  let masked = text.replace(budgetQuote, (match, raw) => {
    const value = parseMoney(raw);
    return value != null && budgets.has(value) ? '[budget]' : match;
  });
  const monetary = (before: string, after: string) =>
    new RegExp(`${currency}\\s*$`, 'i').test(before) ||
    new RegExp(`^\\s*${currency}\\b`, 'i').test(after) ||
    /\b(?:cuesta|vale|precio|price|costs?|worth)\s*:?\s*$/i.test(before);
  const distance = new RegExp(
    String.raw`${amount}\s*(?:km|mi|miles|millas|kil[oó]metros|kilometers)\b`,
    'gi'
  );
  masked = masked.replace(distance, (match, ...args) => {
    const offset = args[0] as number;
    return monetary(masked.slice(Math.max(0, offset - 30), offset), '')
      ? match
      : '[mileage]';
  });
  for (const year of new Set(
    evidence
      .map((q) => q.year)
      .filter(
        (y): y is number =>
          typeof y === 'number' &&
          y >= 1900 &&
          y <= new Date().getFullYear() + 2
      )
  )) {
    const current = masked;
    masked = masked.replace(
      new RegExp(`(?<![\\p{L}\\p{N}.,])${year}(?![\\p{L}\\p{N}])`, 'gu'),
      (match, offset: number) =>
        monetary(
          current.slice(Math.max(0, offset - 30), offset),
          current.slice(offset + match.length)
        )
          ? match
          : '[year]'
    );
  }
  return masked;
}

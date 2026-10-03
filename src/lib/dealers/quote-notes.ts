const amount = String.raw`\d+(?:[.,]\d+|[ \u00a0\u202f]\d{3}(?!\d))*`;
const code = String.raw`(?:USD|COP|ARS|MXN|CLP|PEN|EUR|BRL|GBP|CAD|AUD)`;
const money = new RegExp(
  String.raw`(?:US\$|AR\$|\$|\b${code}\b)\s*${amount}|${amount}\s*(?:\b${code}\b|d[oó]lares?\b|dollars?\b|euros?\b)`,
  'gi'
);

/** Only the structured, rechecked price is quotable. Keep stored notes intact;
 * supplementary money in free text requires the seller's review. */
export function dealerQuoteNotes(notes: string) {
  return notes.replace(money, '[importe por confirmar con el vendedor]');
}

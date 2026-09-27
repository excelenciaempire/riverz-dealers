/** Explicit stock-check buttons move the existing run; arbitrary replies still pause it. */
export function retentionStockReply(
  text: string,
  vars: Record<string, unknown>,
  now: Date
) {
  if (vars.retention_stage !== 'stock_check') return null;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!['me queda poco', 'tengo para rato'].includes(normalized)) return null;
  const count = Math.max(0, Number(vars.retention_stock_deferrals) || 0);
  const later = normalized === 'tengo para rato' && count < 2;
  const cursor = later
    ? vars.retention_question_cursor
    : vars.retention_offer_cursor;
  if (typeof cursor !== 'string' || !cursor) return null;
  return {
    cursor,
    runAt: new Date(now.getTime() + (later ? 15 * 86400000 : 0)),
    vars: {
      ...vars,
      retention_stock_deferrals: later ? count + 1 : count,
      retention_stage: later ? 'stock_check' : 'offer',
      retention_pause_token: null,
    },
  };
}

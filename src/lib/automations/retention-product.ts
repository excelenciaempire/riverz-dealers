/** Only normalized order lines supplied by the commerce webhook are considered.
 * Unknown quantities keep care available but never select a replenishment offer. */
export function retentionProductVars(
  raw: unknown,
  product: unknown
): Record<string, string> {
  const empty = { retention_product: '', retention_units: '' };
  if (typeof raw !== 'string' || typeof product !== 'string' || !product.trim())
    return empty;
  let lines: unknown;
  try {
    lines = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!Array.isArray(lines)) return empty;
  const matches = lines.filter(
    (line) =>
      line &&
      typeof line.title === 'string' &&
      line.title.trim().toLowerCase() === product.trim().toLowerCase()
  );
  if (!matches.length) return empty;
  const quantities = matches.map((line) =>
    typeof line.quantity === 'number' ||
    (typeof line.quantity === 'string' && /^\d+$/.test(line.quantity))
      ? Number(line.quantity)
      : NaN
  );
  const units = quantities.reduce((sum, quantity) => sum + quantity, 0);
  return {
    retention_product: product.trim(),
    retention_units:
      quantities.every((q) => Number.isSafeInteger(q) && q > 0) &&
      Number.isSafeInteger(units)
        ? String(units)
        : '',
  };
}

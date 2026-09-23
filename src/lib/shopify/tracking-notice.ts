/**
 * Dropi can publish a guide while the parcel is still "prepared for carrier",
 * before Shopify reports the order as fulfilled.
 */
export function shouldAnnounceTrackingNumber(
  current: string | null | undefined,
  previous: string | null | undefined,
): boolean {
  const next = String(current ?? '').trim()
  const before = String(previous ?? '').trim()
  return Boolean(next) && next !== before
}


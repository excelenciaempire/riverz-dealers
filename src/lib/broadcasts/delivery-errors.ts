const known = ['invalid','unavailable','uncertain','rejected','changed','duplicate','pendingConfirmation','paused','optedOut','excluded','templateUnavailable','marketingUnavailable','variables','invalidPhone','alreadySent','notPending'] as const
export function broadcastDeliveryErrorCode(code: string): string {
  const value = known.includes(code as typeof known[number]) ? code : 'unavailable'
  return `broadcast_delivery_${value.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}`
}
/** Machine receipt states stay stable; existing error views use the current locale. */
export function broadcastDeliveryError(value: string | null | undefined, t: (key: string) => string): string {
  const code = known.find(code => broadcastDeliveryErrorCode(code) === value)
  return code ? t(`broadcasts.delivery${code.charAt(0).toUpperCase()+code.slice(1)}`) : value ?? ''
}

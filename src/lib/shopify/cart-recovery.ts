import { esBorrador } from './borradores'

export type CartRecoverySource = 'draft' | 'checkout'

export function cartRecoverySource(checkoutId: string | null | undefined): CartRecoverySource {
  return esBorrador(checkoutId) ? 'draft' : 'checkout'
}

/** Borrador primero: trae una factura lista y es la señal más caliente. */
export function compareCartRecoveryCandidates(
  a: { checkout_id: string; created_at: string },
  b: { checkout_id: string; created_at: string },
): number {
  const sourceOrder =
    Number(cartRecoverySource(a.checkout_id) === 'checkout') -
    Number(cartRecoverySource(b.checkout_id) === 'checkout')
  if (sourceOrder !== 0) return sourceOrder
  return Date.parse(a.created_at) - Date.parse(b.created_at)
}

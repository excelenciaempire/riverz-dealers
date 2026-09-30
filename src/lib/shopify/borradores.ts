/**
 * Los borradores de pedido viven en la MISMA tabla que los carritos
 * (`shopify_checkouts`), para que los levante el mismo cron y salgan por la
 * misma plantilla. Ver `api/shopify/webhooks/draft-orders/route.ts`.
 *
 * Como comparten tabla, comparten espacio de claves: el token de un checkout
 * es una cadena hexadecimal y el id de un borrador es un número, así que en la
 * práctica no chocarían — pero "en la práctica" no es una garantía cuando la
 * consecuencia es pisar el carrito de otra persona. El prefijo lo vuelve
 * imposible, y de paso hace obvio de dónde salió cada fila al mirar la tabla.
 */
export const CLAVE_BORRADOR = 'draft_'
export const REPLACEMENT_DRAFT_TAG = 'riverz_replacement'
const OPERATION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function replacementDraftTag(operationId:string):string {
  if (!OPERATION_UUID.test(operationId)) throw new Error('invalid_replacement_operation')
  return `${REPLACEMENT_DRAFT_TAG}_${operationId.toLowerCase()}`
}
/** Replacement drafts are operational records, excluded from abandoned-purchase recovery. */
export function isReplacementDraft(tags:unknown):boolean {
  const list=typeof tags === 'string' ? tags.split(',') : Array.isArray(tags) ? tags : []
  return list.some(tag => typeof tag === 'string' && (tag.trim().toLowerCase() === REPLACEMENT_DRAFT_TAG ||
    (tag.trim().toLowerCase().startsWith(`${REPLACEMENT_DRAFT_TAG}_`) && OPERATION_UUID.test(tag.trim().slice(REPLACEMENT_DRAFT_TAG.length+1)))))
}

/** `draft_<id>`, o null si el borrador no trae id. */
export function claveDeBorrador(id: unknown): string | null {
  const limpio = String(id ?? '').trim()
  return limpio ? `${CLAVE_BORRADOR}${limpio}` : null
}

/** ¿Esta fila de `shopify_checkouts` es un borrador y no un carrito? */
export function esBorrador(checkoutId: string | null | undefined): boolean {
  return String(checkoutId ?? '').startsWith(CLAVE_BORRADOR)
}

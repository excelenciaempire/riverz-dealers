/** Prevent a dispatch notice from being repurposed for a different message. */
export function assertTemplateIntent(templateName: string, params?: string[]): void {
  if (templateName !== 'deuna_despachado_producto_v2') return

  // The fixed template copy says "¡Ya enviamos tu compra!". Its first variable
  // is only for the purchased items, never for a correction or apology.
  const items = params?.[0]?.trim() ?? ''
  const looksLikeItems = /^\d+\s*[×x]\s*\S/i.test(items)
  const isCorrection = /cancelaci[oó]n|cancelad[oa]s?|error del sistema|mensaje anterior|aviso anterior/i.test(items)
  if (!looksLikeItems || isCorrection || !params?.[1]?.trim()) {
    throw new Error('template_intent_mismatch: deuna_despachado_producto_v2 requires order items and tracking number')
  }
}

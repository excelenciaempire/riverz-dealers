import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * URL de webhook propia de cada comercio para Mercado Pago.
 *
 * Mercado Pago no dice a qué cuenta pertenece la notificación de forma que
 * podamos confiar: manda el id del pago y poco más. Y como cada comercio se
 * conecta con SU access token —no con una aplicación nuestra— tampoco hay un
 * secreto de firma compartido que verificar.
 *
 * La salida es meter la identidad en la URL: cada comercio pega una URL con
 * su workspace y una firma derivada de ese workspace. El endpoint recalcula
 * la firma y compara. Resuelve las dos cosas de una vez —de quién es la
 * notificación y si es legítima— sin tabla nueva ni búsqueda por token.
 */

/** Firma corta y estable del workspace. No es reversible. */
export function webhookToken(workspaceId: string): string {
  const key = process.env.ENCRYPTION_KEY ?? ''
  return createHmac('sha256', key)
    .update(`mercadopago:${workspaceId}`)
    .digest('base64url')
    .slice(0, 32)
}

/** Comparación en tiempo constante: el token es un secreto. */
export function verifyWebhookToken(workspaceId: string, token: string): boolean {
  const expected = webhookToken(workspaceId)
  const a = Buffer.from(expected)
  const b = Buffer.from(token ?? '')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** La URL que el comerciante pega en el panel de Mercado Pago. */
export function webhookUrl(workspaceId: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/mercadopago/webhook/${workspaceId}/${webhookToken(workspaceId)}`
}

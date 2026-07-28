import { handleTiendanubePrivacy } from '@/lib/commerce/providers/tiendanube-privacy'

/** Webhook de privacidad obligatorio de Tiendanube: store_redact. */
export async function POST(request: Request) {
  return handleTiendanubePrivacy(request, 'store_redact')
}

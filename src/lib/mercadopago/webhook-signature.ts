import { createHmac, timingSafeEqual } from 'node:crypto'

/** Validate the app webhook, not the separate merchant-specific webhook URLs. */
export function validPaymentSignature(request: Request, secret: string): boolean {
  if (!secret) return false
  const signature = request.headers.get('x-signature') ?? ''
  const parts = signature.split(',').map((part) => part.trim().split('='))
  const timestamps = parts.filter(([key]) => key === 'ts')
  const hashes = parts.filter(([key]) => key === 'v1')
  if (timestamps.length !== 1 || hashes.length !== 1) return false
  const ts = timestamps[0][1] ?? ''
  const hash = hashes[0][1] ?? ''
  const requestId = request.headers.get('x-request-id')
  // Mercado Pago signs the URL data.id, not the unsigned JSON payload.
  const dataId = new URL(request.url).searchParams.get('data.id')?.toLowerCase()
  if (!dataId || !requestId || !/^\d+$/.test(ts) || !/^[a-f\d]{64}$/i.test(hash)) return false
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest()
  return timingSafeEqual(expected, Buffer.from(hash, 'hex'))
}

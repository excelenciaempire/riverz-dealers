/**
 * Per-workspace token bucket para no pasarnos del rate-limit del tier
 * de Meta. La envoltura es por proceso (Map en memoria); si el broadcast
 * worker se reparte entre múltiples instancias hay que migrar a Redis,
 * pero hoy el cron corre en un solo nodo.
 *
 * Default 80 msg/seg (el tier inicial Meta Business). Se puede subir
 * por env: META_TIER_MSGS_PER_SEC.
 */

interface Bucket {
  tokens: number
  lastRefillMs: number
}

const buckets = new Map<string, Bucket>()

function rate(): number {
  const raw = process.env.META_TIER_MSGS_PER_SEC
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 80
}

function refill(bucket: Bucket, capacity: number, now: number): void {
  const elapsed = (now - bucket.lastRefillMs) / 1000
  if (elapsed <= 0) return
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * capacity)
  bucket.lastRefillMs = now
}

/**
 * Espera hasta tener crédito para mandar un mensaje del workspace dado.
 * Resuelve cuando consumió un token. No tira nunca.
 */
export async function acquire(workspaceId: string): Promise<void> {
  const capacity = rate()
  let bucket = buckets.get(workspaceId)
  if (!bucket) {
    bucket = { tokens: capacity, lastRefillMs: Date.now() }
    buckets.set(workspaceId, bucket)
  }

  while (true) {
    const now = Date.now()
    refill(bucket, capacity, now)
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return
    }
    const missing = 1 - bucket.tokens
    const waitMs = Math.max(5, Math.ceil((missing / capacity) * 1000))
    await new Promise((r) => setTimeout(r, waitMs))
  }
}

export function __resetThrottleForTests(): void {
  buckets.clear()
}

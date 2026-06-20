/**
 * Per-WABA messaging-tier cap enforcement.
 *
 * Meta gates the WhatsApp Business API by a `messaging_limit` tier per
 * WABA — how many UNIQUE recipients the business may initiate
 * conversations with in any rolling 24-hour window:
 *
 *   TIER_50           50 / 24h
 *   TIER_250         250 / 24h
 *   TIER_1K        1.000 / 24h
 *   TIER_10K      10.000 / 24h
 *   TIER_100K    100.000 / 24h
 *   TIER_UNLIMITED  no cap
 *
 * The in-process token bucket in `throttle.ts` paces RATE (msg/s) but
 * doesn't bound 24h VOLUME. A TIER_250 merchant on the broadcasts cron
 * would otherwise blast a 5,000-row CSV at 80 msg/s, trip the cap mid-
 * batch, and burn quality rating + drop messages silently.
 *
 * This module is the single source of truth for "may this connection
 * send N more messages right now?". Every bulk path (broadcasts cron,
 * /api/whatsapp/broadcast) calls assertWithinTierCap() before each
 * recipient — the helper itself decides whether to allow or defer.
 *
 * The 24h-sent count comes from the `get_waba_24h_sent_count(UUID)`
 * SQL function added in migration 058. The tier comes from
 * `channel_connections.messaging_limit_tier`, which is cached at
 * connect time and refreshed periodically; NULL is treated as TIER_50
 * (most conservative — better to under-send than trip the real cap).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { withAppsecretProof } from '@/lib/channels/meta-graph'

export type MessagingTier =
  | 'TIER_50'
  | 'TIER_250'
  | 'TIER_1K'
  | 'TIER_10K'
  | 'TIER_100K'
  | 'TIER_UNLIMITED'

/** 24-hour unique-recipient cap per Meta tier. */
export const TIER_CAPS: Record<MessagingTier, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  // Use Infinity rather than a sentinel so arithmetic comparisons just
  // work — TIER_UNLIMITED always satisfies `sent + add < cap`.
  TIER_UNLIMITED: Number.POSITIVE_INFINITY,
}

const KNOWN_TIERS: ReadonlySet<MessagingTier> = new Set([
  'TIER_50',
  'TIER_250',
  'TIER_1K',
  'TIER_10K',
  'TIER_100K',
  'TIER_UNLIMITED',
])

/**
 * Map a raw `messaging_limit_tier` value (cached column, possibly stale
 * or NULL) to a known tier. NULL/unknown → TIER_50 so an unbacked row
 * cannot accidentally trigger an over-send. Refreshing the cache on
 * connect and at webhook time keeps the conservative default rare.
 */
export function normalizeTier(raw: string | null | undefined): MessagingTier {
  if (raw && KNOWN_TIERS.has(raw as MessagingTier)) return raw as MessagingTier
  return 'TIER_50'
}

export interface TierCapDecision {
  /** True when (sent + add) fits within the connection's tier cap. */
  allowed: boolean
  tier: MessagingTier
  cap: number
  sent24h: number
  /** Number requested by the caller (pre-check). */
  requested: number
  /**
   * Number the caller may safely send right now without tripping the
   * cap. Equal to `requested` when allowed=true; `max(0, cap - sent24h)`
   * when allowed=false so the caller can choose to partial-send or
   * defer the whole batch.
   */
  allowedNow: number
  /**
   * Set when `allowed=false`. Human-readable, safe to surface in logs +
   * broadcast_recipients.error_message ("WABA tier TIER_250 cap reached").
   */
  reason?: string
}

/**
 * Check whether `connId` may add `addCount` more unique recipients in
 * the next 24h without tripping its WABA tier cap.
 *
 * Pure read — never mutates. Callers decide what to do with `allowed=false`:
 * the broadcasts cron defers remaining recipients (leaves them in
 * `pending` so the next tick re-evaluates), while interactive callers
 * can return a 429 with `decision.allowedNow` exposed.
 */
export async function assertWithinTierCap(
  admin: SupabaseClient,
  connId: string,
  addCount: number,
): Promise<TierCapDecision> {
  // Pull the cached tier. Missing connection → conservative deny so a
  // typo'd id can't accidentally yield "unlimited".
  const { data: conn, error: connErr } = await admin
    .from('channel_connections')
    .select('messaging_limit_tier, channel')
    .eq('id', connId)
    .maybeSingle()

  if (connErr || !conn || conn.channel !== 'whatsapp') {
    const tier: MessagingTier = 'TIER_50'
    return {
      allowed: false,
      tier,
      cap: TIER_CAPS[tier],
      sent24h: 0,
      requested: addCount,
      allowedNow: 0,
      reason: 'unknown or non-whatsapp connection',
    }
  }

  const tier = normalizeTier(conn.messaging_limit_tier as string | null)
  const cap = TIER_CAPS[tier]

  // Unlimited tier skips the SQL roundtrip entirely.
  if (cap === Number.POSITIVE_INFINITY) {
    return {
      allowed: true,
      tier,
      cap,
      sent24h: 0,
      requested: addCount,
      allowedNow: addCount,
    }
  }

  // 24h distinct-recipient count via the SQL helper added in mig 058.
  // We pass conn_id; the function joins through broadcasts → recipients
  // for the same workspace + channel='whatsapp'.
  const { data: rpc, error: rpcErr } = await admin.rpc(
    'get_waba_24h_sent_count',
    { conn_id: connId },
  )

  // Treat RPC failures as "unknown" → deny. The alternative (assume 0)
  // is the foot-gun that motivated this whole module.
  const sent24h = rpcErr || rpc == null ? cap : Number(rpc)
  const remaining = Math.max(0, cap - sent24h)
  const allowed = sent24h + addCount <= cap

  return {
    allowed,
    tier,
    cap,
    sent24h,
    requested: addCount,
    allowedNow: allowed ? addCount : remaining,
    reason: allowed
      ? undefined
      : `WABA tier ${tier} cap reached (${sent24h}/${cap} in last 24h)`,
  }
}

/**
 * Resolve the WhatsApp `channel_connections.id` for a workspace. There
 * is exactly one active WhatsApp per workspace (enforced by migration
 * 063's partial unique index + upsertSingleWhatsAppConnection), so we
 * skip disconnected rows and return that single active connection.
 * Returns `null` if the workspace has no active WhatsApp number —
 * callers then skip the tier check and rely on the legacy
 * `whatsapp_config` path (which itself errors out without credentials).
 */
export async function resolveWhatsAppConnectionId(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('channel_connections')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp')
    .neq('status', 'disconnected')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * Fetch the current `messaging_limit` from Meta for a WABA and persist
 * it onto the channel_connection row. Called at connect time and from
 * any webhook/cron that revisits the connection. Best-effort: a Meta
 * outage or revoked token returns `null` and leaves the cached value
 * alone (the normalized fallback is TIER_50, which is safe-side).
 *
 * Meta returns the tier as `messaging_limit_tier` on the WABA node:
 *   GET /{waba-id}?fields=messaging_limit_tier
 * docs: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates#messaging-limits
 */
export async function refreshMessagingLimitTier(
  admin: SupabaseClient,
  args: {
    connectionId: string
    wabaId: string
    accessToken: string
  },
): Promise<MessagingTier | null> {
  try {
    const res = await fetch(
      withAppsecretProof(
        `https://graph.facebook.com/v21.0/${args.wabaId}?fields=messaging_limit_tier`,
        args.accessToken,
      ),
      { headers: { Authorization: `Bearer ${args.accessToken}` } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { messaging_limit_tier?: string | null }
    const raw = json.messaging_limit_tier ?? null
    if (!raw) return null
    const tier = normalizeTier(raw)
    await admin
      .from('channel_connections')
      .update({ messaging_limit_tier: tier })
      .eq('id', args.connectionId)
    return tier
  } catch {
    return null
  }
}

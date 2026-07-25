// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  /** Conversations with at least one message in the range vs previous period. */
  conversations: MetricDelta
  /** New contacts in the selected range (current) vs the previous period. */
  newContacts: MetricDelta
  /** Conversations resolved (closed) in the range vs previous period. */
  resolved: MetricDelta
  /** Messages we sent in the range vs previous period. */
  messagesSent: MetricDelta
  /** Messages received in the range vs previous period. */
  messagesReceived: MetricDelta
  /**
   * Volume mix by channel over the selected range. Seeded with EVERY channel
   * the workspace has connected, so a channel with no traffic in the window
   * shows as 0 instead of silently vanishing from the card.
   */
  channelMix: ChannelMixPoint[]
}

export interface ChannelMixPoint {
  channel: string
  inbound: number
  outbound: number
}

export interface ConversationsSeriesPoint {
  /** Bucket key in workspace tz: `YYYY-MM-DD` (daily) or `YYYY-MM-DDTHH`
   *  (hourly, used for short ranges like Hoy/Ayer). */
  day: string
  incoming: number
  outgoing: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  /** Average first-response (minutes) over the selected range. */
  thisPeriodAvg: number | null
  /** Average over the previous equal-length period, for comparison. */
  prevPeriodAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

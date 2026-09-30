import type { AutomationContext } from './engine'

export interface AutomationEntry {
  key: string
  trigger_type: string
  trigger_config: Record<string, unknown>
}

export const ENTRY_EVENTS = ['shopify_order_delivered', 'keyword_match', 'shopify_order_cancelled', 'shopify_order_refunded'] as const

/** Multiple event entrances share one editable step tree, lifecycle and log. */
export function eventEntries(config: Record<string, unknown>): AutomationEntry[] {
  if (!Array.isArray(config.event_entries)) return []
  return config.event_entries.filter((e): e is AutomationEntry => !!e && typeof e === 'object' &&
    typeof e.key === 'string' && /^[a-z][a-z0-9_]*$/.test(e.key) &&
    ENTRY_EVENTS.includes(e.trigger_type) && !!e.trigger_config && typeof e.trigger_config === 'object')
}

export function matchesEventConfig(type: string, config: Record<string, unknown>, ctx?: AutomationContext): boolean {
  const platform = String(ctx?.vars?.platform ?? '').trim()
  if (Array.isArray(config.platforms) && config.platforms.length && platform && !config.platforms.includes(platform)) return false
  if (type === 'tag_added') return typeof config.tag_id === 'string' && !!config.tag_id && config.tag_id === ctx?.tag_id
  if (type !== 'keyword_match') return true
  if (!Array.isArray(config.keywords) || !config.keywords.length) return false
  const text = String(ctx?.message_text ?? '')
  if (!text) return false
  const haystack = config.case_sensitive ? text : text.toLowerCase()
  return config.keywords.some(raw => {
    if (typeof raw !== 'string' || !raw) return false
    const word = config.case_sensitive ? raw : raw.toLowerCase()
    return config.match_type === 'exact' ? haystack === word : haystack.includes(word)
  })
}

export function resolveEventEntry(config: Record<string, unknown>, event: string, ctx?: AutomationContext): AutomationEntry | undefined {
  const careKeys = ['main', 'help', 'stop', 'shopify_order_cancelled', 'shopify_order_refunded']
  return eventEntries(config).find(e => e.trigger_type === event &&
    (config.retention_replenishment !== false || careKeys.includes(e.key)) &&
    matchesEventConfig(event, { ...e.trigger_config, platforms: config.platforms ?? e.trigger_config.platforms }, ctx))
}

/** Routing comes from the dispatched event, never from customer-provided vars. */
export function entryContext(context: AutomationContext | undefined, entry: AutomationEntry, config: Record<string, unknown>): AutomationContext {
  return { ...context, vars: { ...context?.vars, automation_entry: entry.key,
    retention_replenishment: config.retention_replenishment !== false,
    stop_on_inbound: entry.trigger_config.stop_on_inbound === true } }
}

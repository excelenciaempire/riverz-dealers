import { describe, expect, it } from 'vitest'
import { entryContext, matchesEventConfig, resolveEventEntry } from './event-entries'
import { validateTriggerForActivation } from './validate'
import { listTemplates } from './templates'

// Legacy multi-entry automations remain readable; new reorder plans use AI handoff.
const flow = { trigger_type: 'shopify_order_delivered', trigger_config: {
  platforms: ['shopify'], event_triggers: ['shopify_order_delivered', 'keyword_match', 'shopify_order_cancelled', 'shopify_order_refunded'],
  event_entries: [
    { key: 'main', trigger_type: 'shopify_order_delivered', trigger_config: {} },
    ...[['help', ['Necesito ayuda', 'Los compartí']], ['later', ['Más adelante']], ['stop', ['No más recordatorios']], ['repeat', ['Quiero repetir']], ['later_15', ['Recordar en 15 días']], ['later_30', ['Recordar en 30 días']]].map(([key, keywords]) => ({ key, trigger_type: 'keyword_match', trigger_config: { keywords, match_type: 'exact', stop_on_inbound: key === 'later_15' } })),
    ...['shopify_order_cancelled', 'shopify_order_refunded'].map(trigger_type => ({ key: trigger_type, trigger_type, trigger_config: {} })),
  ],
} }
const cfg = flow.trigger_config
describe('one retention automation, multiple event entrances', () => {
  it.each([
    ['shopify_order_delivered', '', 'main'], ['keyword_match', 'Necesito ayuda', 'help'],
    ['keyword_match', 'Los compartí', 'help'], ['keyword_match', 'Más adelante', 'later'],
    ['keyword_match', 'No más recordatorios', 'stop'], ['keyword_match', 'Quiero repetir', 'repeat'],
    ['keyword_match', 'Recordar en 15 días', 'later_15'], ['keyword_match', 'Recordar en 30 días', 'later_30'],
    ['shopify_order_refunded', '', 'shopify_order_refunded'], ['shopify_order_cancelled', '', 'shopify_order_cancelled'],
  ])('routes %s / %s to %s in the same tree', (event, text, key) => {
    expect(resolveEventEntry(cfg, event, { message_text: text })?.key).toBe(key)
  })
  it('ignores unrelated events, keyword substrings and other platforms', () => {
    expect(resolveEventEntry(cfg, 'shopify_order_created')).toBeUndefined()
    expect(resolveEventEntry(cfg, 'keyword_match', { message_text: 'No más recordatorios extra' })).toBeUndefined()
    expect(resolveEventEntry(cfg, 'shopify_order_delivered', { vars: { platform: 'woocommerce' } })).toBeUndefined()
    expect(matchesEventConfig('keyword_match', { keywords: ['hola'], match_type: 'contains' }, { message_text: 'Hola equipo' })).toBe(true)
  })
  it('derives entry and stop-on-reply from the trusted event, not incoming variables', () => {
    const entry = resolveEventEntry(cfg, 'keyword_match', { message_text: 'Recordar en 15 días' })!
    expect(entryContext({ vars: { automation_entry: 'main', stop_on_inbound: false } }, entry, cfg).vars)
      .toMatchObject({ automation_entry: 'later_15', stop_on_inbound: true })
    expect(entryContext({ vars: { retention_replenishment: true } }, entry, { ...cfg, retention_replenishment: false }).vars?.retention_replenishment).toBe(false)
  })
  it('disables reorder entry points while keeping support and opt-out', () => {
    const care = { ...cfg, retention_replenishment: false }
    expect(resolveEventEntry(care, 'keyword_match', { message_text: 'Quiero repetir' })).toBeUndefined()
    expect(resolveEventEntry(care, 'keyword_match', { message_text: 'No más recordatorios' })?.key).toBe('stop')
  })
  it('validates subscriptions and nested keyword configs', () => {
    expect(validateTriggerForActivation(flow.trigger_type, cfg)).toEqual([])
    expect(validateTriggerForActivation(flow.trigger_type, { ...cfg, event_triggers: [] })).not.toEqual([])
    expect(validateTriggerForActivation(flow.trigger_type, { ...cfg, event_entries: [{ key: 'main', trigger_type: 'shopify_order_delivered', trigger_config: { event_entries: [] } }] })).not.toEqual([])
  })
  it('exposes only one post-purchase recipe in both languages', () => {
    for (const locale of ['es', 'en'] as const) {
      const slugs = listTemplates(locale).map(t => t.slug)
      expect(slugs.filter(s => ['postventa-reposicion', 'postventa-acompanamiento', 'post-survey', 'recompras'].includes(s))).toEqual(['postventa-reposicion'])
    }
  })
})

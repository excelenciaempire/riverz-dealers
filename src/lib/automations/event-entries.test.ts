import { describe, expect, it } from 'vitest'
import { buildRetentionPlan } from './retention-plan'
import { entryContext, matchesEventConfig, resolveEventEntry } from './event-entries'
import { validateTriggerForActivation } from './validate'
import { listTemplates } from './templates'

const flow = buildRetentionPlan({ locale: 'es', prefix: 'retention_test', product: 'Coffee',
  offers: [{ units: 1, day: 22, label: '1' }], tags: { enrolled: '', permission: '', paused: '', help: '' } }).flows[0]
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
    expect(flow.steps.some(s => s.step_config.value === key)).toBe(true)
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

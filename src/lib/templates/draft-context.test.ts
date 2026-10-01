import { describe, expect, it } from 'vitest'
import { templateDraftContext, validateTemplateDraft, templateDraftPriceMismatch } from './draft-context'

const product = { id: 'product', title: 'Serum', allowed_offers: [{ label: 'Bundle', total: 90, conditions: 'Only with three units, excludes shipping' }], never_say: ['Guaranteed cure'], health_sensitive: true, currency: 'USD', price_min: 40, price_max: 40, training_material_built_at: 'version-1' }
const agent = { id: 'agent', name: 'Business assistant', tone: 'friendly', knowledge: 'Only nationwide shipping', persona: 'Helpful', updated_at: 'version-1' }
describe('context for editable WhatsApp drafts', () => {
  it('preserves complete offer conditions and forbidden claims with business tone', () => {
    const context = templateDraftContext(product, agent)
    const data = JSON.parse(context.text)
    expect(data.product.allowed_offers).toEqual(product.allowed_offers)
    expect(data.product.never_say).toEqual(product.never_say)
    expect(data.product.price_min).toBe(40)
    expect(data.product.currency).toBe('USD')
    expect(data.business.tone).toBe('friendly')
    expect(context.sources).toEqual([{ id: 'product', label: 'Serum', kind: 'product' }, { id: 'agent', label: 'Business assistant', kind: 'assistant' }])
  })
  it('does not include credentials or unrelated contact/customer data', () => {
    const context = templateDraftContext({ ...product, access_token: 'private', customers: ['private-contact'], training_material: 'api_key="private-key"', variants: [{ title: 'Standard', metadata: { client_secret: 'private-nested' } }] }, agent)
    expect(context.text).not.toContain('private')
    expect(context.text).toContain('[REDACTED]')
  })
  it('rejects oversized knowledge without cutting exceptions or offer conditions', () => {
    expect(() => templateDraftContext({ ...product, training_material: 'x'.repeat(50000) }, agent)).toThrow('template_draft_context_large')
  })
  it('invalidates changes to training, tone, product identity and source version', () => {
    const baseline = templateDraftContext(product, agent).fingerprint
    for (const changed of [{ ...product, training_material_built_at: 'version-2' }, { ...product, id: 'other' }, { ...product, allowed_offers: [] }, { ...product, price_min: 30 }]) expect(templateDraftContext(changed, agent).fingerprint).not.toBe(baseline)
    expect(templateDraftContext(product, { ...agent, tone: 'formal' }).fingerprint).not.toBe(baseline)
  })
  it.each(['', 'x'.repeat(1025), 'Hola {{2}}', '{{0}}', '{{name}}', '```text```', '{{1}} {unfinished'])('rejects malformed or truncated output (%s)', text => {
    expect(() => validateTemplateDraft(text)).toThrow('template_draft_output_invalid')
  })
  it('keeps editable text and repeated sequential variables intact', () => {
    expect(validateTemplateDraft(' Hola {{1}}, tu {{2}}. Gracias {{1}}. ')).toBe('Hola {{1}}, tu {{2}}. Gracias {{1}}.')
    expect(validateTemplateDraft('x'.repeat(1024))).toHaveLength(1024)
  })
  it('checks explicit currency amounts without treating ordinary capitalized words as currency', () => {
    const policy = { currency: 'USD', amounts: [40] }
    expect(templateDraftPriceMismatch('For ALL orders, send SOS for help.', policy)).toBe(false)
    expect(templateDraftPriceMismatch('USD40', policy)).toBe(false)
    expect(templateDraftPriceMismatch('40 EUR', policy)).toBe(true)
    expect(templateDraftPriceMismatch('EUR40', policy)).toBe(true)
    expect(templateDraftPriceMismatch('USD35', policy)).toBe(true)
  })
})

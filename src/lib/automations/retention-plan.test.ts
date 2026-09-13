import { describe, expect, it } from 'vitest'
import { buildRetentionPlan, type RetentionPlanOptions } from './retention-plan'
import { shouldStopRunOnInbound } from './inbound-stop'
import { validateStepsForActivation } from './validate'
import { buildTemplateComponents } from '@/lib/whatsapp/template-components'
import type { BuilderStepInput } from './steps-tree'

const tags = { enrolled: '00000000-0000-4000-8000-000000000001', permission: '00000000-0000-4000-8000-000000000002', paused: '00000000-0000-4000-8000-000000000003', help: '00000000-0000-4000-8000-000000000004' }
const options: RetentionPlanOptions = { locale: 'es', prefix: 'pilar_postventa_v1', product: 'Serum Pilar', tags,
  offers: [{ units: 1, day: 22, label: '1 unidad' }, { units: 3, day: 82, label: '2 unidades + 1 gratis' }, { units: 4, day: 112, label: '3 unidades + 1 gratis' }] }

// Execute the native branch grammar with a virtual clock and changing facts.
// This verifies total elapsed days, not just the presence of wait nodes.
function run(nodes: BuilderStepInput[], unit: number, changes: { pauseAt?: number; purchaseAt?: number; consent?: boolean; replyAt?: number; product?: string; replenishment?: boolean; disableReorderAt?: number } = {}) {
  let day = 0
  let stops = true
  const sent: Array<{ day: number; name: string }> = []
  const walk = (steps: BuilderStepInput[]) => {
    for (const s of steps) {
      const c = s.step_config
      if (s.step_type === 'wait') { day += Number(c.amount); if (stops && (changes.replyAt ?? Infinity) <= day) return }
      if (s.step_type === 'set_context') stops = (c.values as { stop_on_inbound?: boolean }).stop_on_inbound === true
      if (s.step_type === 'send_template') sent.push({ day, name: String(c.template_name) })
      if (s.step_type === 'condition') {
        const vars: Record<string, unknown> = { first_item: changes.product ?? 'Serum Pilar', offer_units: unit, automation_entry: 'main', retention_replenishment: changes.replenishment !== false && day < (changes.disableReorderAt ?? Infinity) }
        const yes = c.subject === 'context_var' ? String(vars[String(c.operand)]) === c.value
          : c.subject === 'purchased' ? day >= (changes.purchaseAt ?? Infinity)
          : c.operand === tags.permission ? changes.consent !== false
          : c.operand === tags.paused ? day >= (changes.pauseAt ?? Infinity) : false
        walk((yes ? s.branches?.yes : s.branches?.no) ?? [])
      }
    }
  }
  walk(nodes)
  return sent
}

describe('retention program', () => {
  const plan = buildRetentionPlan(options)
  it.each([[1, [1, 7, 22, 29]], [3, [1, 7, 21, 82, 89]], [4, [1, 7, 21, 112, 119]]])('schedules the actual delivery-relative cycle for %i units', (units, days) => {
    expect(run(plan.flows[0].steps, Number(units)).map(s => s.day)).toEqual(days)
  })
  it('does not assume an unknown quantity is a single unit', () => {
    expect(run(plan.flows[0].steps, 2).map(s => s.day)).toEqual([1, 7, 21])
  })
  it('does not send for another product or an absent verified permission', () => {
    expect(run(plan.flows[0].steps, 1, { product: 'Other' })).toEqual([])
    expect(run(plan.flows[0].steps, 1, { consent: false })).toEqual([])
  })
  it('stops the entire remaining branch for a support pause or later purchase', () => {
    expect(run(plan.flows[0].steps, 3, { pauseAt: 20 }).map(s => s.day)).toEqual([1, 7])
    expect(run(plan.flows[0].steps, 4, { purchaseAt: 60 }).map(s => s.day)).toEqual([1, 7, 21])
  })
  it('ends the second offer on any reply after the first offer', () => {
    expect(run(plan.flows[0].steps, 1, { replyAt: 23 }).map(s => s.day)).toEqual([1, 7, 22])
  })
  it('hands any early reply to AI and contains no scripted response branches', () => {
    expect(run(plan.flows[0].steps, 1, { replyAt: 2 }).map(s => s.day)).toEqual([1])
    expect(plan.flows).toHaveLength(1)
    expect(plan.flows[0].trigger_config).toMatchObject({ stop_on_inbound: true, retention_ai_managed: true })
    expect(plan.flows[0].trigger_config.event_entries).toBeUndefined()
    expect(JSON.stringify(plan.flows[0].steps)).not.toMatch(/send_message|assign_conversation|automation_entry/)
  })
  it('builds valid native steps and WhatsApp components', () => {
    for (const flow of plan.flows) expect(validateStepsForActivation(flow.steps), flow.key).toEqual([])
    for (const t of plan.templates) expect(buildTemplateComponents({ category: 'MARKETING', headerType: 'none', bodyText: t.bodyText, bodySamples: t.bodySamples, buttons: t.buttons, footerText: t.footerText }).error, t.nombre).toBeFalsy()
    expect(new Set(plan.templates.map(t => t.nombre)).size).toBe(plan.templates.length)
  })
  it('creates only reachable templates and does not offer a later reminder after the cycle ends', () => {
    for (const locale of ['es', 'en'] as const) {
      const current = buildRetentionPlan({ ...options, locale })
      const used = new Set<string>()
      const visit = (steps: BuilderStepInput[]) => steps.forEach(s => {
        if (s.step_type === 'send_template') used.add(String(s.step_config.template_name))
        visit(s.branches?.yes ?? [])
        visit(s.branches?.no ?? [])
      })
      visit(current.flows[0].steps)
      expect(new Set(current.templates.map(t => t.nombre))).toEqual(used)
      const last = current.templates.find(t => t.nombre.endsWith('_ultimo_recordatorio'))!
      expect(last.buttons?.map(b => b.text)).not.toContain(locale === 'es' ? 'Más adelante' : 'Remind me later')
      const experience = current.templates.find(t => t.nombre.endsWith('_experiencia'))!
      expect(experience.buttons?.map(b => b.text)).not.toContain(locale === 'es' ? 'Más adelante' : 'Remind me later')
    }
  })
  it('provides English content without Pilar data for another merchant', () => {
    const global = buildRetentionPlan({ ...options, locale: 'en', product: 'Coffee', prefix: 'retention_coffee', offers: [{ units: 1, day: 30, label: '1 bag' }] })
    expect(JSON.stringify(global)).not.toMatch(/Pilar|frascos|gratis|Hola/)
    expect(global.templates.every(t => t.idioma === 'en')).toBe(true)
  })
  it('does not send replenishment offers for the care-only mode', () => {
    const care = buildRetentionPlan({ ...options, offers: [] })
    expect(run(care.flows[0].steps, 1).map(s => s.day)).toEqual([1, 7, 21])
    expect(care.templates).toHaveLength(3)
    expect(care.flows).toHaveLength(1)
    expect(care.templates.map(t => t.bodyText).join(' ')).not.toContain('reponer')
  })
  it('keeps care and feedback when reordering is switched off in the same flow', () => {
    expect(plan.flows).toHaveLength(1)
    for (const units of [1, 3, 4]) expect(run(plan.flows[0].steps, units, { replenishment: false }).map(s => s.day)).toEqual([1, 7, 21])
  })
  it('rechecks the reorder switch after waiting, including before the last offer', () => {
    expect(run(plan.flows[0].steps, 1, { disableReorderAt: 20 }).map(s => s.day)).toEqual([1, 7])
    expect(run(plan.flows[0].steps, 1, { disableReorderAt: 25 }).map(s => s.day)).toEqual([1, 7, 22])
    expect(run(plan.flows[0].steps, 3, { disableReorderAt: 60 }).map(s => s.day)).toEqual([1, 7, 21])
  })
  it('rejects unsafe or ambiguous schedules', () => {
    expect(() => buildRetentionPlan({ ...options, offers: [{ units: 1, day: 0, label: 'One' }] })).toThrow()
    expect(() => buildRetentionPlan({ ...options, offers: [options.offers[0], options.offers[0]] })).toThrow()
  })
})
describe('stage-scoped inbound handoff', () => {
  it('honors the existing opt-in and the per-run boolean independently', () => {
    expect(shouldStopRunOnInbound({ stop_on_inbound: true }, {})).toBe(true)
    expect(shouldStopRunOnInbound({}, { vars: { stop_on_inbound: true } })).toBe(true)
    expect(shouldStopRunOnInbound({}, { vars: { stop_on_inbound: 'true' } })).toBe(false)
    expect(shouldStopRunOnInbound(null, null)).toBe(false)
  })
})

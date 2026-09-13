import type { BuilderStepInput } from './steps-tree'
import type { Locale } from '@/lib/i18n/config'
import type { EntradaCrearPlantilla } from '@/lib/templates/create'
import type { TemplateStepSeed } from './templates'
import type { AutomationStepType } from '@/types'

export interface RetentionOffer { units: number; day: number; label: string }
export interface RetentionTags { enrolled: string; permission: string; paused: string; help: string }
export interface RetentionPlanOptions {
  locale: Locale
  prefix: string
  product: string
  offers: RetentionOffer[]
  tags: RetentionTags
}
export interface RetentionFlow {
  key: string
  name: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  steps: BuilderStepInput[]
}
const step = (step_type: string, step_config: Record<string, unknown>): BuilderStepInput => ({ step_type, step_config })
const wait = (days: number) => step('wait', { amount: days, unit: 'days' })
const branch = (config: Record<string, unknown>, yes: BuilderStepInput[], no: BuilderStepInput[] = []): BuilderStepInput => ({ ...step('condition', config), branches: { yes, no } })

/** Main-flow preview for the gallery and Operator, generated from the same
 * native tree as the real install. Dependencies stay empty until installation. */
export function retentionTemplateSeeds(replenishment: boolean): TemplateStepSeed[] {
  const plan = buildRetentionPlan({ locale: 'es', prefix: 'retention_preview', product: 'Product',
    offers: replenishment ? [{ units: 1, day: 22, label: '1' }] : [],
    tags: { enrolled: '', permission: '', paused: '', help: '' },
  })
  clearRetentionProduct(plan.flows[0].steps)
  const seeds: TemplateStepSeed[] = []
  const visit = (steps: BuilderStepInput[], parent: number | null, side: 'yes' | 'no' | null) => {
    for (const s of steps) {
      const index = seeds.length
      seeds.push({ step_type: s.step_type as AutomationStepType,
        step_config: s.step_type === 'send_template' ? { ...s.step_config, template_name: '' } : s.step_config,
        parent_index: parent, branch: side })
      visit(s.branches?.yes ?? [], index, 'yes')
      visit(s.branches?.no ?? [], index, 'no')
    }
  }
  visit(plan.flows[0].steps, null, null)
  return seeds
}

/** All sends and their remaining suffix live INSIDE their guards. The engine
 * resumes a waiting branch independently; a sibling suffix would escape it. */
export function buildRetentionPlan(o: RetentionPlanOptions): {
  templates: Omit<EntradaCrearPlantilla, 'workspaceId' | 'userId'>[]
  flows: RetentionFlow[]
} {
  if (!/^[a-z][a-z0-9_]{2,42}$/.test(o.prefix)) throw new Error('Invalid retention prefix')
  if (!o.product.trim()) throw new Error('A specific product is required')
  const units = new Set<number>()
  for (const offer of o.offers) {
    if (!Number.isSafeInteger(offer.units) || offer.units < 1 || units.has(offer.units)) throw new Error('Invalid or duplicate units')
    if (!Number.isSafeInteger(offer.day) || offer.day < 22 || offer.day > 365) throw new Error('Replenishment day must be between 22 and 365')
    if (!offer.label.trim()) throw new Error('Offer label required')
    units.add(offer.units)
  }
  const en = o.locale === 'en'
  const copy = (es: string, english: string) => en ? english : es
  const button = {
    help: copy('Necesito ayuda', 'I need help'),
    later: copy('Más adelante', 'Remind me later'),
    stop: copy('No más recordatorios', 'Stop reminders'),
    shared: copy('Los compartí', 'I shared them'),
    repeat: copy('Quiero repetir', 'Order again'),
  }
  const templates: Omit<EntradaCrearPlantilla, 'workspaceId' | 'userId'>[] = []
  function template(key: string, body: string, buttons: string[]) {
    const nombre = `${o.prefix}_${key}`
    templates.push({ nombre, idioma: o.locale, categoria: 'MARKETING', headerType: 'none', bodyText: body,
      bodySamples: ['Ana'], variableFields: { '1': 'customer_name' },
      footerText: copy('Puedes dejar de recibir estos recordatorios.', 'You can stop these reminders.'),
      buttons: buttons.map(text => ({ type: 'QUICK_REPLY' as const, text })), enviarAMeta: false })
    return nombre
  }
  const received = template('entrega', copy(
    `Hola {{1}}, ¿recibiste bien tu pedido de ${o.product}? Si necesitas ayuda para empezar, estamos aquí.`,
    `Hi {{1}}, did your ${o.product} order arrive in good condition? We are here if you need help getting started.`), [button.help, button.stop])
  const care = template('acompanamiento', copy(
    `Hola {{1}}, ¿tienes alguna duda sobre cómo usar ${o.product}? Podemos ayudarte a revisar las indicaciones del producto.`,
    `Hi {{1}}, do you have any questions about using ${o.product}? We can help you review the product instructions.`), [button.help, button.stop])
  const experience = template('experiencia', o.offers.length ? copy(
    `Hola {{1}}, ¿cómo va tu experiencia con ${o.product}? Si compartiste las unidades o necesitas ayuda, cuéntanos cómo te ha ido.`,
    `Hi {{1}}, how is your experience with ${o.product}? If you shared your supply or need help, let us know how it is going.`) : copy(
    `Hola {{1}}, ¿cómo fue tu experiencia con ${o.product}? Si necesitas ayuda, estamos aquí.`,
    `Hi {{1}}, how was your experience with ${o.product}? We are here if you need help.`), o.offers.length ? [button.shared, button.help, button.stop] : [button.help, button.stop])
  const offers = new Map<number, string>()
  for (const offer of o.offers) offers.set(offer.units, template(`reponer_${offer.units}`, copy(
    `Hola {{1}}, en tu pedido elegiste ${offer.label}. ¿Cómo vas con ${o.product}? Si necesitas reponer, podemos ayudarte a repetir tu compra y confirmar las opciones disponibles.`,
    `Hi {{1}}, you chose ${offer.label} in your order. How is your supply of ${o.product}? If you need more, we can help you reorder and confirm the available options.`), [button.repeat, button.later, button.stop]))
  const last = template('ultimo_recordatorio', copy(
    `Hola {{1}}, este es el último recordatorio de este seguimiento de ${o.product}. Si necesitas reponer o tienes alguna duda, estamos aquí para ayudarte.`,
    `Hi {{1}}, this is the last reminder in this ${o.product} follow-up. We are here if you need more or have any questions.`), [button.repeat, button.help, button.stop])

  const tag = (id: string, add = true) => step(add ? 'add_tag' : 'remove_tag', { tag_id: id })
  const has = (id: string, yes: BuilderStepInput[], no: BuilderStepInput[] = []) => branch({ subject: 'tag_presence', operand: id }, yes, no)
  const send = (name: string, cooldown = 168) => step('send_template', { template_name: name, language: o.locale, variables: { '1': '{{vars.customer_name}}' }, cooldown_hours: cooldown })
  const guard = (suffix: BuilderStepInput[], checkPurchase = true): BuilderStepInput => has(o.tags.permission, [has(o.tags.paused, [], [
    ...(checkPurchase ? [branch({ subject: 'purchased', operand: 'since_trigger', value: 'true' }, [], suffix)] : suffix),
  ])])
  const scope = (suffix: BuilderStepInput[]) => branch({ subject: 'context_var', operand: 'retention_product', op: 'eq', value: o.product }, suffix)
  const commercialGuard = (suffix: BuilderStepInput[]) => branch({ subject: 'context_var', operand: 'retention_replenishment', op: 'eq', value: 'true' }, [guard(suffix)])
  const mainPath = (offer?: RetentionOffer): BuilderStepInput[] => {
    let suffix: BuilderStepInput[] = []
    if (offer) suffix = [branch({ subject: 'context_var', operand: 'retention_replenishment', op: 'eq', value: 'true' }, [wait(offer.day - 21), commercialGuard([
      step('set_context', { values: { stop_on_inbound: true } }), send(offers.get(offer.units)!), wait(7), commercialGuard([send(last)]),
    ])])]
    return [tag(o.tags.enrolled), wait(1), guard([send(received, 24), wait(6), guard([
      send(care, 24), wait(14), guard([send(experience, 168), ...suffix]),
    ])])]
  }
  // Experience at day 21 would suppress the day-22 offer through the weekly
  // marketing cap. Single-unit customers receive that check AS their offer.
  const singlePath = (offer: RetentionOffer): BuilderStepInput[] => [tag(o.tags.enrolled), wait(1), guard([
    send(received, 24), wait(6), guard([send(care, 24), branch({ subject: 'context_var', operand: 'retention_replenishment', op: 'eq', value: 'true' }, [wait(offer.day - 7), commercialGuard([
      step('set_context', { values: { stop_on_inbound: true } }), send(offers.get(offer.units)!), wait(7), commercialGuard([send(last)]),
    ])], [wait(14), guard([send(experience)])])]),
  ])]
  let selected: BuilderStepInput[] = mainPath()
  for (const offer of [...o.offers].reverse()) selected = [branch({ subject: 'context_var', operand: 'retention_units', op: 'eq', value: String(offer.units) }, offer.day < 28 ? singlePath(offer) : mainPath(offer), selected)]
  const flows: RetentionFlow[] = [{ key: 'main', name: copy('Recompras', 'Reorders'), trigger_type: 'shopify_order_delivered',
    trigger_config: { platforms: ['shopify'], retention_product: o.product, retention_replenishment: o.offers.length > 0, stop_on_inbound: true, retention_ai_managed: true, retention_permission_tag: o.tags.permission }, steps: [scope(selected)] }]
  return { templates: o.offers.length ? templates : templates.filter(t => [received, care, experience].includes(t.nombre)), flows }
}

export function clearRetentionProduct(steps: BuilderStepInput[]): void {
  for (const s of steps) {
    if (s.step_type === 'condition' && s.step_config.subject === 'context_var' && s.step_config.operand === 'retention_product') s.step_config.value = ''
    clearRetentionProduct(s.branches?.yes ?? [])
    clearRetentionProduct(s.branches?.no ?? [])
  }
}

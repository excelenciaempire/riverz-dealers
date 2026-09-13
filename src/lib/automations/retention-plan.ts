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
    `Hola {{1}}, ¿cómo va tu experiencia con ${o.product}? Si compartiste las unidades o prefieres que te recordemos más adelante, cuéntanos para ajustar el seguimiento.`,
    `Hi {{1}}, how is your experience with ${o.product}? If you shared your supply or would prefer a later reminder, let us know so we can adjust your follow-up.`) : copy(
    `Hola {{1}}, ¿cómo fue tu experiencia con ${o.product}? Si necesitas ayuda, estamos aquí.`,
    `Hi {{1}}, how was your experience with ${o.product}? We are here if you need help.`), o.offers.length ? [button.shared, button.later, button.help] : [button.help, button.stop])
  const offers = new Map<number, string>()
  for (const offer of o.offers) offers.set(offer.units, template(`reponer_${offer.units}`, copy(
    `Hola {{1}}, en tu pedido elegiste ${offer.label}. ¿Cómo vas con ${o.product}? Si necesitas reponer, podemos ayudarte a repetir tu compra y confirmar las opciones disponibles.`,
    `Hi {{1}}, you chose ${offer.label} in your order. How is your supply of ${o.product}? If you need more, we can help you reorder and confirm the available options.`), [button.repeat, button.later, button.stop]))
  const last = template('ultimo_recordatorio', copy(
    `Hola {{1}}, este es el último recordatorio de este seguimiento de ${o.product}. Si necesitas reponer, podemos ayudarte. Si todavía tienes, puedes elegir que te recordemos más adelante.`,
    `Hi {{1}}, this is the last reminder in this ${o.product} follow-up. We can help if you need more, or you can choose a later reminder if you still have some.`), [button.repeat, button.later, button.stop])
  const requested = template('recordatorio_solicitado', copy(
    `Hola {{1}}, volvemos a escribirte por ${o.product}, como nos pediste. ¿Necesitas reponer o prefieres esperar?`,
    `Hi {{1}}, this is the ${o.product} reminder you requested. Do you need more or would you prefer to wait?`), [button.repeat, button.later, button.stop])

  const tag = (id: string, add = true) => step(add ? 'add_tag' : 'remove_tag', { tag_id: id })
  const has = (id: string, yes: BuilderStepInput[], no: BuilderStepInput[] = []) => branch({ subject: 'tag_presence', operand: id }, yes, no)
  const send = (name: string, cooldown = 168) => step('send_template', { template_name: name, language: o.locale, variables: { '1': '{{vars.customer_name}}' }, cooldown_hours: cooldown })
  const guard = (suffix: BuilderStepInput[], checkPurchase = true): BuilderStepInput => has(o.tags.permission, [has(o.tags.paused, [], [
    ...(checkPurchase ? [branch({ subject: 'purchased', operand: 'since_trigger', value: 'true' }, [], suffix)] : suffix),
  ])])
  const scope = (suffix: BuilderStepInput[]) => branch({ subject: 'context_var', operand: 'first_item', op: 'eq', value: o.product }, suffix)
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
  for (const offer of [...o.offers].reverse()) selected = [branch({ subject: 'context_var', operand: 'offer_units', op: 'eq', value: String(offer.units) }, offer.day < 28 ? singlePath(offer) : mainPath(offer), selected)]
  const flows: RetentionFlow[] = [{ key: 'main', name: o.offers.length ? copy('Postventa y recompra', 'Post-purchase and replenishment') : copy('Acompañamiento postventa', 'Post-purchase care'), trigger_type: 'shopify_order_delivered',
    trigger_config: { platforms: ['shopify'], retention_product: o.product, retention_replenishment: o.offers.length > 0 }, steps: [scope(selected)] }]
  const keyword = (key: string, name: string, words: string[], actions: BuilderStepInput[], stopOnInbound = false) => flows.push({
    key, name, trigger_type: 'keyword_match', trigger_config: { keywords: words, match_type: 'exact', case_sensitive: false, stop_on_inbound: stopOnInbound }, steps: [has(o.tags.enrolled, actions)],
  })
  const text = (es: string, english: string) => step('send_message', { text: copy(es, english) })
  const assign = step('assign_conversation', { mode: 'round_robin' })
  keyword('help', copy('Postventa - atención', 'Post-purchase - support'), [button.help, button.shared], [tag(o.tags.paused), tag(o.tags.help), assign,
    text('Pausamos los recordatorios. Cuéntanos qué ocurrió o cuántas unidades conservas para que el equipo ajuste tu seguimiento.', 'We paused your reminders. Tell us what happened or how much you kept so our team can adjust your follow-up.')])
  keyword('later', copy('Postventa - elegir recordatorio', 'Post-purchase - choose reminder'), [button.later], [tag(o.tags.paused),
    text('Pausamos el seguimiento actual. Responde "Recordar en 15 días" o "Recordar en 30 días". Si prefieres otra fecha, cuéntanos.', 'We paused the current follow-up. Reply "Remind in 15 days" or "Remind in 30 days". Tell us if you prefer another date.')])
  keyword('stop', copy('Postventa - dejar recordatorios', 'Post-purchase - stop reminders'), [button.stop], [tag(o.tags.paused), tag(o.tags.permission, false),
    text('Listo. Dejamos de enviarte estos recordatorios.', 'Done. We will stop these reminders.')])
  keyword('repeat', copy('Postventa - repetir compra', 'Post-purchase - reorder'), [button.repeat], [tag(o.tags.paused),
    text('Te ayudamos a repetir tu compra. Confirmaremos cantidad, precio vigente, dirección y entrega antes de crear el pedido.', 'We can help you reorder. We will confirm quantity, the current price, address and delivery before creating an order.')])
  for (const days of [15, 30]) keyword(`later_${days}`, copy(`Postventa - recordar en ${days} días`, `Post-purchase - remind in ${days} days`), [copy(`Recordar en ${days} días`, `Remind in ${days} days`)], [
    has(o.tags.permission, [tag(o.tags.paused), text(`Te recordaremos en ${days} días si no has vuelto a comprar.`, `We will remind you in ${days} days if you have not ordered again.`), wait(days),
      has(o.tags.permission, [has(o.tags.help, [], [branch({ subject: 'purchased', operand: 'since_trigger', value: 'true' }, [], [branch({ subject: 'context_var', operand: 'retention_replenishment', op: 'eq', value: 'true' }, [send(requested)])])])]),
    ]),
  ], true)
  for (const event of ['shopify_order_cancelled', 'shopify_order_refunded']) flows.push({ key: event, name: copy('Postventa - suspender por devolución o cancelación', 'Post-purchase - pause for return or cancellation'),
    trigger_type: event, trigger_config: { platforms: ['shopify'] }, steps: [scope([has(o.tags.enrolled, [tag(o.tags.paused), tag(o.tags.help)])])] })
  if (!o.offers.length) {
    const careKeys = new Set(['main', 'help', 'stop', 'shopify_order_cancelled', 'shopify_order_refunded'])
    return { templates: templates.filter(t => [received, care, experience].includes(t.nombre)), flows: [combineRetentionFlows(flows.filter(f => careKeys.has(f.key)))] }
  }
  return { templates, flows: [combineRetentionFlows(flows)] }
}

/** Event branches remain visible/editable in the same canvas. No hidden child automations. */
export function combineRetentionFlows(flows: RetentionFlow[]): RetentionFlow {
  const main = flows.find(f => f.key === 'main')
  if (!main) throw new Error('Retention main branch required')
  return { ...main, trigger_config: { ...main.trigger_config,
    event_triggers: [...new Set(flows.map(f => f.trigger_type))],
    event_entries: flows.map(f => ({ key: f.key, trigger_type: f.trigger_type, trigger_config: f.trigger_config })),
  }, steps: flows.map(f => branch({ subject: 'context_var', operand: 'automation_entry', op: 'eq', value: f.key }, f.steps)) }
}

export function clearRetentionProduct(steps: BuilderStepInput[]): void {
  for (const s of steps) {
    if (s.step_type === 'condition' && s.step_config.subject === 'context_var' && s.step_config.operand === 'first_item') s.step_config.value = ''
    clearRetentionProduct(s.branches?.yes ?? [])
    clearRetentionProduct(s.branches?.no ?? [])
  }
}

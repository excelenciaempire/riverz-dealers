/**
 * Idempotent provisioning for DeUNA Shop.
 *
 * It enriches the first product, configures a multi-product customer-service
 * agent, creates a recovery agent, and arms the WhatsApp automations. Arming
 * is deliberate: until WhatsApp is connected and every template is approved,
 * the activation gate keeps each flow physically disabled.
 *
 * Run with: npx tsx scripts/provision-deuna-shop.ts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const WORKSPACE_ID = '36f81b96-41b9-4d29-b72e-11be3d3070a3'
const PRODUCT_ID = '0c7b66dd-9b12-4deb-bf4f-303c9e3d81bd'
const GENERAL_AGENT = 'Asesora de DeUNA Shop'
const RECOVERY_AGENT = 'DeUNA Shop · Recuperación'

function loadEnv() {
  const values: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

const env = loadEnv()
Object.assign(process.env, env)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}
const siteBase = /^https:\/\//i.test(env.NEXT_PUBLIC_SITE_URL ?? '') &&
  !/localhost|127\.0\.0\.1/i.test(env.NEXT_PUBLIC_SITE_URL ?? '')
  ? env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')
  : 'https://riverz.co'
const dynamicCheckoutButtonUrl = `${siteBase}/r/{{1}}`
const dynamicTrackingButtonUrl = `${siteBase}/r/{{1}}`

const productFaqs = [
  { q: '¿Cómo se usa el Saltarín LED?', a: 'Coloca ambos pies sobre la base, sujeta el mango y comienza con saltos cortos sobre una superficie plana y despejada. Se recomienda supervisión adulta.' },
  { q: '¿Las luces necesitan pilas?', a: 'Las luces se activan con el movimiento. No confirmamos batería ni mecanismo interno si esa información no aparece en la ficha vigente del producto.' },
  { q: '¿Qué modelos hay disponibles?', a: 'El catálogo maneja Panda Blanco, Cerdita Rosa, Cerdo Blanco, Rana Verde, Oso Rosado y Capibara Café. La disponibilidad cambia; siempre revisamos el inventario actual antes de confirmar.' },
  { q: '¿Qué incluye la compra?', a: 'Incluye el Saltarín LED de la variante elegida. Si necesitas confirmar bomba, repuestos u otros accesorios, revisamos la ficha actual antes de prometerlos.' },
  { q: '¿Sirve para interiores y exteriores?', a: 'Sí, puede usarse en ambos espacios siempre que el piso sea plano, firme, seco y esté libre de objetos o desniveles.' },
  { q: '¿Cómo se infla y se arma?', a: 'Infla con suavidad y sin forzar el tapón. Al armarlo, deja hacia arriba la parte de la esfera donde está el orificio de aire para reducir el riesgo de fuga.' },
  { q: '¿De qué material está hecho?', a: 'La ficha lo describe como una combinación de polipropileno y PVC. Evita objetos puntiagudos, calor y superficies abrasivas.' },
  { q: '¿Cuál es la edad o el peso máximo?', a: 'No damos una edad ni un peso máximo sin verificar la etiqueta o ficha oficial de la variante. Un adulto debe revisar que el tamaño y el uso sean adecuados para el niño.' },
  { q: '¿Cómo se paga?', a: 'Por ahora la tienda trabaja con pago contraentrega: pagas al recibir el pedido. El pedido queda pendiente de pago hasta la entrega, lo cual es normal.' },
  { q: '¿El envío es gratis?', a: 'La ficha actual ofrece envío gratis en Colombia. Antes de cerrar la compra confirmamos cobertura y condiciones para la dirección indicada.' },
  { q: '¿Qué hago si llega con una fuga o una pieza dañada?', a: 'Conserva el empaque y envíanos fotos o video del producto y la guía. El equipo revisará el caso y te indicará el proceso aplicable.' },
  { q: '¿Puedo devolverlo?', a: 'Cuéntanos el motivo y la fecha de entrega. Un asesor revisará el caso según la política vigente y los derechos aplicables; no prometemos aprobación automática.' },
]

const research = 'Juguete de movimiento para niños que combina saltos con luces LED y busca ofrecer una alternativa activa al tiempo de pantalla. Las dudas principales son seguridad, edad y peso admitidos, armado, fugas, variantes, inventario y pago contraentrega. La venta debe apoyarse en la diversión, el movimiento y el uso interior o exterior, sin convertir beneficios generales de actividad física en promesas médicas. Antes de confirmar una compra se consultan precio, variante, inventario y cobertura vigentes.'

const differentiators = [
  'Luces LED que se encienden durante el salto.',
  'Juego activo que practica equilibrio y coordinación de forma recreativa.',
  'Uso en interiores o exteriores sobre una superficie segura.',
  'Diseño ligero y transportable en seis modelos visuales.',
  'Ofertas vigentes de una, dos y tres unidades para comprar en familia o regalar.',
]

const objections = [
  { objection: 'Me preocupa que se rompa o pierda aire.', rebuttal: 'Está hecho en PP y PVC, pero debe inflarse con suavidad, sin forzar el tapón y evitando superficies abrasivas u objetos puntiagudos.' },
  { objection: 'No sé si es adecuado para la edad o el peso del niño.', rebuttal: 'No adivinamos límites. Verificamos la etiqueta o la ficha oficial de la variante y recomendamos supervisión adulta.' },
  { objection: 'No quiero pagar antes de recibir.', rebuttal: 'La tienda trabaja por ahora con pago contraentrega: el pago se realiza al recibir, sujeto a cobertura.' },
  { objection: 'Quiero un modelo específico.', rebuttal: 'Revisamos en vivo cuál de los seis modelos reales está disponible antes de confirmar.' },
  { objection: '¿Realmente reemplaza el ejercicio?', rebuttal: 'Es un juego activo y divertido; no sustituye actividad física variada, deporte ni recomendaciones profesionales.' },
]

const neverSay = [
  'Nunca afirmar que previene, trata o corrige problemas médicos, de desarrollo, equilibrio o coordinación.',
  'Nunca inventar edad recomendada, capacidad máxima, medidas, accesorios incluidos, autonomía de luces o certificaciones.',
  'Nunca prometer que no se rompe, no pierde aire o dura para siempre.',
  'Nunca confirmar inventario, precio, plazo de entrega o cobertura sin consultar los datos vigentes.',
  'Nunca decir que un pedido contraentrega está pagado antes de que el cobro sea registrado.',
  'Nunca revelar Dropi, tokens, proveedores internos o detalles operativos que el cliente no necesita.',
]

const escalation = [
  'Lesión, accidente o sospecha de defecto que pueda afectar la seguridad.',
  'Producto recibido roto, con fuga, incompleto o distinto al pedido.',
  'Solicitud de cancelación, retracto, devolución, garantía o reembolso.',
  'Amenaza, denuncia, fraude, contracargo o reclamo legal.',
  'Datos de edad, peso, medidas o certificaciones que no estén en la ficha oficial.',
]

const customNotes = `Operación DeUNA Shop
- Colombia; precios en COP.
- Por ahora el único medio de pago es contraentrega. En Shopify es normal que el pedido permanezca pendiente/no pagado hasta que el transportador cobre al entregar.
- Antes de crear un pedido confirma nombre, teléfono, dirección completa, ciudad/municipio, departamento, referencia de entrega, variante y cantidad. Resume todo y pide un sí explícito.
- El envío gratis solo se comunica mientras la ficha vigente lo indique y exista cobertura.
- Consulta siempre producto, oferta e inventario en vivo. No uses cantidades históricas del catálogo.
- “Para niña” y “para niño” expresan una preferencia, no son variantes. No asocies género con un color o modelo: muestra los modelos reales disponibles y pide que el cliente elija uno si no indicó un nombre exacto.
- La tienda venderá varios productos: identifica primero cuál interesa y carga su ficha; no traslades datos del Saltarín a otros productos.
- Dropi es una herramienta logística interna. Su integración actual actualiza Shopify al generar la guía, cancelar, rechazar y entregar; Riverz recibe esos cambios desde Shopify. No prometas otro estado hasta verlo allí.
- Si el cliente reporta novedad logística, daño, devolución o cancelación, abre el caso y pásalo a una persona.`

const templates = [
  {
    name: 'deuna_confirmacion_datos_v2', category: 'Utility', body: `Hola, {{1}}. Recibimos tu pedido {{2}} en DeUNA Shop.

Productos: {{3}}
Total contraentrega: {{4}} COP
Dirección: {{5}}
Teléfono: {{6}}

Revisa estos datos. Pulsa CONFIRMAR si son correctos o CORREGIR para indicarnos el cambio. Si falta algún dato, pulsa CORREGIR.`,
    buttons: [{ type: 'QUICK_REPLY', text: 'CONFIRMAR' }, { type: 'QUICK_REPLY', text: 'CORREGIR' }],
    samples: ['Alicia', '#1001', '1 × Cerdita Rosa', '110000', 'Calle 123, Bogotá', '3001234567'],
    variable_fields: { '1': 'recipient_name', '2': 'order_number', '3': 'order_items', '4': 'total_price', '5': 'delivery_address', '6': 'delivery_phone' },
  },
  {
    name: 'deuna_recordatorio_datos_v2', category: 'Utility', body: `DeUNA Shop: ¿los datos de tu pedido {{1}} son correctos?

Revisa el resumen que te enviamos. Pulsa CONFIRMAR o CORREGIR para que podamos ayudarte.`,
    buttons: [{ type: 'QUICK_REPLY', text: 'CONFIRMAR' }, { type: 'QUICK_REPLY', text: 'CORREGIR' }],
    samples: ['#1001'], variable_fields: { '1': 'order_number' },
  },
  {
    name: 'deuna_revision_datos_v2', category: 'Utility', body: `DeUNA Shop: seguimos disponibles para revisar los datos de tu pedido {{1}}.

Pulsa CONFIRMAR si el resumen es correcto o CORREGIR si necesitas un cambio. Si deseas cancelarlo, escríbenos para revisar su estado.`,
    buttons: [{ type: 'QUICK_REPLY', text: 'CONFIRMAR' }, { type: 'QUICK_REPLY', text: 'CORREGIR' }],
    samples: ['#1001'], variable_fields: { '1': 'order_number' },
  },
  {
    name: 'deuna_carrito_pendiente_1', category: 'Marketing', body: `Guardamos los productos que elegiste.

Puedes retomar tu compra y pagar contraentrega al recibir.`,
    buttons: [{ type: 'URL', text: 'Retomar compra', url: dynamicCheckoutButtonUrl, url_variable: 'abandoned_checkout' }],
  },
  {
    name: 'deuna_carrito_pendiente_2', category: 'Marketing', body: `Tu carrito sigue disponible.

Revisa los productos y la disponibilidad actual antes de terminar tu compra.`,
    buttons: [{ type: 'URL', text: 'Ver mi carrito', url: dynamicCheckoutButtonUrl, url_variable: 'abandoned_checkout' }],
  },
  {
    name: 'deuna_pedido_despachado_v2', category: 'Utility', body: `¡Buenas noticias! Tu pedido {{1}} ya está en camino. 🚚✨

Transportadora: {{2}}
Guía: {{3}}

Pulsa el botón para seguir su recorrido. Si necesitas ayuda, escríbenos por aquí.`,
    buttons: [{ type: 'URL', text: 'Rastrear mi pedido', url: dynamicTrackingButtonUrl, url_variable: 'tracking' }],
    samples: ['#1004', 'Envía', '024034940186'], variable_fields: { '1': 'order_number', '2': 'tracking_company', '3': 'tracking_number' },
  },
  {
    name: 'deuna_pedido_entregado', category: 'Utility', body: `Tu pedido {{1}} aparece como entregado.

¿Lo recibiste en buen estado? Responde este mensaje si necesitas ayuda.`,
    samples: ['#1001'], variable_fields: { '1': 'order_number' },
  },
  {
    name: 'deuna_pedido_cancelado', category: 'Utility', body: `Tu pedido {{1}} fue cancelado.

Si no solicitaste la cancelación o necesitas ayuda, responde este mensaje.`,
    samples: ['#1001'], variable_fields: { '1': 'order_number' },
  },
]

type Step = {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: Step[]; no?: Step[] }
}
const template = (name: string, variables: Record<string, string> = {}): Step => ({
  step_type: 'send_template', step_config: { template_name: name, language: 'es', variables },
})
const wait = (amount: number, unit: string): Step => ({ step_type: 'wait', step_config: { amount, unit } })
const condition = (step_config: Record<string, unknown>, yes: Step[], no: Step[]): Step => ({
  step_type: 'condition', step_config, branches: { yes, no },
})

async function seedSteps(automationId: string, tree: Step[]) {
  const rows: Array<Record<string, unknown>> = []
  const walk = (steps: Step[], parent: string | null = null, branch: string | null = null) => {
    steps.forEach((step, position) => {
      const id = crypto.randomUUID()
      rows.push({ id, automation_id: automationId, parent_step_id: parent, branch, position, step_type: step.step_type, step_config: step.step_config })
      if (step.branches) {
        walk(step.branches.yes ?? [], id, 'yes')
        walk(step.branches.no ?? [], id, 'no')
      }
    })
  }
  walk(tree)
  const { error } = await db.from('automation_steps').insert(rows)
  fail(error)
}

async function upsertAgent(name: string, payload: Record<string, unknown>) {
  const { data: old, error: lookupError } = await db.from('ai_agents')
    .select('id').eq('workspace_id', WORKSPACE_ID).eq('name', name).is('deleted_at', null).maybeSingle()
  fail(lookupError)
  const full = { ...payload, workspace_id: WORKSPACE_ID, name }
  const { data, error } = old
    ? await db.from('ai_agents').update(full).eq('id', old.id).select('id').single()
    : await db.from('ai_agents').insert(full).select('id').single()
  fail(error)
  if (!data) throw new Error(`No se pudo guardar el agente ${name}.`)
  return String(data.id)
}

async function upsertAutomation(ownerId: string, agentId: string, definition: {
  name: string; description: string; trigger_type: string; trigger_config?: Record<string, unknown>; steps: Step[]
}) {
  const { data: old, error: lookupError } = await db.from('automations')
    .select('id').eq('workspace_id', WORKSPACE_ID).eq('name', definition.name).is('deleted_at', null).maybeSingle()
  fail(lookupError)
  const payload = {
    workspace_id: WORKSPACE_ID, user_id: ownerId, name: definition.name,
    description: definition.description, trigger_type: definition.trigger_type,
    trigger_config: { ...(definition.trigger_config ?? {}), handoff_ai_agent_id: agentId },
    is_active: false, activation_state: 'draft', activation_blockers: [],
  }
  const { data, error } = old
    ? await db.from('automations').update(payload).eq('id', old.id).select('id').single()
    : await db.from('automations').insert(payload).select('id').single()
  fail(error)
  if (!data) throw new Error(`No se pudo guardar la automatización ${definition.name}.`)
  const id = String(data.id)
  const { error: deleteError } = await db.from('automation_steps').delete().eq('automation_id', id)
  fail(deleteError)
  await seedSteps(id, definition.steps)
  return id
}

async function main() {
  const [{ buildTrainingMaterial }, { armAutomation }] = await Promise.all([
    import('@/lib/products/training-material'),
    import('@/lib/automations/activation'),
  ])

  const { data: member, error: memberError } = await db.from('workspace_members')
    .select('user_id').eq('workspace_id', WORKSPACE_ID).limit(1).single()
  fail(memberError)
  if (!member) throw new Error('No se encontró un miembro de DeUNA Shop.')
  const ownerId = String(member.user_id)

  const { data: product, error: productError } = await db.from('shopify_products')
    .select('*').eq('id', PRODUCT_ID).eq('workspace_id', WORKSPACE_ID).single()
  fail(productError)
  const productUpdate = {
    custom_notes: customNotes,
    custom_faqs: productFaqs,
    ai_generated_faqs: [],
    ai_research: research,
    structured_research: { differentiators, objections, sources: [
      'https://talego.com.co/producto/pelota-saltarina-led-juego-ninos/',
      'https://www.who.int/publications/i/item/9789240015128',
      'https://www.cpsc.gov/Safety-Education/Safety-Education-Materials',
    ] },
    say_guidelines: 'Enfatiza diversión activa, luces LED, modelos disponibles, pago contraentrega y ofertas vigentes. Verifica inventario, precio, cobertura y datos del pedido antes de confirmar.',
    never_say: neverSay,
    escalation_triggers: escalation,
    ai_research_generated_at: new Date().toISOString(),
    ai_research_status: 'done',
    ai_research_error: null,
  }
  const trainingMaterial = buildTrainingMaterial({ ...product, ...productUpdate }, 'es')
  const { error: updateProductError } = await db.from('shopify_products')
    .update({ ...productUpdate, training_material: trainingMaterial }).eq('id', PRODUCT_ID).eq('workspace_id', WORKSPACE_ID)
  fail(updateProductError)

  for (const item of templates) {
    const { data: old, error: oldError } = await db.from('message_templates')
      .select('id, status').eq('workspace_id', WORKSPACE_ID).eq('name', item.name).eq('language', 'es').maybeSingle()
    fail(oldError)
    if (old && String(old.status).toLowerCase() !== 'draft') continue
    const payload = {
      workspace_id: WORKSPACE_ID, user_id: ownerId, name: item.name, language: 'es', category: item.category,
      body_text: item.body, buttons: item.buttons ?? null, variable_samples: item.samples ?? null,
      variable_fields: item.variable_fields ?? null, status: 'Draft', meta_template_id: null,
      rejected_reason: null, updated_at: new Date().toISOString(),
    }
    const { error } = old
      ? await db.from('message_templates').update(payload).eq('id', old.id)
      : await db.from('message_templates').insert(payload)
    fail(error)
  }

  const commonPersona = 'Eres la asesora de DeUNA Shop. Hablas en español neutro de Colombia, con mensajes breves, claros y amables. La tienda tendrá varios productos: primero identifica el producto y consulta su ficha vigente. Nunca inventas precio, inventario, variantes, cobertura, tiempos, especificaciones ni estado de un pedido. “Para niña” y “para niño” son preferencias, no nombres de variante: no asocies género con colores o modelos; si el cliente no indicó un modelo exacto, muestra los modelos reales disponibles y pregunta cuál prefiere. Para pedidos contraentrega recopilas nombre, teléfono, dirección completa, ciudad, departamento, referencia, producto, variante y cantidad; muestras un resumen y solo creas el pedido después de un sí explícito. Una solicitud de devolución, garantía, cancelación o reclamo serio se registra y pasa a una persona. Antes de crear un pedido busca si ya existe: CONFIRMAR un pedido existente nunca crea otro. Lee toda la conversación, incluidos audios, imágenes y mensajes del equipo. Una corrección posterior invalida cualquier confirmación anterior hasta que la lista final vuelva a quedar clara. Revisa siempre las ofertas vigentes: si el checkout tiene menos unidades de las que incluye la promoción, confirma referencias y tallas, corrige las líneas reales de Shopify y verifica el resultado antes de contestar. Nunca uses notas al proveedor para corregir productos, variantes o cantidades. Una corrección de dirección o cancelación requiere intervención humana y comprobación en Dropi. Si el pedido ya fue enviado a Dropi, una edición de Shopify no prueba que Dropi se actualizó. Nunca afirmes que puedes liberar, retener, corregir o cancelar automáticamente el despacho en Dropi sin una operación verificada allí. PROTOCOLO DE BOTONES: CONFIRMAR significa que el cliente valida los datos del resumen, no un cambio de estado logístico. Agradece la compra y la confirmación de los datos, indica que se le avisará por este medio cuando exista una actualización de envío y recuérdale que puede escribir si tiene preguntas. No digas que ya fue despachado ni prometas una fecha sin consultar y verificar ese estado. No crees otro pedido. CORREGIR: pregunta únicamente qué dato necesita cambiar; no afirmes haberlo cambiado hasta una operación exitosa y verificada. Nunca prometas que una derivación ya ocurrió sin ejecutarla.'
  const tools = {
    buscar_producto: 'auto', ver_producto: 'auto', lookup_order: 'auto', crear_pedido: 'auto',
    crear_checkout: 'auto', crear_link_de_pago: 'off', ofrecer_descuento: 'off', registrar_pago: 'off',
    editar_pedido: 'auto', cancelar_pedido: 'aprobacion', reembolsar: 'off', abrir_devolucion: 'auto',
    escalar_llamada: 'off', enviar_proactivo: 'auto', buscar_en_internet: 'off', no_se_la_respuesta: 'auto',
    ver_contacto: 'auto', etiquetar_contacto: 'auto', cerrar_conversacion: 'auto',
  }
  const permissions = { crear_pedidos: true, crear_checkout: true, registrar_pago: false, editar_pedido: true, escalar_llamada: false, enviar_proactivo: true }
  const generalId = await upsertAgent(GENERAL_AGENT, {
    is_active: true, assigned_only: false, role: 'general', scope: 'workspace', product_scope: 'all',
    language: 'es', tone: 'friendly', response_mode: 'dynamic', max_response_chars: 500,
    reply_delay_seconds: 2, inbound_debounce_seconds: 8, context_messages: 30,
    reply_when_assigned: true, reply_outside_hours: true, persona: commonPersona,
    knowledge: 'DeUNA Shop vende productos de consumo en Colombia. El medio de pago actual es únicamente contraentrega. Shopify es la fuente de productos, pedidos y seguimiento disponible en Riverz. Dropi actualiza Shopify cuando genera la guía, cancela, rechaza o entrega un pedido; consulta siempre el estado vigente en Shopify y no prometas un cambio antes de verlo allí.',
    permissions, tools, puede_crear_pedidos: true, cobro_modo: 'chat', medios_pago: ['contraentrega'],
    proactive_send_mode: 'hybrid_intent', requires_approval: false, created_by: ownerId, updated_by: ownerId,
    escalate_keywords: ['lesión', 'accidente', 'denuncia', 'abogado', 'estafa', 'devolución', 'garantía', 'reembolso'],
  })
  const recoveryId = await upsertAgent(RECOVERY_AGENT, {
    is_active: true, assigned_only: true, role: 'recuperacion', scope: 'channels', product_scope: 'all',
    language: 'es', tone: 'friendly', response_mode: 'single', max_response_chars: 500,
    reply_delay_seconds: 2, inbound_debounce_seconds: 8, context_messages: 30,
    reply_when_assigned: true, reply_outside_hours: true,
    persona: `${commonPersona} Te ocupas únicamente de pedidos o carritos que una automatización te entregó. No ofreces descuentos.`,
    knowledge: 'Recupera la compra sin presionar. La única forma de pago actual es contraentrega. Si el cliente no quiere continuar, lo confirma y detienes la gestión.',
    permissions: { crear_pedidos: false, crear_checkout: true, registrar_pago: false, editar_pedido: false, escalar_llamada: false, enviar_proactivo: true },
    tools: { ...tools, crear_pedido: 'off', editar_pedido: 'off', cancelar_pedido: 'off', abrir_devolucion: 'off' },
    puede_crear_pedidos: false, cobro_modo: 'checkout', medios_pago: ['contraentrega'],
    proactive_send_mode: 'hybrid_intent', requires_approval: false, created_by: ownerId, updated_by: ownerId,
  })
  const { error: channelError } = await db.from('ai_agent_channels').upsert({ agent_id: recoveryId, channel: 'whatsapp' })
  fail(channelError)

  const guidance = [
    ['deuna_cod', 'Pago contraentrega', 'Cuando pregunten por pago o se cierre una venta', 'El único medio actual es pago contraentrega. No marques ni describas el pedido como pagado antes de que el cobro se registre después de la entrega.'],
    ['deuna_verify', 'Confirmación antes de crear', 'Antes de crear un pedido por chat', 'Verifica todos los datos, resume producto, variante, cantidad y dirección, y pide confirmación explícita.'],
    ['deuna_live_data', 'Datos vigentes', 'Cuando hables de catálogo, envío o pedidos', 'Consulta las herramientas de producto o pedido. No uses inventario, precios, fechas ni estados recordados.'],
    ['deuna_dropi', 'Dropi es interno', 'Cuando hablen de logística', 'Usa el estado visible en Shopify, que recibe guía, cancelación, rechazo y cierre por entrega desde Dropi. No menciones Dropi ni prometas un estado antes de verlo actualizado.'],
    ['deuna_variants', 'Preferencias y modelos', 'Cuando el cliente diga para niña, para niño, un color o un modelo', 'Trata niña o niño como una preferencia, no como una variante. Consulta todas las variantes reales publicadas y disponibles. No asocies género con colores o modelos; si no hay una coincidencia exacta y única, muestra las opciones disponibles y pregunta cuál prefiere.'],
    ['deuna_offer_reconcile', 'Ofertas y correcciones', 'Cuando el pedido no coincida con la oferta o el cliente cambie referencias, colores o tallas', 'Lee toda la conversación y su evidencia. Calcula las unidades que incluye la oferta vigente, confirma únicamente los datos faltantes y corrige las líneas reales de Shopify con las variantes exactas. Verifica el pedido después de guardar. Nunca uses notas al proveedor para suplir líneas incorrectas ni afirmes que Dropi se sincronizó sin comprobarlo allí.'],
    ['deuna_safety', 'Seguridad infantil', 'Cuando pregunten por uso, edad, peso o seguridad', 'Recomienda supervisión adulta, superficie plana y despejada e inflado suave. Escala límites no documentados, accidentes y defectos de seguridad.'],
  ]
  for (let i = 0; i < guidance.length; i++) {
    const [clave, titulo, cuando, hacer] = guidance[i]
    const { data: old } = await db.from('agent_guidance').select('id').eq('workspace_id', WORKSPACE_ID).eq('clave', clave).maybeSingle()
    const payload = { workspace_id: WORKSPACE_ID, agent_id: null, clave, titulo, cuando, hacer, activa: true, orden: i + 1, origen: 'comercio' }
    const { error } = old
      ? await db.from('agent_guidance').update(payload).eq('id', old.id)
      : await db.from('agent_guidance').insert(payload)
    fail(error)
  }

  const { error: checkoutError } = await db.from('workspace_checkout_config').upsert({
    workspace_id: WORKSPACE_ID, max_discount_percent: 0,
  }, { onConflict: 'workspace_id' })
  fail(checkoutError)

  const flows = [
    {
      name: 'DeUNA Shop · Confirmación contraentrega',
      description: 'Confirma cada pedido contraentrega y detiene los recordatorios cuando el cliente responde.',
      trigger_type: 'shopify_order_created', trigger_config: { stop_on_inbound: true },
      steps: [
        template('deuna_confirmacion_datos_v2', {
          '1': '{{vars.recipient_name}}', '2': '{{vars.order_number}}', '3': '{{vars.order_items}}',
          '4': '{{vars.total_price}}', '5': '{{vars.delivery_address}}', '6': '{{vars.delivery_phone}}',
        }),
        wait(3, 'hours'), template('deuna_recordatorio_datos_v2', { '1': '{{vars.order_number}}' }),
        wait(21, 'hours'), template('deuna_revision_datos_v2', { '1': '{{vars.order_number}}' }),
      ],
    },
    {
      name: 'DeUNA Shop · Carrito pendiente',
      description: 'Recupera el carrito sin descuentos y se detiene si el cliente compra.',
      trigger_type: 'shopify_abandoned_checkout', trigger_config: { stop_on_inbound: true },
      steps: [wait(1, 'hours'), condition({ subject: 'purchased', operand: 'since_trigger', value: 'true' }, [], [
        template('deuna_carrito_pendiente_1'), wait(23, 'hours'),
        condition({ subject: 'purchased', operand: 'since_trigger', value: 'true' }, [], [template('deuna_carrito_pendiente_2')]),
      ])],
    },
    {
      name: 'DeUNA Shop · Pedido despachado',
      description: 'Envía la guía cuando Shopify marca el pedido como preparado y despachado.',
      trigger_type: 'shopify_order_fulfilled', steps: [template('deuna_pedido_despachado_v2', {
        '1': '{{vars.order_number}}', '2': '{{vars.tracking_company}}', '3': '{{vars.tracking_number}}',
      })],
    },
    {
      name: 'DeUNA Shop · Pedido entregado',
      description: 'Comprueba la recepción cuando Shopify emite un evento de entrega.',
      trigger_type: 'shopify_order_delivered', steps: [template('deuna_pedido_entregado', { '1': '{{vars.order_number}}' })],
    },
    {
      name: 'DeUNA Shop · Pedido cancelado',
      description: 'Informa la cancelación y abre la conversación si el cliente necesita ayuda.',
      trigger_type: 'shopify_order_cancelled', trigger_config: { stop_on_inbound: true },
      steps: [template('deuna_pedido_cancelado', { '1': '{{vars.order_number}}' })],
    },
  ]
  const readiness: Array<{ name: string; state: string; blockers: string[] }> = []
  for (const flow of flows) {
    const agentId = flow.trigger_type === 'shopify_abandoned_checkout' ? recoveryId : generalId
    const id = await upsertAutomation(ownerId, agentId, flow)
    const result = await armAutomation(db, id, WORKSPACE_ID)
    readiness.push({ name: flow.name, state: result.state, blockers: result.issues.map((issue) => issue.path) })
  }

  console.log(JSON.stringify({ ok: true, product: PRODUCT_ID, agents: [generalId, recoveryId], templates: templates.length, automations: readiness }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

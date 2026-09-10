import type { Namespace } from './types';
export const pitch = {
  canvas: { es: 'Canvas completo', en: 'Complete canvas' },
  canvasNavigate: {
    es: 'Ir a una automatización o etapa',
    en: 'Go to an automation or stage',
  },
  canvasSearch: {
    es: 'Buscar escenario o mensaje',
    en: 'Find a scenario or message',
  },
  canvasNodes: { es: 'nodos', en: 'nodes' },
  canvasCases: { es: 'escenarios', en: 'scenarios' },
  canvasControls: {
    es: 'Mapa de automatizaciones. Flechas para mover, más y menos para zoom, cero para ver todo.',
    en: 'Automation map. Arrow keys to pan, plus and minus to zoom, zero to fit all.',
  },
  canvasFocus: { es: 'Acercar', en: 'Focus' },
  canvasMatches: { es: 'coincidencias', en: 'matches' },
  canvasPrevious: { es: 'Escenario anterior', en: 'Previous scenario' },
  canvasNext: { es: 'Siguiente escenario', en: 'Next scenario' },
  canvasZoomOut: { es: 'Alejar', en: 'Zoom out' },
  canvasZoomIn: { es: 'Acercar mapa', en: 'Zoom in' },
  canvasFit: { es: 'Ver todo el canvas', en: 'Fit entire canvas' },
  canvasMinimap: {
    es: 'Minimapa: pulsa para desplazarte',
    en: 'Minimap: click to navigate',
  },
  canvasHint: {
    es: 'Arrastra el fondo · Ctrl + rueda para zoom · Los ejemplos ilustran la configuración; no son un historial de envíos.',
    en: 'Drag the background · Ctrl + wheel to zoom · Examples illustrate configuration; they are not a delivery log.',
  },
  canvasResult: { es: 'Resultado', en: 'Outcome' },
  canvasStep: { es: 'Paso', en: 'Step' },
  canvasEnd: { es: 'Fin de esta ejecución', en: 'End of this run' },
  canvasNoMessage: {
    es: 'Sin mensaje automático en este caso',
    en: 'No automated message in this case',
  },
  canvasStopReply: {
    es: 'Si el cliente responde, se detiene la secuencia pendiente.',
    en: 'If the customer replies, the pending sequence stops.',
  },
  canvasWait: { es: 'Esperar', en: 'Wait' },
  canvasBenefit: {
    es: 'Guardar beneficio en contexto:',
    en: 'Store benefit in context:',
  },
  canvas_seconds: { es: 'segundos', en: 'seconds' },
  canvas_minutes: { es: 'minutos', en: 'minutes' },
  canvas_hours: { es: 'horas', en: 'hours' },
  canvas_yes: { es: 'Sí', en: 'Yes' },
  canvas_no: { es: 'No', en: 'No' },
  canvas_example: { es: 'Ejemplo / relación', en: 'Example / relationship' },
  canvas_paid: { es: '¿El pedido está pagado?', en: 'Is the order paid?' },
  canvas_pending: { es: '¿El pago está pendiente?', en: 'Is payment pending?' },
  'canvas_Cash on Delivery': {
    es: '¿El medio de pago es contraentrega?',
    en: 'Is the payment method cash on delivery?',
  },
  canvas_purchased_false: {
    es: '¿Sigue sin comprar desde que empezó el flujo?',
    en: 'Still no purchase since the flow started?',
  },
  canvas_purchased_true: {
    es: '¿Compró desde que empezó el flujo?',
    en: 'Purchased since the flow started?',
  },
  canvas_order_paid_false: {
    es: '¿El pedido sigue sin pagar?',
    en: 'Is the order still unpaid?',
  },
  canvas_messaged_false: {
    es: '¿No recibió otra plantilla en este período?',
    en: 'No other template received in this period?',
  },
  canvas_rejected_open_false: {
    es: '¿No tiene un pago rechazado sin resolver?',
    en: 'No unresolved rejected payment?',
  },
  canvas_rejected_open_true: {
    es: '¿Tiene un pago rechazado sin resolver?',
    en: 'Has an unresolved rejected payment?',
  },
  canvas_add_tag: {
    es: 'Actualizar etiqueta de seguimiento',
    en: 'Update follow-up tag',
  },
  canvas_send_template: {
    es: 'Enviar plantilla de WhatsApp',
    en: 'Send WhatsApp template',
  },
  canvas_voice_call: {
    es: 'Llamada de prueba para confirmar contraentrega',
    en: 'Test call to confirm cash on delivery',
  },
  canvas_shopify_order_created: {
    es: 'Shopify: se crea un pedido',
    en: 'Shopify: an order is created',
  },
  canvas_shopify_abandoned_checkout: {
    es: 'Shopify: checkout abandonado',
    en: 'Shopify: abandoned checkout',
  },
  canvas_payment_rejected: {
    es: 'Evento: pago rechazado',
    en: 'Event: payment rejected',
  },
  canvas_shopify_order_fulfilled: {
    es: 'Shopify: pedido preparado / despachado',
    en: 'Shopify: order fulfilled',
  },
  canvasOrder: { es: 'Nuevo pedido', en: 'New order' },
  canvasCart: { es: 'Carrito abandonado', en: 'Abandoned cart' },
  canvasCartDraft: {
    es: 'Carrito · propuesta de tres intentos',
    en: 'Cart · three-attempt draft',
  },
  canvasRejected: { es: 'Pago rechazado', en: 'Rejected payment' },
  canvasShipping: { es: 'Envío y seguimiento', en: 'Shipping and tracking' },
  canvasPending: { es: 'Pago pendiente', en: 'Pending payment' },
  canvasVoiceTest: {
    es: 'Confirmación por voz · prueba',
    en: 'Voice confirmation · test',
  },
  internalMessage: { es: 'Alerta para el equipo', en: 'Team alert' },
  voiceScript: { es: 'Guion de llamada', en: 'Call script' },
  buttonResume: { es: 'Retomar compra', en: 'Resume purchase' },
  buttonConfirm: { es: 'CONFIRMAR', en: 'CONFIRM' },
  buttonCorrect: { es: 'CORREGIR', en: 'CORRECT' },
  buttonBenefit: { es: 'BENEFICIO', en: 'BENEFIT' },
  buttonReattempt: { es: 'Revisar otro intento', en: 'Review another attempt' },
  buttonCancel: { es: 'Cancelar', en: 'Cancel' },
  title: {
    es: 'Estudio de automatización',
    en: 'Automation studio',
  },
  tagline: {
    es: 'Tu operación, diseñada por Riverz.',
    en: 'Your operation, designed by Riverz.',
  },
  intro: {
    es: 'Una propuesta completa para revisar juntos: flujos, mensajes y decisiones.',
    en: 'A complete proposal to review together: flows, messages and decisions.',
  },
  overview: {
    es: 'Resumen',
    en: 'Overview',
  },
  flows: {
    es: 'Escenarios',
    en: 'Scenarios',
  },
  messages: {
    es: 'Plantillas',
    en: 'Templates',
  },
  ai: {
    es: 'IA y comentarios',
    en: 'AI & comments',
  },
  agreement: {
    es: 'Propuesta',
    en: 'Proposal',
  },
  all: {
    es: 'Todos',
    en: 'All',
  },
  current: {
    es: 'Configuración actual',
    en: 'Current configuration',
  },
  design: {
    es: 'Diseño propuesto',
    en: 'Proposed design',
  },
  active: {
    es: 'Flujo activo',
    en: 'Active flow',
  },
  draft: {
    es: 'Borrador existente',
    en: 'Existing draft',
  },
  blocked: {
    es: 'Pendiente de conexión',
    en: 'Connection pending',
  },
  available: {
    es: 'En biblioteca',
    en: 'In library',
  },
  proposal: {
    es: 'Ejemplo propuesto',
    en: 'Proposed example',
  },
  aiExample: {
    es: 'Ejemplo de respuesta de IA',
    en: 'AI response example',
  },
  control: {
    es: 'Regla de control',
    en: 'Control rule',
  },
  prepaid: {
    es: 'Anticipado',
    en: 'Prepaid',
  },
  hybrid: {
    es: 'Híbrido',
    en: 'Hybrid',
  },
  cod: {
    es: 'Contraentrega',
    en: 'Cash on delivery',
  },
  model: {
    es: 'Modelo de venta',
    en: 'Sales model',
  },
  brand: {
    es: 'Marca',
    en: 'Brand',
  },
  site: {
    es: 'Sitio web',
    en: 'Website',
  },
  product: {
    es: 'Producto',
    en: 'Product',
  },
  customer: {
    es: 'Cliente de ejemplo',
    en: 'Example customer',
  },
  amount: {
    es: 'Importe de ejemplo',
    en: 'Example amount',
  },
  order: {
    es: 'Pedido de ejemplo',
    en: 'Example order',
  },
  scope: {
    es: 'Lo que Riverz construye por ti',
    en: 'What Riverz builds for you',
  },
  cart: {
    es: 'Carrito abandonado',
    en: 'Cart recovery',
  },
  discount: {
    es: 'Ofertas y descuentos',
    en: 'Offers & discounts',
  },
  comments: {
    es: 'Comentarios y mensajes',
    en: 'Comments & messages',
  },
  aftercare: {
    es: 'Atención y posventa',
    en: 'Service & after-sales',
  },
  voice: {
    es: 'Llamadas de IA',
    en: 'AI calls',
  },
  search: {
    es: 'Buscar un caso o plantilla',
    en: 'Find a case or template',
  },
  when: {
    es: 'Disparador',
    en: 'Trigger',
  },
  then: {
    es: 'Acción de Riverz',
    en: 'Riverz action',
  },
  branches: {
    es: 'Según lo que suceda',
    en: 'Depending on the outcome',
  },
  original: {
    es: 'Texto original',
    en: 'Original text',
  },
  example: {
    es: 'Vista de ejemplo',
    en: 'Example preview',
  },
  edit: {
    es: 'Editar propuesta',
    en: 'Edit proposal',
  },
  restore: {
    es: 'Restaurar mensaje',
    en: 'Restore message',
  },
  copy: {
    es: 'Copiar mensaje',
    en: 'Copy message',
  },
  copied: {
    es: 'Copiado',
    en: 'Copied',
  },
  copyError: {
    es: 'No se pudo copiar. Selecciona el texto para copiarlo.',
    en: 'Could not copy. Select the text to copy it.',
  },
  originalNote: {
    es: 'Texto configurado en la cuenta. Plantilla aprobada no significa mensaje entregado.',
    en: 'Text configured in the account. An approved template does not prove delivery.',
  },
  proposalNote: {
    es: 'Ejemplo para aprobar. No enviado ni activado.',
    en: 'Example for approval. Not sent or activated.',
  },
  editedNote: {
    es: 'Versión editada para esta propuesta. El original sigue intacto.',
    en: 'Edited version for this proposal. The original is unchanged.',
  },
  noMessage: {
    es: 'No se envía un mensaje en esta salida.',
    en: 'No message is sent on this outcome.',
  },
  noMessageDesc: {
    es: 'La secuencia se detiene, espera o asigna el caso según la regla.',
    en: 'The sequence stops, waits or assigns the case according to the rule.',
  },
  variables: {
    es: 'Datos que completaremos',
    en: 'Details to populate',
  },
  buttons: {
    es: 'Botones configurados',
    en: 'Configured buttons',
  },
  library: {
    es: 'Biblioteca completa',
    en: 'Complete library',
  },
  usage: {
    es: 'Uso actual',
    en: 'Current usage',
  },
  include: {
    es: 'Incluir en la propuesta',
    en: 'Include in proposal',
  },
  selected: {
    es: 'Incluido',
    en: 'Included',
  },
  notSelected: {
    es: 'No incluido',
    en: 'Not included',
  },
  customize: {
    es: 'Personalizar marca y ejemplos',
    en: 'Customize brand and examples',
  },
  settings: {
    es: 'Personalizar',
    en: 'Customize',
  },
  close: {
    es: 'Cerrar',
    en: 'Close',
  },
  download: {
    es: 'Descargar propuesta',
    en: 'Download proposal',
  },
  import: {
    es: 'Abrir propuesta',
    en: 'Open proposal',
  },
  importError: {
    es: 'Archivo inválido o de otra marca. Abre su presentación e inténtalo de nuevo.',
    en: 'Invalid file or different brand. Open that brand presentation and try again.',
  },
  draftNotice: {
    es: 'Borrador de reunión. Descarga la propuesta para conservar los cambios. No modifica la cuenta ni inicia cobros.',
    en: 'Meeting draft. Download the proposal to keep changes. It does not change the account or start billing.',
  },
  questions: {
    es: 'Decisiones pendientes',
    en: 'Decisions to agree',
  },
  previous: {
    es: 'Anterior',
    en: 'Previous',
  },
  next: {
    es: 'Siguiente',
    en: 'Next',
  },
  answer: {
    es: 'Acuerdo con el cliente',
    en: 'Client decision',
  },
  monthly: {
    es: 'Mensualidad acordada',
    en: 'Agreed monthly fee',
  },
  launch: {
    es: 'Fecha objetivo',
    en: 'Target date',
  },
  owner: {
    es: 'Responsable del cliente',
    en: 'Client owner',
  },
  reviewed: {
    es: 'Alcance revisado en reunión',
    en: 'Scope reviewed in meeting',
  },
  handoff: {
    es: 'Riverz configura → probamos → el cliente aprueba → activamos',
    en: 'Riverz configures → we test → client approves → we launch',
  },
  handoffNote: {
    es: 'La propuesta documenta el alcance. Crear la cuenta, activar flujos y contratar la mensualidad son pasos posteriores.',
    en: 'The proposal documents scope. Account creation, flow activation and the subscription are subsequent steps.',
  },
  summary: {
    es: 'Alcance seleccionado',
    en: 'Selected scope',
  },
  map: {
    es: 'Mapa de servicio',
    en: 'Service map',
  },
  present: {
    es: 'Presentar',
    en: 'Present',
  },
  exit: {
    es: 'Salir',
    en: 'Exit',
  },
  noResults: {
    es: 'No hay resultados para este filtro.',
    en: 'No results for this filter.',
  },
  snapshot: {
    es: 'Plantillas consultadas el 10 sep 2026',
    en: 'Templates reviewed Sep 10, 2026',
  },
  sourceModel: {
    es: 'Los flujos actuales muestran la cuenta real. El modelo y las opciones personalizan el diseño propuesto.',
    en: 'Current flows reflect the real account. The model and options customize the proposed design.',
  },
  pilar: {
    es: 'Pilar',
    en: 'Pilar',
  },
  rasmiaw: {
    es: 'Rasmiaw',
    en: 'Rasmiaw',
  },
  contraentrega: {
    es: 'Tu marca',
    en: 'Your brand',
  },
  pilarSector: {
    es: 'Sérum para rostro y cuello',
    en: 'Face and neck serum',
  },
  rasmiawSector: {
    es: 'Rascadores y accesorios para gatos',
    en: 'Cat scratchers and accessories',
  },
  contraentregaSector: {
    es: 'Tienda 100% contraentrega',
    en: '100% cash-on-delivery store',
  },
  skin: {
    es: 'Serum Pilar',
    en: 'Serum Pilar',
  },
  scratcher: {
    es: 'Rascador Rasmiaw',
    en: 'Rasmiaw scratcher',
  },
  genericProduct: {
    es: 'Tu producto',
    en: 'Your product',
  },
  sampleAmount: {
    es: '[importe]',
    en: '[amount]',
  },
  sampleUrl: {
    es: '[enlace de seguimiento]',
    en: '[tracking link]',
  },
  sampleAddress: {
    es: '[dirección confirmada]',
    en: '[confirmed address]',
  },
  outcomeBuy: {
    es: 'Si compra → detener recuperación',
    en: 'Purchase → stop recovery',
  },
  outcomeReply: {
    es: 'Si responde → atiende la IA',
    en: 'Reply → AI handles it',
  },
  outcomeHuman: {
    es: 'Si necesita ayuda → equipo con contexto',
    en: 'Needs help → team receives context',
  },
  outcomeSilence: {
    es: 'Si no responde → espera o siguiente intento acordado',
    en: 'No reply → wait or agreed next attempt',
  },
  noTemplates: {
    es: 'Sin plantillas existentes para este modelo. Los ejemplos están en Escenarios.',
    en: 'No existing templates for this model. Examples are available in Scenarios.',
  },
  cadence: {
    es: 'Secuencia y mensajes',
    en: 'Sequence & messages',
  },
  discountValue: {
    es: 'Descuento propuesto (%)',
    en: 'Proposed discount (%)',
  },
  noDiscount: {
    es: 'Pilar tiene un tope actual de 0%. Activar esta opción solo añade un descuento a la propuesta para aprobar.',
    en: 'Pilar currently has a 0% cap. Enabling this option only adds a discount to the proposal for approval.',
  },
  allDone: {
    es: 'Riverz se encarga del servicio completo',
    en: 'Riverz handles the complete service',
  },
  allDoneDesc: {
    es: 'Diseño, conexiones, IA, plantillas y pruebas. Tu equipo conserva las decisiones que acordemos.',
    en: 'Design, connections, AI, templates and testing. Your team retains the decisions we agree on.',
  },
  templateStatus: {
    es: 'Aprobada por el canal',
    en: 'Approved by the channel',
  },
  paymentPending: {
    es: 'Pendiente de pago ≠ contraentrega',
    en: 'Pending payment ≠ cash on delivery',
  },
  variant: {
    es: 'Variante',
    en: 'Variant',
  },
  reviewClaims: {
    es: 'Revisar afirmaciones y condiciones antes de reutilizar esta plantilla en otra marca.',
    en: 'Review claims and terms before reusing this template for another brand.',
  },
  prompt: {
    es: 'Consulta del cliente',
    en: 'Customer question',
  },
  respond: {
    es: 'Respuesta de ejemplo',
    en: 'Example response',
  },
  offerTitle: {
    es: 'Oferta autorizada para recuperar una venta',
    en: 'Authorized offer to recover a sale',
  },
  offerTrigger: {
    es: 'El cliente no completa la compra y cumple las condiciones de la oferta.',
    en: 'The customer does not complete the purchase and meets offer conditions.',
  },
  offerAction: {
    es: 'Verificamos margen, vigencia y elegibilidad antes de generar el beneficio.',
    en: 'Check margin, validity and eligibility before generating the benefit.',
  },
  offerException: {
    es: 'Si compra, vence el beneficio o no es elegible, no se ofrece el descuento.',
    en: 'If purchased, expired or ineligible, no discount is offered.',
  },
  offerQuestion: {
    es: '¿Qué porcentaje, productos, vigencia y acumulación autoriza la marca?',
    en: 'Which percentage, products, validity and stacking does the brand authorize?',
  },
  voiceTitle: {
    es: 'Llamada de confirmación o seguimiento',
    en: 'Confirmation or follow-up call',
  },
  voiceTrigger: {
    es: 'El cliente acepta una llamada o se cumple la regla acordada.',
    en: 'The customer accepts a call or the agreed rule is met.',
  },
  voiceAction: {
    es: 'La IA se identifica, verifica el pedido y registra el resultado para el equipo.',
    en: 'AI identifies itself, verifies the order and records the result for the team.',
  },
  voiceException: {
    es: 'Sin respuesta, rechazo o datos que no coinciden → reintento acordado o revisión humana.',
    en: 'No answer, refusal or mismatched data → agreed retry or human review.',
  },
  voiceQuestion: {
    es: '¿Para qué casos autorizan llamadas, en qué horarios y con cuántos intentos?',
    en: 'Which cases allow calls, during which hours and with how many attempts?',
  },
  statCases: {
    es: 'casos disponibles',
    en: 'available cases',
  },
  statTemplates: {
    es: 'plantillas originales',
    en: 'original templates',
  },
  statIncluded: {
    es: 'casos incluidos',
    en: 'included cases',
  },
  ctaPilar: {
    es: 'Abrir pitch de Pilar',
    en: 'Open Pilar pitch',
  },
  ctaRasmiaw: {
    es: 'Abrir pitch de Rasmiaw',
    en: 'Open Rasmiaw pitch',
  },
  ctaCod: {
    es: 'Crear propuesta contraentrega',
    en: 'Create COD proposal',
  },
  msg_catalog: {
    es: 'Hola {{customer}}, soy el asistente de {{brand}}. ¿Qué te gustaría saber sobre {{product}}? Te ayudo con la información del producto, el precio vigente y las opciones de envío.',
    en: 'Hi {{customer}}, I’m the {{brand}} assistant. What would you like to know about {{product}}? I can help with product information, current pricing and shipping options.',
  },
  msg_comments: {
    es: '¡Hola! Gracias por tu interés en {{brand}}. Te compartimos la información por privado si el canal nos lo permite. También puedes escribirnos desde {{site}}.',
    en: 'Hi! Thanks for your interest in {{brand}}. We’ll share details privately if the channel allows it. You can also reach us through {{site}}.',
  },
  msg_checkout: {
    es: 'Hola {{customer}}, te ayudo a comprar {{product}}. Confirmemos la cantidad y la ciudad de entrega para compartirte las opciones disponibles y el total antes de continuar.',
    en: 'Hi {{customer}}, I’ll help you buy {{product}}. Let’s confirm quantity and delivery city so I can share available options and the total before proceeding.',
  },
  msg_cart: {
    es: 'Hola {{customer}}, dejaste {{product}} en tu carrito de {{brand}}. Puedes retomar la compra desde {{checkout}}. Si tienes dudas sobre el producto, el envío o el pago, responde este mensaje y te ayudo.',
    en: 'Hi {{customer}}, you left {{product}} in your {{brand}} cart. Resume your purchase at {{checkout}}. Reply if you have questions about the product, delivery or payment.',
  },
  msg_rejected: {
    es: 'Hola {{customer}}, el pago de tu pedido {{order}} por {{amount}} no se completó. Si aún quieres continuar, responde este mensaje y revisamos contigo las opciones de pago disponibles.',
    en: 'Hi {{customer}}, payment for order {{order}} totaling {{amount}} did not complete. If you want to proceed, reply and we’ll review available payment options together.',
  },
  msg_pending: {
    es: 'Hola {{customer}}, tu pedido {{order}} en {{brand}} está pendiente de pago. El total es {{amount}}. Si necesitas los datos para pagar, escríbenos. Si ya pagaste, comparte la referencia para que podamos verificarlo.',
    en: 'Hi {{customer}}, your {{brand}} order {{order}} is awaiting payment. The total is {{amount}}. Message us if you need payment details. If already paid, share the reference so we can verify it.',
  },
  msg_benefit: {
    es: 'Hola {{customer}}, podemos revisar si tu pedido {{order}} cumple las condiciones para un beneficio autorizado al cambiar a pago anticipado. Responde BENEFICIO para revisarlo o CONFIRMAR para mantener contraentrega.',
    en: 'Hi {{customer}}, we can check whether order {{order}} qualifies for an authorized benefit when switching to prepayment. Reply BENEFICIO to review it or CONFIRMAR to keep cash on delivery.',
  },
  msg_receipt: {
    es: 'Gracias, {{customer}}. Recibimos la información de tu pago del pedido {{order}}. Nuestro equipo la verificará y te confirmará el resultado por este chat.',
    en: 'Thanks, {{customer}}. We received the payment information for order {{order}}. Our team will verify it and confirm the result in this chat.',
  },
  msg_confirm: {
    es: 'Hola {{customer}}, somos {{brand}}. Recibimos tu pedido {{order}} de {{product}} por {{amount}}, para pagar al recibir. ¿Confirmas que los datos son correctos y que puedes recibirlo en {{address}}? Responde CONFIRMAR o CORREGIR.',
    en: 'Hi {{customer}}, this is {{brand}}. We received COD order {{order}} for {{product}}, totaling {{amount}}. Are the details correct, and can you receive it at {{address}}? Reply CONFIRM or CORRECT.',
  },
  msg_address: {
    es: 'Hola {{customer}}, necesitamos completar la dirección de tu pedido {{order}} antes del despacho. Compártenos ciudad, dirección y una referencia para validar la entrega.',
    en: 'Hi {{customer}}, we need to complete the address for order {{order}} before dispatch. Please share the city, address and a reference so we can validate delivery.',
  },
  msg_codpayment: {
    es: 'Hola {{customer}}, tu pedido {{order}} mantiene el pago al recibir por {{amount}}. Si necesitas revisar alguna condición antes del despacho, cuéntanos por aquí y lo consultamos con el equipo.',
    en: 'Hi {{customer}}, order {{order}} remains cash on delivery for {{amount}}. If you need to review any terms before dispatch, tell us here and we’ll consult the team.',
  },
  msg_tracking: {
    es: 'Hola {{customer}}, tu pedido {{order}} de {{brand}} ya fue despachado. Puedes consultar el seguimiento en {{tracking}}. Si necesitas ayuda con la entrega, responde por aquí.',
    en: 'Hi {{customer}}, your {{brand}} order {{order}} has shipped. Track it at {{tracking}}. Reply here if you need help with delivery.',
  },
  msg_change: {
    es: 'Hola {{customer}}, cuéntanos qué necesitas cambiar en tu pedido {{order}}. Revisaremos si aún es posible según su estado y te confirmaremos antes de realizar el cambio.',
    en: 'Hi {{customer}}, tell us what you need to change in order {{order}}. We’ll check whether it’s still possible given its status and confirm before making changes.',
  },
  msg_incident: {
    es: 'Hola {{customer}}, estamos revisando una novedad en la entrega de tu pedido {{order}}. ¿Nos confirmas si los datos de entrega siguen siendo correctos? Gestionaremos el siguiente paso con la transportadora.',
    en: 'Hi {{customer}}, we’re reviewing a delivery issue with order {{order}}. Can you confirm whether delivery details are still correct? We’ll coordinate the next step with the carrier.',
  },
  msg_refusal: {
    es: 'Hola {{customer}}, no se pudo completar la entrega de tu pedido {{order}}. ¿Quieres que revisemos un nuevo intento o prefieres cancelar? Validaremos las opciones disponibles antes de confirmarte.',
    en: 'Hi {{customer}}, delivery of order {{order}} could not be completed. Would you like us to review another attempt or would you prefer cancellation? We’ll validate available options before confirming.',
  },
  msg_collection: {
    es: 'Pedido {{order}}: entrega reportada. Revisar recaudo de {{amount}} y conciliación del abono según el reporte de la transportadora. Responsable: [responsable financiero].',
    en: 'Order {{order}}: delivery reported. Review collection of {{amount}} and settlement reconciliation against the carrier report. Owner: [finance owner].',
  },
  msg_returns: {
    es: 'Hola {{customer}}, lamentamos el inconveniente con tu pedido {{order}}. Cuéntanos qué ocurrió y comparte las evidencias necesarias. Revisaremos tu caso según nuestra política y te confirmaremos las opciones de solución.',
    en: 'Hi {{customer}}, we’re sorry about the issue with order {{order}}. Tell us what happened and share the necessary evidence. We’ll review the case under our policy and confirm available solutions.',
  },
  msg_care: {
    es: 'Hola {{customer}}, gracias por elegir {{product}} de {{brand}}. Si necesitas ayuda con su uso o cuidado, responde este mensaje y te compartimos las indicaciones oficiales.',
    en: 'Hi {{customer}}, thanks for choosing {{product}} from {{brand}}. Reply if you need help using or caring for it and we’ll share the official instructions.',
  },
  msg_satisfaction: {
    es: 'Hola {{customer}}, ¿cómo fue tu experiencia con {{product}} de {{brand}}? Si algo no salió como esperabas, cuéntanos para ayudarte.',
    en: 'Hi {{customer}}, how was your experience with {{product}} from {{brand}}? If anything fell short, let us know so we can help.',
  },
  msg_repeat: {
    es: 'Hola {{customer}}, gracias por confiar en {{brand}}. Si estás pensando en una nueva compra, podemos ayudarte a elegir según lo que necesitas. ¿Quieres que te compartamos las opciones disponibles?',
    en: 'Hi {{customer}}, thanks for trusting {{brand}}. If you’re considering another purchase, we can help you choose based on your needs. Would you like to see available options?',
  },
  msg_handoff: {
    es: 'Hola {{customer}}, voy a pasar tu consulta al equipo de {{brand}} con la información que ya nos compartiste. Te responderemos dentro del horario de atención acordado: [horario].',
    en: 'Hi {{customer}}, I’ll hand your question to the {{brand}} team with the information you already shared. We’ll respond within our agreed service hours: [hours].',
  },
  msg_deliveryfailure: {
    es: 'No se pudo entregar el mensaje del pedido {{order}}. Revisar conexión, datos del destinatario y permiso de contacto antes de reintentar.',
    en: 'The message for order {{order}} could not be delivered. Check the connection, recipient details and contact permission before retrying.',
  },
  msg_offer: {
    es: 'Hola {{customer}}, tienes un beneficio autorizado de {{discount}}% para {{product}} en {{brand}}, válido hasta [fecha aprobada]. Consulta condiciones y retoma tu compra en {{checkout}}. Si necesitas ayuda, responde aquí.',
    en: 'Hi {{customer}}, you have an authorized {{discount}}% benefit for {{product}} at {{brand}}, valid until [approved date]. Check terms and resume your purchase at {{checkout}}. Reply here if you need help.',
  },
  msg_voice: {
    es: 'Hola {{customer}}, soy el asistente de voz de {{brand}}. Te llamo para revisar tu pedido {{order}} de {{product}}. ¿Tienes un momento para confirmar los datos?',
    en: 'Hi {{customer}}, I’m the {{brand}} voice assistant. I’m calling to review order {{order}} for {{product}}. Do you have a moment to confirm the details?',
  },
  msg_privacy: {
    es: 'Para cuidar tus datos, revisemos tu pedido por privado. Escríbenos por mensaje directo y te ayudamos.',
    en: 'To protect your details, let’s review your order privately. Send us a direct message and we’ll help.',
  },
  msg_health: {
    es: 'Gracias por contarnos lo que sucede. Voy a compartir tu consulta con nuestro equipo para que revise el caso y las indicaciones oficiales del producto.',
    en: 'Thanks for letting us know. I’ll share your question with our team so they can review the case and official product guidance.',
  },
  msg_stock: {
    es: 'Voy a verificar la disponibilidad y el precio vigente de {{product}} antes de confirmarte la compra.',
    en: 'I’ll verify availability and the current price of {{product}} before confirming the purchase.',
  },
  msg_optout: {
    es: 'Entendido. Registramos que no deseas recibir más mensajes de seguimiento.',
    en: 'Understood. We’ve recorded that you do not want further follow-up messages.',
  },
  msg_pickup: {
    es: 'Cuéntanos en qué ciudad quieres retirar tu pedido. Revisaremos las opciones de retiro disponibles antes de confirmarte una sucursal.',
    en: 'Tell us which city you want to collect your order in. We’ll check available pickup options before confirming a location.',
  },
  msg_paid: {
    es: 'Hola {{customer}}, confirmamos el pago de tu pedido {{order}} por {{amount}}. Te avisaremos cuando tengamos el despacho y el seguimiento disponibles.',
    en: 'Hi {{customer}}, payment for order {{order}} totaling {{amount}} is confirmed. We’ll notify you when dispatch and tracking are available.',
  },
  prompt_catalog: {
    es: '¿Cuánto cuesta y para qué sirve?',
    en: 'How much is it and what is it for?',
  },
  prompt_comments: {
    es: '¡Quiero información!',
    en: 'I’d like more information!',
  },
  prompt_checkout: {
    es: 'Quiero comprar, ¿me ayudas?',
    en: 'I want to buy, can you help?',
  },
  prompt_privacy: {
    es: 'Este es mi número de pedido…',
    en: 'Here is my order number…',
  },
  prompt_health: {
    es: 'Tengo una duda sobre el producto y mi piel.',
    en: 'I have a question about the product and my skin.',
  },
  prompt_tracking: {
    es: '¿Dónde está mi pedido?',
    en: 'Where is my order?',
  },
  prompt_returns: {
    es: 'Mi producto llegó con un problema.',
    en: 'My product arrived with an issue.',
  },
  prompt_handoff: {
    es: 'Quiero hablar con una persona.',
    en: 'I want to speak to a person.',
  },
  prompt_pickup: {
    es: '¿Puedo retirar en una sucursal?',
    en: 'Can I pick it up at a location?',
  },
} satisfies Namespace;

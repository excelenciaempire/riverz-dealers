import type { Namespace } from './types';
import { operationMessages } from './pitch-operations';
export const pitch = {
  customDesign: {
    es: 'Riverz prepara este flujo',
    en: 'Riverz prepares this flow',
  },
  customDesignDesc: {
    es: 'Definimos el disparador, las condiciones, los mensajes y las excepciones con tu equipo antes de activarlo.',
    en: 'We define the trigger, conditions, messages and exceptions with your team before activating it.',
  },
  operationEvent: { es: 'Lo que sucede', en: 'What happens' },
  operationInternal: { es: 'Acción de Riverz', en: 'Riverz action' },
  tailored: { es: 'Diseño a medida', en: 'Tailored design' },
  tailoredDesc: {
    es: 'Riverz prepara los flujos, mensajes y conexiones según tu negocio. Tú decides el alcance y las excepciones que atenderá tu equipo.',
    en: 'Riverz prepares flows, messages and connections for your business. You choose the scope and exceptions your team will handle.',
  },
  scopeNote: {
    es: 'Selecciona los escenarios de esta propuesta. Los flujos existentes se conservan como referencia; su configuración no cambia desde aquí.',
    en: 'Select scenarios for this proposal. Existing flows remain as reference; their configuration is not changed here.',
  },
  customCases: {
    es: 'Casos particulares de tu negocio',
    en: 'Your business-specific cases',
  },
  customCasesQuestion: {
    es: '¿Qué solicitudes, excepciones o procesos propios debemos agregar?',
    en: 'Which specific requests, exceptions or processes should we add?',
  },
  setupChannels: {
    es: 'Canales y conexiones que utilizas',
    en: 'Channels and connections you use',
  },
  setupPayments: {
    es: 'Medios de pago, condiciones y validación',
    en: 'Payment methods, terms and verification',
  },
  setupService: {
    es: 'Horarios, responsables y acciones que requieren aprobación',
    en: 'Hours, owners and actions requiring approval',
  },
  setupShipping: {
    es: 'Cobertura, transportistas, cambios y devoluciones',
    en: 'Coverage, carriers, exchanges and returns',
  },
  setupVoice: {
    es: 'Tono, idioma y reglas de atención',
    en: 'Tone, language and support rules',
  },
  operation_recommend_reply_pilar: {
    es: '¡Hola, {{customer}}! Te ayudo a conocer el sérum de Pilar. 🌿\n\nPodemos revisar cómo se usa, su precio y las opciones de envío.\n\n¿Qué te gustaría saber antes de elegir?',
    en: 'Hi {{customer}}! Let me help you learn about the Pilar serum. 🌿\n\nWe can review how to use it, its price and delivery options.\n\nWhat would you like to know before choosing?',
  },
  operation_recommend_reply_rasmiaw: {
    es: '¡Hola, {{customer}}! Busquemos una opción para tu gato. 🐾\n\nCuéntame dónde suele rascar y qué espacio tienes en casa. Con eso podemos revisar las opciones disponibles de Rasmiaw.\n\n¿Cómo le gusta rascar?',
    en: 'Hi {{customer}}! Let us find an option for your cat. 🐾\n\nTell me where your cat usually scratches and what space you have at home. Then we can explore the available Rasmiaw options.\n\nHow does your cat like to scratch?',
  },
  operation_recommend_reply_contraentrega: {
    es: '¡Hola, {{customer}}! Te ayudo a elegir {{product}}. 😊\n\nPodemos revisar sus características, el total y la cobertura para pagar al recibir.\n\n¿Qué te gustaría saber primero?',
    en: 'Hi {{customer}}! I can help you choose {{product}}. 😊\n\nWe can review its features, the total and cash on delivery coverage.\n\nWhat would you like to know first?',
  },
  operation_care_reply_pilar: {
    es: '¡Qué bueno que tu sérum de Pilar ya llegó! 🌿\n\nTe ayudo a revisar las instrucciones de uso y las precauciones de la marca.\n\n¿Es tu primera vez usándolo o tienes alguna duda específica?',
    en: 'Great to hear your Pilar serum has arrived! 🌿\n\nI can help you review the brand instructions and precautions.\n\nIs this your first time using it, or do you have a specific question?',
  },
  operation_care_reply_rasmiaw: {
    es: '¡Qué bueno que ya llegó tu pedido de Rasmiaw! 🐾\n\nRevisemos las instrucciones del producto y cómo presentárselo a tu gato.\n\n¿Necesitas ayuda para prepararlo o para empezar a usarlo?',
    en: 'Great to hear your Rasmiaw order has arrived! 🐾\n\nLet us review the product instructions and how to introduce it to your cat.\n\nWould you like help setting it up or getting started?',
  },
  operation_care_reply_contraentrega: {
    es: '¡Qué bueno que ya recibiste {{product}}, {{customer}}! 📦\n\nTe ayudo a revisar las instrucciones de uso de {{brand}}.\n\n¿Qué te gustaría saber para empezar?',
    en: 'Great to hear you received {{product}}, {{customer}}! 📦\n\nI can help you review the instructions from {{brand}}.\n\nWhat would you like to know to get started?',
  },
  options: { es: 'Opciones', en: 'Options' },
  explore: { es: 'Explorar escenarios', en: 'Explore scenarios' },
  centerCase: { es: 'Centrar escenario', en: 'Center scenario' },
  viewMap: { es: 'Ver mapa completo', en: 'View entire map' },
  ...operationMessages,
  clientView: { es: 'Cliente', en: 'Client' },
  technicalView: { es: 'Detalle técnico', en: 'Technical detail' },
  clientGoal: { es: 'Objetivo para tu negocio', en: 'Goal for your business' },
  clientAction: { es: 'Qué hará Riverz', en: 'What Riverz will do' },
  clientBlueprint: { es: 'Diseño del servicio', en: 'Service design' },
  clientVariants: { es: 'Escenarios cubiertos', en: 'Covered situations' },
  clientExpand: {
    es: 'Ver casos y excepciones',
    en: 'View cases and exceptions',
  },
  clientCollapse: { es: 'Resumir', en: 'Collapse' },
  journey_advice: {
    es: 'Asesorar y ayudar a comprar',
    en: 'Advise and help customers buy',
  },
  value_advice: {
    es: 'Atender dudas a tiempo y facilitar la compra.',
    en: 'Answer questions promptly and make purchasing easier.',
  },
  action_advice: {
    es: 'Consulta el catálogo, recomienda según la necesidad y comparte el enlace de compra. Las preguntas que requieren criterio especializado pasan al equipo.',
    en: 'Check the catalog, recommend based on the need and share a purchase link. Questions requiring specialist judgment go to the team.',
  },
  journey_social: {
    es: 'Atender comentarios y mensajes',
    en: 'Handle comments and messages',
  },
  value_social: {
    es: 'Aprovechar el interés que llega desde las redes.',
    en: 'Act on interest coming from social media.',
  },
  action_social: {
    es: 'Distingue consultas de compra, quejas y spam. Responde y continúa por privado cuando el canal lo permite.',
    en: 'Distinguish purchase questions, complaints and spam. Respond and continue privately when the channel allows it.',
  },
  journey_recovery: {
    es: 'Recuperar compras pendientes',
    en: 'Recover incomplete purchases',
  },
  value_recovery: {
    es: 'Retomar oportunidades que quedaron sin completar.',
    en: 'Follow up on purchase opportunities left incomplete.',
  },
  action_recovery: {
    es: 'Agrupa carrito abandonado, pago rechazado y promociones. Revisa si ya compró o respondió antes de continuar, según las reglas que acordemos.',
    en: 'Group abandoned carts, rejected payments and promotions. Check whether the customer purchased or replied before continuing, according to the agreed rules.',
  },
  journey_orders: {
    es: 'Confirmar el pedido y el pago',
    en: 'Confirm the order and payment',
  },
  value_orders: {
    es: 'Reducir errores antes de preparar un pedido.',
    en: 'Reduce errors before preparing an order.',
  },
  action_orders: {
    es: 'Adapta la confirmación a pago anticipado, contraentrega o híbrido. Valida datos y deriva comprobantes o decisiones de pago cuando necesitan revisión.',
    en: 'Adapt confirmation to prepaid, cash-on-delivery or hybrid payments. Validate details and route receipts or payment decisions for review when needed.',
  },
  journey_delivery: { es: 'Acompañar la entrega', en: 'Support delivery' },
  value_delivery: {
    es: 'Reducir consultas sobre el envío y atender novedades.',
    en: 'Reduce shipping questions and address delivery issues.',
  },
  action_delivery: {
    es: 'Comparte el seguimiento disponible y recoge incidencias. En contraentrega, diferencia entrega, recaudo y liquidación.',
    en: 'Share available tracking and collect delivery issues. For cash on delivery, distinguish delivery, collection and settlement.',
  },
  journey_changes: {
    es: 'Resolver cambios y devoluciones',
    en: 'Handle changes and returns',
  },
  value_changes: {
    es: 'Recibir cada solicitud con la información necesaria.',
    en: 'Receive each request with the necessary information.',
  },
  action_changes: {
    es: 'Identifica el pedido y el motivo, recoge evidencia y aplica la política acordada. Las aprobaciones y los reembolsos se escalan al responsable.',
    en: 'Identify the order and reason, collect evidence and apply the agreed policy. Approvals and refunds are escalated to the owner.',
  },
  journey_loyalty: {
    es: 'Cuidar la postventa y la recompra',
    en: 'Support aftercare and repeat purchases',
  },
  value_loyalty: {
    es: 'Dar seguimiento a la experiencia y facilitar la próxima compra.',
    en: 'Follow up on the experience and make the next purchase easier.',
  },
  action_loyalty: {
    es: 'Planifica acompañamiento, satisfacción y recompra según el producto, los tiempos y el consentimiento del cliente.',
    en: 'Plan aftercare, satisfaction and repeat-purchase follow-ups based on the product, timing and customer consent.',
  },
  journey_protection: {
    es: 'Dar paso al equipo cuando hace falta',
    en: 'Bring in the team when needed',
  },
  value_protection: {
    es: 'Mantener el control y evitar mensajes inoportunos.',
    en: 'Maintain control and avoid ill-timed messages.',
  },
  action_protection: {
    es: 'Respeta la baja de mensajes, evita contactos repetidos y entrega al equipo las conversaciones que requieren intervención.',
    en: 'Respect opt-outs, avoid repeated contact and hand conversations requiring intervention to the team.',
  },
  concept_catalog: { es: 'Consulta de producto', en: 'Product question' },
  concept_checkout: { es: 'Intención de compra', en: 'Purchase intent' },
  concept_health: { es: 'Consulta especializada', en: 'Specialist question' },
  concept_comments: { es: 'Comentarios en redes', en: 'Social comments' },
  concept_cart: { es: 'Carrito abandonado', en: 'Abandoned cart' },
  concept_rejected: { es: 'Pago rechazado', en: 'Rejected payment' },
  concept_offer: { es: 'Promoción autorizada', en: 'Approved promotion' },
  concept_order: {
    es: 'Pedido, confirmación y beneficio',
    en: 'Order, confirmation and benefit',
  },
  concept_receipt: { es: 'Comprobante de pago', en: 'Payment receipt' },
  concept_voice: { es: 'Confirmación por llamada', en: 'Confirmation call' },
  concept_address: { es: 'Datos de entrega', en: 'Delivery details' },
  concept_codpayment: { es: 'Pago al recibir', en: 'Payment on delivery' },
  concept_tracking: { es: 'Estado del envío', en: 'Shipping status' },
  concept_incident: { es: 'Novedad de entrega', en: 'Delivery issue' },
  concept_pickup: { es: 'Retiro en sucursal', en: 'Branch pickup' },
  concept_refusal: { es: 'Entrega rechazada', en: 'Refused delivery' },
  concept_collection: {
    es: 'Recaudo y liquidación',
    en: 'Collection and settlement',
  },
  concept_returns: {
    es: 'Cambio, cancelación o devolución',
    en: 'Change, cancellation or return',
  },
  concept_care: {
    es: 'Acompañamiento después de la compra',
    en: 'After-purchase care',
  },
  concept_satisfaction: { es: 'Satisfacción', en: 'Satisfaction' },
  concept_repeat: { es: 'Recompra', en: 'Repeat purchase' },
  concept_silence: {
    es: 'Cliente que deja de responder',
    en: 'Customer stops replying',
  },
  concept_handoff: { es: 'Atención humana', en: 'Human support' },
  concept_optout: { es: 'Baja de mensajes', en: 'Message opt-out' },
  concept_guard: {
    es: 'Evitar mensajes repetidos',
    en: 'Prevent repeated messages',
  },
  concept_deliveryfailure: {
    es: 'Error al enviar un mensaje',
    en: 'Message delivery failure',
  },
  canvasStart: { es: 'Volver al inicio del mapa', en: 'Return to map start' },
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
    es: '¡Hola, {{customer}}! Soy el asistente de {{brand}}. ✨\n\nTe ayudo a conocer {{product}}, revisar su precio y elegir cómo recibirlo.\n\n¿Qué te gustaría saber primero?',
    en: 'Hi {{customer}}! I am the {{brand}} assistant. ✨\n\nI can help you learn about {{product}}, check its price and explore delivery options.\n\nWhat would you like to know first?',
  },
  msg_comments: {
    es: '¡Gracias por tu interés en {{brand}}! ✨\n\nEscríbenos por privado y te ayudamos a conocer el producto y cómo comprarlo.\n\nTambién puedes visitarnos aquí: {{site}}',
    en: 'Thanks for your interest in {{brand}}! ✨\n\nSend us a private message and we will help with product details and how to buy.\n\nYou can also visit us here: {{site}}',
  },
  msg_checkout: {
    es: 'Hola {{customer}}, te ayudo a comprar {{product}}.\n\nConfirmemos la cantidad y la ciudad de entrega para compartirte las opciones disponibles y el total antes de continuar.',
    en: 'Hi {{customer}}, I’ll help you buy {{product}}.\n\nLet’s confirm quantity and delivery city so I can share available options and the total before proceeding.',
  },
  msg_cart: {
    es: '¡Hola, {{customer}}! ¿Te quedó alguna duda sobre {{product}}? 😊\n\nPuedes retomar tu compra de {{brand}} aquí:\n{{checkout}}\n\nSi quieres revisar el envío o la forma de pago, responde este mensaje y te ayudo.',
    en: 'Hi {{customer}}! Do you have any questions about {{product}}? 😊\n\nYou can resume your {{brand}} purchase here:\n{{checkout}}\n\nReply if you would like help with shipping or payment.',
  },
  msg_rejected: {
    es: 'Hola {{customer}}, el pago de tu pedido {{order}} por {{amount}} no se completó.\n\nSi aún quieres continuar, responde este mensaje y revisamos contigo las opciones de pago disponibles.',
    en: 'Hi {{customer}}, payment for order {{order}} totaling {{amount}} did not complete.\n\nIf you want to proceed, reply and we’ll review available payment options together.',
  },
  msg_pending: {
    es: 'Hola {{customer}}, tu pedido {{order}} en {{brand}} está pendiente de pago.\n\nEl total es {{amount}}.\n\nSi necesitas los datos para pagar, escríbenos.\n\nSi ya pagaste, comparte la referencia para que podamos verificarlo.',
    en: 'Hi {{customer}}, your {{brand}} order {{order}} is awaiting payment.\n\nThe total is {{amount}}.\n\nMessage us if you need payment details.\n\nIf already paid, share the reference so we can verify it.',
  },
  msg_benefit: {
    es: '¡Hola, {{customer}}! Revisemos si puedes aprovechar un beneficio al pagar tu pedido {{order}} antes del envío. ✨\n\nTe mostraremos las condiciones y el total antes de que decidas. También puedes mantener el pago al recibir.\n\n¿Quieres que lo consultemos?',
    en: 'Hi {{customer}}! Let us check whether you can use an offer by paying for order {{order}} before shipment. ✨\n\nWe will show you the terms and total before you decide. You can also keep cash on delivery.\n\nWould you like us to check?',
  },
  msg_receipt: {
    es: 'Gracias, {{customer}}.\n\nRecibimos la información de tu pago del pedido {{order}}.\n\nNuestro equipo la verificará y te confirmará el resultado por este chat.',
    en: 'Thanks, {{customer}}.\n\nWe received the payment information for order {{order}}.\n\nOur team will verify it and confirm the result in this chat.',
  },
  msg_confirm: {
    es: '¡Hola, {{customer}}! Somos {{brand}}. 📦\n\nEste es tu pedido para pagar al recibir:\n• Pedido: {{order}}\n• Producto: {{product}}\n• Total: {{amount}}\n• Dirección: {{address}}\n\n¿Está todo correcto? Responde CONFIRMAR o CORREGIR.',
    en: 'Hi {{customer}}! This is {{brand}}. 📦\n\nHere is your cash on delivery order:\n• Order: {{order}}\n• Product: {{product}}\n• Total: {{amount}}\n• Address: {{address}}\n\nIs everything correct? Reply CONFIRM or CORRECT.',
  },
  msg_address: {
    es: 'Hola {{customer}}, necesitamos completar la dirección de tu pedido {{order}} antes del despacho.\n\nCompártenos ciudad, dirección y una referencia para validar la entrega.',
    en: 'Hi {{customer}}, we need to complete the address for order {{order}} before dispatch.\n\nPlease share the city, address and a reference so we can validate delivery.',
  },
  msg_codpayment: {
    es: 'Hola {{customer}}, tu pedido {{order}} mantiene el pago al recibir por {{amount}}.\n\nSi necesitas revisar alguna condición antes del despacho, cuéntanos por aquí y lo consultamos con el equipo.',
    en: 'Hi {{customer}}, order {{order}} remains cash on delivery for {{amount}}.\n\nIf you need to review any terms before dispatch, tell us here and we’ll consult the team.',
  },
  msg_tracking: {
    es: '¡Tu pedido ya está en camino, {{customer}}! 📦\n\nSigue el envío de {{order}} aquí:\n{{tracking}}\n\nSi tienes alguna duda sobre la entrega, escríbenos por aquí. Te ayudamos.',
    en: 'Your order is on its way, {{customer}}! 📦\n\nTrack order {{order}} here:\n{{tracking}}\n\nIf you have questions about delivery, reply here. We are happy to help.',
  },
  msg_change: {
    es: 'Hola {{customer}}, cuéntanos qué necesitas cambiar en tu pedido {{order}}.\n\nRevisaremos si aún es posible según su estado y te confirmaremos antes de realizar el cambio.',
    en: 'Hi {{customer}}, tell us what you need to change in order {{order}}.\n\nWe’ll check whether it’s still possible given its status and confirm before making changes.',
  },
  msg_incident: {
    es: 'Hola {{customer}}, estamos revisando una novedad en la entrega de tu pedido {{order}}.\n\n¿Nos confirmas si los datos de entrega siguen siendo correctos?\n\nGestionaremos el siguiente paso con la transportadora.',
    en: 'Hi {{customer}}, we’re reviewing a delivery issue with order {{order}}.\n\nCan you confirm whether delivery details are still correct?\n\nWe’ll coordinate the next step with the carrier.',
  },
  msg_refusal: {
    es: 'Hola {{customer}}, no se pudo completar la entrega de tu pedido {{order}}.\n\n¿Quieres que revisemos un nuevo intento o prefieres cancelar?\n\nValidaremos las opciones disponibles antes de confirmarte.',
    en: 'Hi {{customer}}, delivery of order {{order}} could not be completed.\n\nWould you like us to review another attempt or would you prefer cancellation?\n\nWe’ll validate available options before confirming.',
  },
  msg_collection: {
    es: 'Pedido {{order}}: entrega reportada.\n\nRevisar recaudo de {{amount}} y conciliación del abono según el reporte de la transportadora.\n\nResponsable: [responsable financiero].',
    en: 'Order {{order}}: delivery reported.\n\nReview collection of {{amount}} and settlement reconciliation against the carrier report.\n\nOwner: [finance owner].',
  },
  msg_returns: {
    es: 'Hola {{customer}}, lamentamos el inconveniente con tu pedido {{order}}.\n\nCuéntanos qué ocurrió y comparte las evidencias necesarias.\n\nRevisaremos tu caso según nuestra política y te confirmaremos las opciones de solución.',
    en: 'Hi {{customer}}, we’re sorry about the issue with order {{order}}.\n\nTell us what happened and share the necessary evidence.\n\nWe’ll review the case under our policy and confirm available solutions.',
  },
  msg_care: {
    es: 'Hola {{customer}}, gracias por elegir {{product}} de {{brand}}.\n\nSi necesitas ayuda con su uso o cuidado, responde este mensaje y te compartimos las indicaciones oficiales.',
    en: 'Hi {{customer}}, thanks for choosing {{product}} from {{brand}}.\n\nReply if you need help using or caring for it and we’ll share the official instructions.',
  },
  msg_satisfaction: {
    es: 'Hola {{customer}}, ¿cómo fue tu experiencia con {{product}} de {{brand}}?\n\nSi algo no salió como esperabas, cuéntanos para ayudarte.',
    en: 'Hi {{customer}}, how was your experience with {{product}} from {{brand}}?\n\nIf anything fell short, let us know so we can help.',
  },
  msg_repeat: {
    es: 'Hola {{customer}}, gracias por confiar en {{brand}}.\n\nSi estás pensando en una nueva compra, podemos ayudarte a elegir según lo que necesitas.\n\n¿Quieres que te compartamos las opciones disponibles?',
    en: 'Hi {{customer}}, thanks for trusting {{brand}}.\n\nIf you’re considering another purchase, we can help you choose based on your needs.\n\nWould you like to see available options?',
  },
  msg_handoff: {
    es: 'Hola {{customer}}, voy a pasar tu consulta al equipo de {{brand}} con la información que ya nos compartiste.\n\nTe responderemos dentro del horario de atención acordado: [horario].',
    en: 'Hi {{customer}}, I’ll hand your question to the {{brand}} team with the information you already shared.\n\nWe’ll respond within our agreed service hours: [hours].',
  },
  msg_deliveryfailure: {
    es: 'No se pudo entregar el mensaje del pedido {{order}}.\n\nRevisar conexión, datos del destinatario y permiso de contacto antes de reintentar.',
    en: 'The message for order {{order}} could not be delivered.\n\nCheck the connection, recipient details and contact permission before retrying.',
  },
  msg_offer: {
    es: '¡Hola, {{customer}}! Tienes un beneficio de {{discount}}% para {{product}} en {{brand}}. ✨\n\nVálido hasta [fecha aprobada], según las condiciones de la oferta.\n\nRevisa el total y retoma tu compra aquí:\n{{checkout}}\n\n¿Te ayudo con alguna duda antes de decidir?',
    en: 'Hi {{customer}}! You have a {{discount}}% offer for {{product}} at {{brand}}. ✨\n\nValid until [approved date], subject to the offer terms.\n\nReview the total and resume your purchase here:\n{{checkout}}\n\nCan I help with any questions before you decide?',
  },
  msg_voice: {
    es: 'Hola {{customer}}, soy el asistente de voz de {{brand}}.\n\nTe llamo para revisar tu pedido {{order}} de {{product}}.\n\n¿Tienes un momento para confirmar los datos?',
    en: 'Hi {{customer}}, I’m the {{brand}} voice assistant.\n\nI’m calling to review order {{order}} for {{product}}.\n\nDo you have a moment to confirm the details?',
  },
  msg_privacy: {
    es: 'Para cuidar tus datos, revisemos tu pedido por privado.\n\nEscríbenos por mensaje directo y te ayudamos.',
    en: 'To protect your details, let’s review your order privately.\n\nSend us a direct message and we’ll help.',
  },
  msg_health: {
    es: 'Gracias por contarnos lo que sucede.\n\nVoy a compartir tu consulta con nuestro equipo para que revise el caso y las indicaciones oficiales del producto.',
    en: 'Thanks for letting us know.\n\nI’ll share your question with our team so they can review the case and official product guidance.',
  },
  msg_stock: {
    es: 'Voy a verificar la disponibilidad y el precio vigente de {{product}} antes de confirmarte la compra.',
    en: 'I’ll verify availability and the current price of {{product}} before confirming the purchase.',
  },
  msg_optout: {
    es: 'Entendido.\n\nRegistramos que no deseas recibir más mensajes de seguimiento.',
    en: 'Understood.\n\nWe’ve recorded that you do not want further follow-up messages.',
  },
  msg_pickup: {
    es: 'Cuéntanos en qué ciudad quieres retirar tu pedido.\n\nRevisaremos las opciones de retiro disponibles antes de confirmarte una sucursal.',
    en: 'Tell us which city you want to collect your order in.\n\nWe’ll check available pickup options before confirming a location.',
  },
  msg_paid: {
    es: 'Hola {{customer}}, confirmamos el pago de tu pedido {{order}} por {{amount}}.\n\nTe avisaremos cuando tengamos el despacho y el seguimiento disponibles.',
    en: 'Hi {{customer}}, payment for order {{order}} totaling {{amount}} is confirmed.\n\nWe’ll notify you when dispatch and tracking are available.',
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

import type { Namespace } from "./types";

/**
 * Devoluciones y cambios, y lo que el agente no supo contestar.
 *
 * Dos listas de trabajo que nacen de la conversación y terminan en una
 * decisión de una persona. Van juntas porque comparten la forma: el agente
 * anota, alguien resuelve.
 */
export const returns = {
  viewAll: { es: 'Ver todas', en: 'View all' },
  loadFailed: { es: 'No se pudieron cargar las devoluciones.', en: 'Could not load returns.' },
  unauthorized: { es: 'Inicia sesión para continuar.', en: 'Sign in to continue.' },
  invalidContact: { es: 'El contacto no es válido.', en: 'Invalid contact.' },
  title: { es: "Devoluciones", en: "Returns" },
  subtitle: {
    es: "Lo que pidieron devolver o cambiar desde una conversación.",
    en: "What people asked to return or exchange from a conversation.",
  },
  empty: { es: "No hay devoluciones abiertas.", en: "No open returns." },
  noName: { es: "Sin nombre", en: "No name" },
  kindReturn: { es: "Devolución", en: "Return" },
  kindExchange: { es: "Cambio", en: "Exchange" },
  saveFailed: { es: "No se pudo guardar.", en: "Could not save." },
  "status.abierta": { es: "Espera decisión", en: "Awaiting decision" },
  "status.aprobada": { es: "Aprobada", en: "Approved" },
  "status.rechazada": { es: "Rechazada", en: "Declined" },
  "status.recibida": { es: "Producto recibido", en: "Item received" },
  "status.resuelta": { es: "Resuelta", en: "Resolved" },
  "action.aprobada": { es: "Aprobar", en: "Approve" },
  "action.rechazada": { es: "Rechazar", en: "Decline" },
  "action.recibida": { es: "Marcar recibido", en: "Mark received" },
  "action.resuelta": { es: "Cerrar", en: "Close" },
} satisfies Namespace;

export const gaps = {
  title: { es: "Lo que no supo contestar", en: "What it could not answer" },
  hint: {
    es: "Carga la respuesta en su conocimiento y dejan de aparecer.",
    en: "Add the answer to its knowledge and they stop showing up.",
  },
  empty: { es: "No quedó ninguna sin contestar.", en: "Nothing went unanswered." },
  times: { es: "Preguntada {n} veces", en: "Asked {n} times" },
  markDone: { es: "Ya la cargué", en: "Added" },
  answer: { es: "Responder", en: "Answer" },
  // Dónde va la respuesta. No todo es del producto: "¿puedo retirar en
  // sucursal?" o "¿hacen factura A?" son políticas del negocio, y meterlas en
  // la ficha de UN producto las hace desaparecer cuando preguntan por otro.
  destProduct: { es: "Es de un producto", en: "It's about a product" },
  destRule: { es: "Es una regla del negocio", en: "It's a business rule" },
  destRuleHint: {
    es: "Vale para toda la cuenta, sin importar el producto.",
    en: "Applies account-wide, whatever the product.",
  },
  pickProduct: { es: "¿De qué producto es?", en: "Which product is it about?" },
  answerPlaceholder: {
    es: "La respuesta, como se la darías a un cliente.",
    en: "The answer, the way you would give it to a customer.",
  },
  saveAnswer: { es: "Guardar", en: "Save" },
  answered: {
    es: "Listo. El agente ya sabe contestarla.",
    en: "Done. The agent can answer it now.",
  },
  saveFailed: { es: "No se pudo guardar.", en: "Could not save." },
} satisfies Namespace;

export const unify = {
  title: { es: "Productos repetidos entre plataformas", en: "Products duplicated across platforms" },
  hint: {
    es: "El mismo producto vive una vez por canal. Unifícalos y el conocimiento se carga una sola vez.",
    en: "The same product lives once per channel. Merge them and the knowledge is written once.",
  },
  bySku: { es: "Tienen el mismo SKU", en: "Same SKU" },
  byTitle: { es: "El nombre coincide", en: "Matching name" },
  pricesKept: {
    es: "Cada canal conserva su precio y su enlace. Sólo se unifica lo que el agente sabe.",
    en: "Each channel keeps its own price and link. Only what the agent knows is merged.",
  },
  merge: { es: "Es el mismo producto", en: "Same product" },
  notSame: { es: "No son el mismo", en: "Not the same" },
  selected: { es: "{n} elegidos", en: "{n} selected" },
  cancel: { es: "Cancelar", en: "Cancel" },
  separate: { es: "Separar", en: "Unlink" },
  channels: { es: "También se vende en", en: "Also sold on" },
  separated: { es: "Listo, vuelve a ser un producto aparte.", en: "Done, it is a separate product again." },
  done: { es: "Listo. El agente ya contesta igual por todos los canales.", en: "Done. The agent now answers the same on every channel." },
  failed: { es: "No se pudo unificar.", en: "Could not merge." },
} satisfies Namespace;

export const approvals = {
  decisionUnavailable: { es:'No se pudo consultar la decisión. Reintenta.', en:'Could not load the decision. Try again.' },
  orderExecutionUnavailable: { es:'No se pudo autorizar esta operación para este pedido. No se ejecutó.', en:'Could not authorize this operation for this order. It was not executed.' },
  orderResultUnverified: { es:'Verifica el resultado de la operación en Shopify antes de solicitar otra.', en:'Verify the operation’s result in Shopify before requesting another.' },
  orderExecutionBusy: { es:'Este pedido tiene una operación en curso o sin verificar. Revisa su resultado antes de solicitar otra.', en:'This order has an operation in progress or awaiting verification. Review its result before requesting another.' },
  orderStoreChanged: { es:'La tienda del pedido no coincide con la conexión activa. No se ejecutó la operación.', en:'The order’s store does not match the active connection. The operation was not executed.' },
  refundAmountInvalid: { es: 'El importe de reembolso no es válido.', en: 'The refund amount is invalid.' },
  refundPending: { es: 'Hay un reembolso en proceso. Revisa su estado en Shopify antes de solicitar otro.', en: 'A refund is pending. Check its status in Shopify before requesting another.' },
  refundAlreadyReturned: { es: 'No queda saldo disponible para reembolsar.', en: 'There is no remaining balance available to refund.' },
  refundHistoryUnverified: { es: 'No pudimos verificar el saldo pendiente de devolución. No se creó un reembolso.', en: 'We could not verify the remaining refundable balance. No refund was created.' },
  refundResultUnverified: { es: 'El resultado del reembolso requiere revisión en Shopify. Verifica la operación antes de crear otra solicitud.', en: 'The refund result requires review in Shopify. Verify the operation before creating another request.' },
  viewAll: { es: 'Ver todas', en: 'View all' },
  title: { es: "Esperando tu sí", en: "Waiting on you" },
  subtitle: {
    es: "Lo que el agente preparó y no hace hasta que decidas.",
    en: "What the agent prepared and will not do until you decide.",
  },
  empty: { es: "No hay nada esperando.", en: "Nothing waiting." },
  approve: { es: "Aprobar", en: "Approve" },
  reject: { es: "Rechazar", en: "Decline" },
  done: { es: "Listo.", en: "Done." },
  failed: { es: "No se pudo.", en: "Could not do it." },
  loadFailed: { es: "No se pudieron cargar las aprobaciones.", en: "Could not load approvals." },
  invalidDecision: { es: "Selecciona aprobar o rechazar.", en: "Choose approve or decline." },
  unauthorized: { es: "Inicia sesión para decidir.", en: "Sign in to decide." },
  noWorkspace: { es: "No tienes acceso a este negocio.", en: "You do not have access to this business." },
} satisfies Namespace;

/**
 * Las reglas del comercio (migración 200). Viven en este archivo y no en uno
 * propio por lo mismo que `gaps`: son tres pantallas chicas del asistente y
 * repartirlas en tres archivos hace más difícil ver que se contradicen.
 */
export const reglas = {
  testRule: { es:'Probar con una conversación',en:'Test with a conversation' },
  testScope: { es:'Prueba la regla y la personalidad sobre el último mensaje del cliente. No envía respuestas ni ejecuta acciones. No consulta el catálogo en vivo; los adjuntos sin transcripción son desconocidos. Usa los límites y el saldo de IA actuales.',en:'Tests the rule and personality against the latest customer message. It sends no replies and executes no actions. No live catalogue lookup; attachments without transcripts are unknown. Uses the current AI limits and balance.' },
  testSearch: { es:'Buscar por nombre del contacto',en:'Search by contact name' },
  testFind: { es:'Buscar',en:'Search' },
  testChoose: { es:'Selecciona una conversación',en:'Choose a conversation' },
  testNoCases: { es:'No hay conversaciones accesibles en este resultado.',en:'No accessible conversations in this result.' },
  testContact: { es:'Contacto',en:'Contact' },
  testDraft: { es:'Probar borrador guardado',en:'Test saved draft' },
  testCurrent: { es:'Probar versión actual',en:'Test current version' },
  testProposal: { es:'Respuesta propuesta · no enviada',en:'Proposed reply · not sent' },
  testOldResult: { es:'Este resultado corresponde a una versión anterior.',en:'This result belongs to an earlier version.' },
  testApplies: { es:'La prueba indica que la regla aplica.',en:'The test indicates the rule applies.' },
  testNotApplies: { es:'La prueba indica que la regla no aplica.',en:'The test indicates the rule does not apply.' },
  testCoverage: { es:'Historial consultado: {n} mensajes.',en:'History inspected: {n} messages.' },
  testTruncated: { es:'El historial consultado es parcial.',en:'The inspected history is partial.' },
  testConflicts: { es:'Posibles conflictos',en:'Possible conflicts' },
  testNoConflicts: { es:'La prueba no señaló conflictos. No garantiza su ausencia.',en:'The test flagged no conflicts. This does not guarantee their absence.' },
  testNoAssistant: { es:'No hay un superasistente activo para probar esta regla.',en:'No active assistant is available to test this rule.' },
  testNoText: { es:'No hay texto disponible de un mensaje del cliente en el tramo reciente.',en:'No customer message text is available in the recent history.' },
  testTooLong: { es:'Las reglas y el historial superan el tamaño permitido para esta prueba.',en:'The rules and history exceed the allowed size for this test.' },
  testFailed: { es:'No se pudo completar la prueba. Revisa el estado antes de volver a probar.',en:'The test could not be completed. Check the state before testing again.' },
  invalid: { es: 'Revisa el contenido de la regla.', en: 'Review the rule content.' },
  notFound: { es: 'No se encontró esta regla en el negocio actual.', en: 'This rule was not found in the current business.' },
  changed: { es: 'La regla o el borrador cambió. Actualiza y revisa la versión actual.', en: 'The rule or draft changed. Refresh and review the current version.' },
  capacity: { es: 'Se alcanzó el límite de 50 reglas.', en: 'The limit of 50 rules has been reached.' },
  adminRequired: { es: 'Solo un administrador puede cambiar una regla publicada.', en: 'Only an administrator can change a published rule.' },
  readOnly: { es: 'El negocio está en modo de lectura.', en: 'The business is in read-only mode.' },
  versions: { es: 'Editar y versiones', en: 'Edit and versions' },
  versionNumber: { es: 'Versión {n}', en: 'Version {n}' },
  currentVersion: { es: 'Versión actual: {n}', en: 'Current version: {n}' },
  activeState: { es: 'Activa', en: 'Active' },
  inactiveState: { es: 'Apagada', en: 'Off' },
  draftState: { es: 'Borrador', en: 'Draft' },
  testState: { es: 'Prueba', en: 'Test' },
  saveDraft: { es: 'Guardar borrador', en: 'Save draft' },
  editDraft: { es: 'Preparar edición', en: 'Prepare edit' },
  publishDraft: { es: 'Publicar borrador', en: 'Publish draft' },
  discardDraft: { es: 'Descartar borrador', en: 'Discard draft' },
  draftBase: { es: 'Borrador {draft}, basado en la versión {live}.', en: 'Draft {draft}, based on version {live}.' },
  staleDraft: { es: 'La versión publicada cambió. Revisa y guarda el borrador sobre la versión actual antes de publicarlo.', en: 'The published version changed. Review and save the draft against the current version before publishing.' },
  moreVersions: { es: 'Cargar versiones anteriores', en: 'Load earlier versions' },
  rollback: { es: 'Restaurar esta versión', en: 'Restore this version' },
  rollbackReview: { es: 'Revisa la versión antes de restaurarla.', en: 'Review the version before restoring it.' },
  refresh: { es: 'Actualizar', en: 'Refresh' },
  history: { es: 'Historial', en: 'History' },
  noActor: { es: 'Autor no registrado', en: 'Author not recorded' },
  source: { es: 'Origen: {source}', en: 'Source: {source}' },
  source_base: { es: 'Regla predeterminada', en: 'Default rule' },
  source_hueco: { es: 'Respuesta de Huecos', en: 'Answer from Gaps' },
  source_comercio: { es: 'Negocio', en: 'Business' },
  source_pliego: { es: 'Cuestionario', en: 'Questionnaire' },
  source_baseline: { es: 'Versión inicial observada', en: 'Initial observed version' },
  title: { es: "Reglas del negocio", en: "Business rules" },
  hint: {
    es: "Las reglas respetan los permisos y controles del negocio.",
    en: "Rules respect the business permissions and controls.",
  },
  empty: {
    es: "Todavía no hay reglas. El agente sigue su personalidad y nada más.",
    en: "No rules yet. The agent just follows its personality.",
  },
  add: { es: "Agregar regla", en: "Add rule" },
  save: { es: "Guardar", en: "Save" },
  cancel: { es: "Cancelar", en: "Cancel" },
  saveFailed: { es: "No se pudo guardar.", en: "Could not save." },
  titlePlaceholder: { es: "Nombre de la regla", en: "Rule name" },
  whenPlaceholder: {
    es: "Cuándo aplica (opcional): cuando pregunten por envíos",
    en: "When it applies (optional): when they ask about shipping",
  },
  doPlaceholder: {
    es: "Qué hacer: nunca prometas una fecha exacta, di el rango que figura en la web.",
    en: "What to do: never promise an exact date, give the range published on the site.",
  },
} satisfies Namespace;

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
  title: { es: "Reglas del negocio", en: "Business rules" },
  hint: {
    es: "Mandan sobre su personalidad, pase lo que pase.",
    en: "They override its personality, no matter what.",
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
